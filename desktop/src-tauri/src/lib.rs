//! The desktop app: a Tauri 2 window around the web app and the simulator, both served by the
//! standalone server's own crate (`tnc-server`) running in this process on loopback.
//!
//! Start-up: open the splash (bundled `desktop/splash`), open the database in the platform's app-data
//! folder, make sure the local operator account exists, bind 127.0.0.1 on a remembered port, wait for
//! `/api/health`, then point the window at a one-time sign-in link. On exit the server is told to stop
//! and the database is closed cleanly.
//!
//! Hardening: loopback only; `Host` must be our own `127.0.0.1:<port>` / `localhost:<port>` (no
//! DNS-rebinding); a strict-ish CSP on every response; the remote page gets no Tauri IPC at all (no
//! capability lists it); any navigation away from our origin opens the system browser instead.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};
use tnc_server::{AppState, Config};
use tokio::sync::oneshot;

/// The remote page's CSP. The simulator is one HTML file of inline scripts (hence 'unsafe-inline'),
/// its 3D export uses blob: URLs, and BYOK AI talks straight to OpenRouter (never another provider).
const CSP: &str = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; \
img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; connect-src 'self' https://openrouter.ai; \
worker-src 'self' blob:; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";

/// First choice of port. Remembered per installation (`desktop.json`) because the simulator keeps
/// its profile in browser storage, which is per origin, and the origin includes the port.
const DEFAULT_PORT: u16 = 8427;

#[derive(Default)]
struct Running {
    stop: Option<oneshot::Sender<()>>,
    done: Option<tokio::task::JoinHandle<()>>,
    state: Option<AppState>,
}

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct DesktopFile {
    port: Option<u16>,
}

fn read_port(data: &Path) -> u16 {
    std::fs::read(data.join("desktop.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<DesktopFile>(&b).ok())
        .and_then(|f| f.port)
        .filter(|p| *p >= 1024)
        .unwrap_or(DEFAULT_PORT)
}

fn write_port(data: &Path, port: u16) {
    let body = serde_json::to_vec_pretty(&DesktopFile { port: Some(port) }).unwrap_or_default();
    if let Err(e) = std::fs::write(data.join("desktop.json"), body) {
        tracing::warn!("could not remember port {port}: {e}");
    }
}

/// The remembered port, else any free one (remembered from then on).
async fn bind(data: &Path) -> anyhow::Result<tokio::net::TcpListener> {
    let want = read_port(data);
    let l = match tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, want)).await {
        Ok(l) => l,
        Err(e) => {
            tracing::warn!("port {want} busy ({e}); taking a free one — browser storage starts empty on a new port");
            tokio::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?
        }
    };
    let port = l.local_addr()?.port();
    if port != want || !data.join("desktop.json").exists() {
        write_port(data, port);
    }
    Ok(l)
}

struct Started {
    url: url::Url,
    origin: url::Url,
}

/// The bundled splash page: `tauri://localhost` (mac/Linux) or `http://tauri.localhost` (Windows).
fn is_app_page(u: &url::Url) -> bool {
    u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost")
}

async fn start(data_dir: PathBuf, resources: PathBuf, running: &Mutex<Running>) -> anyhow::Result<Started> {
    std::fs::create_dir_all(&data_dir)?;
    let listener = bind(&data_dir).await?;
    let addr: SocketAddr = listener.local_addr()?;
    let mut cfg = Config::minimal(data_dir.clone());
    cfg.bind = addr;
    cfg.web_dir = resources.join("web");
    cfg.sim_file = resources.join("sim").join("index.html");
    cfg.public_url = Some(format!("http://127.0.0.1:{}", addr.port()));
    cfg.allowed_hosts = vec![format!("127.0.0.1:{}", addr.port()), format!("localhost:{}", addr.port())];
    cfg.csp = Some(CSP.into());
    cfg.local_mode = true;
    cfg.engine_workers = 2;
    // Local mode keeps the AI key in the simulator (BYOK, straight to OpenRouter); set
    // OPENROUTER_API_KEY in the environment to route it through this process instead.
    cfg.openrouter_api_key = std::env::var("OPENROUTER_API_KEY").ok().filter(|k| !k.trim().is_empty());
    for (what, p) in [("web app", cfg.web_dir.join("index.html")), ("simulator", cfg.sim_file.clone())] {
        if !p.exists() {
            anyhow::bail!("the bundled {what} is missing at {} — run `node desktop/prepare-assets.mjs` before building", p.display());
        }
    }

    let st = AppState::new(cfg).await?;
    let user = tnc_server::local::ensure_local_user(&st).await.map_err(|e| anyhow::anyhow!("local account: {e}"))?;
    let (stop_tx, stop_rx) = oneshot::channel::<()>();
    let served = st.clone();
    let done = tokio::spawn(async move {
        let r = tnc_server::serve(listener, served, async {
            let _ = stop_rx.await;
        })
        .await;
        if let Err(e) = r {
            tracing::error!("local server stopped: {e}");
        }
    });

    let origin: url::Url = format!("http://127.0.0.1:{}/", addr.port()).parse()?;
    // readiness: the database answers through the real HTTP stack
    let health = origin.join("api/health")?;
    let mut ok = false;
    for _ in 0..50 {
        if let Ok(r) = st.http.get(health.clone()).send().await {
            if r.status().is_success() {
                ok = true;
                break;
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if !ok {
        anyhow::bail!("the local server did not answer {health} within 5 s");
    }
    tracing::info!(
        "local server on {origin} · data {} · interpreter {}",
        data_dir.display(),
        if st.engine.is_some() { "on" } else { "OFF (programs stored unchecked)" }
    );
    let link = tnc_server::local::issue_sign_in_link(&st, &user.id);
    let mut url = origin.join("api/v1/auth/once")?;
    url.query_pairs_mut().append_pair("t", &link);
    let mut r = running.lock().unwrap();
    r.stop = Some(stop_tx);
    r.done = Some(done);
    r.state = Some(st);
    Ok(Started { url, origin })
}

fn same_origin(u: &url::Url, origin: &url::Url) -> bool {
    u.scheme() == origin.scheme() && u.port_or_known_default() == origin.port_or_known_default() && matches!(u.host_str(), Some("127.0.0.1" | "localhost"))
}

pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "tnc_desktop_lib=info,tnc_server=info".into()))
        .try_init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // a second launch focuses the first window instead of opening a second server on the same database
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(Running::default()))
        .setup(|app| {
            let handle = app.handle().clone();
            let data_dir = app.path().app_data_dir()?;
            let resources = app.path().resource_dir()?;
            // one window: the bundled splash first, then navigated to the local server
            let origin: Arc<OnceLock<url::Url>> = Arc::default();
            let allowed = origin.clone();
            let opener = handle.clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("TNC 426 Simulator")
                .inner_size(1360.0, 860.0)
                .min_inner_size(360.0, 480.0)
                .on_navigation(move |u| {
                    if is_app_page(u) || allowed.get().is_some_and(|o| same_origin(u, o)) {
                        return true;
                    }
                    // anything else (OpenRouter's key page, docs) opens in the system browser
                    if matches!(u.scheme(), "http" | "https" | "mailto") {
                        use tauri_plugin_opener::OpenerExt;
                        let _ = opener.opener().open_url(u.as_str(), None::<&str>);
                    }
                    false
                })
                .build()?;
            tauri::async_runtime::spawn(async move {
                let running = handle.state::<Mutex<Running>>();
                match start(data_dir, resources, &running).await {
                    Ok(s) => {
                        let _ = origin.set(s.origin);
                        if let Err(e) = window.navigate(s.url) {
                            tracing::error!("could not open the app page: {e}");
                        }
                    }
                    Err(e) => {
                        tracing::error!("start-up failed: {e:#}");
                        let msg = serde_json::to_string(&format!("{e:#}")).unwrap_or_default();
                        let _ = window.eval(format!("window.tncStartupFailed({msg})"));
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building the Tauri application");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            let running = handle.state::<Mutex<Running>>();
            let (stop, done, state) = {
                let mut r = running.lock().unwrap();
                (r.stop.take(), r.done.take(), r.state.take())
            };
            if let Some(stop) = stop {
                let _ = stop.send(());
            }
            tauri::async_runtime::block_on(async move {
                if let Some(done) = done {
                    let _ = tokio::time::timeout(Duration::from_secs(5), done).await;
                }
                if let Some(st) = state {
                    st.db.close().await; // checkpoints the WAL
                }
            });
        }
    });
}
