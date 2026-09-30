//! Pages: the web app (web/dist, a single-page app) at `/`, the single-file simulator at `/sim/`.

use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::Router;
use tower::ServiceExt;
use tower_http::services::ServeDir;

use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/sim", get(|| async { Redirect::permanent("/sim/") }))
        .route("/sim/", get(sim))
        .route("/sim/index.html", get(sim))
        .fallback(app)
}

/// Tells bridge.js it is served by this server (API + AI proxy paths). Only this server injects it:
/// the GitHub Pages copy of the same file never sees it and stays fully standalone.
const INJECT: &str = r#"<script>window.TNC_BACKEND={api:"/api/v1",ai:"/api/ai/v1"};</script>"#;

async fn sim(State(st): State<AppState>) -> Response {
    match tokio::fs::read_to_string(&st.cfg.sim_file).await {
        Ok(html) => {
            let html = match html.find("</head>") {
                Some(i) => format!("{}{INJECT}{}", &html[..i], &html[i..]),
                None => format!("{INJECT}{html}"),
            };
            ([(header::CACHE_CONTROL, "no-cache")], Html(html)).into_response()
        }
        Err(_) => (
            StatusCode::NOT_FOUND,
            format!("simulator page not found at {} — run python3 build.py in the repo root", st.cfg.sim_file.display()),
        )
            .into_response(),
    }
}

/// Files from web/dist; any other path gets index.html so client-side routes (/programs/…, /s/…) load.
async fn app(State(st): State<AppState>, req: Request) -> Response {
    if req.uri().path().starts_with("/api/") {
        return (StatusCode::NOT_FOUND, axum::Json(serde_json::json!({ "error": { "code": "not_found", "message": "no such API route" } }))).into_response();
    }
    let dir = &st.cfg.web_dir;
    let index = dir.join("index.html");
    if !index.exists() {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Html(format!(
                "<!doctype html><meta charset=utf-8><title>TNC server</title><body style=\"font:15px system-ui;padding:2em\">\
                 <h1>TNC server is running</h1><p>The web app is not built at <code>{}</code>. Run <code>npm run build</code> in <code>web/</code>.</p>\
                 <p>The simulator is at <a href=\"/sim/\">/sim/</a>. The API is at <code>/api/v1</code>.</p>",
                dir.display()
            )),
        )
            .into_response();
    }
    let is_asset = req.uri().path().starts_with("/assets/");
    let res = ServeDir::new(dir).not_found_service(tower::service_fn({
        let index = index.clone();
        move |_req: Request| {
            let index = index.clone();
            async move {
                let body = tokio::fs::read_to_string(&index).await.unwrap_or_default();
                Ok::<_, std::convert::Infallible>(([(header::CACHE_CONTROL, "no-cache")], Html(body)).into_response())
            }
        }
    }));
    match res.oneshot(req).await {
        Ok(mut r) => {
            // Vite puts a content hash in every asset name: cache those for good
            if is_asset && r.status().is_success() {
                r.headers_mut().insert(header::CACHE_CONTROL, header::HeaderValue::from_static("public, max-age=31536000, immutable"));
            }
            r.into_response()
        }
        Err(e) => match e {},
    }
}
