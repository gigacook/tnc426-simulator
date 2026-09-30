use clap::{Parser, Subcommand};
use tnc_server::{AppState, Config};

/// TNC 426/430 simulator server.
#[derive(Parser)]
#[command(version, about)]
struct Cli {
    #[command(subcommand)]
    cmd: Option<Cmd>,
    #[command(flatten)]
    cfg: Config,
}

#[derive(Subcommand)]
enum Cmd {
    /// Run the server (the default).
    Serve,
    /// Check programs with the interpreter, without a server: `tnc-server check PART.H …`
    Check {
        files: Vec<std::path::PathBuf>,
        #[arg(long, default_value = "426")]
        machine: String,
        /// Create tools the table lacks, as an import would.
        #[arg(long)]
        auto_tools: bool,
    },
    /// Create an account (the first one on a new server should be --admin).
    AddUser {
        #[arg(long)]
        email: String,
        #[arg(long)]
        name: String,
        #[arg(long, env = "TNC_NEW_PASSWORD", hide_env_values = true)]
        password: String,
        #[arg(long)]
        admin: bool,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "tnc_server=info,tower_http=info".into()))
        .init();
    let cli = Cli::parse();
    match cli.cmd.unwrap_or(Cmd::Serve) {
        Cmd::Serve => serve(cli.cfg).await,
        Cmd::Check { files, machine, auto_tools } => check(files, machine, auto_tools),
        Cmd::AddUser { email, name, password, admin } => {
            let st = AppState::new(cli.cfg).await?;
            let u = tnc_server::auth::create_user(&st.db, &email, &name, &password, if admin { "admin" } else { "user" })
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
            println!("created {} <{}> ({})", u.name, u.email, u.role);
            Ok(())
        }
    }
}

async fn serve(cfg: Config) -> anyhow::Result<()> {
    let bind = cfg.bind;
    let st = AppState::new(cfg).await?;
    tracing::info!(
        "tnc-server {} on http://{bind} · data {} · interpreter {} · AI {}",
        env!("CARGO_PKG_VERSION"),
        st.cfg.data_dir.display(),
        if st.engine.is_some() { tnc_engine::interpreter_version() } else { "OFF".into() },
        if st.cfg.ai_enabled() { "via OpenRouter" } else { "off (no OPENROUTER_API_KEY)" },
    );
    let listener = tokio::net::TcpListener::bind(bind).await?;
    axum::serve(listener, tnc_server::router(st))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
            tracing::info!("shutting down");
        })
        .await?;
    Ok(())
}

fn check(files: Vec<std::path::PathBuf>, machine: String, auto_tools: bool) -> anyhow::Result<()> {
    let engine = tnc_engine::Engine::start(tnc_engine::Config::default())?;
    let (mut clean, mut bad) = (0, 0);
    for f in &files {
        let text = tnc_formats::decode(&std::fs::read(f)?);
        let r = engine.check_blocking(text, tnc_engine::Options { machine: machine.clone(), auto_tools, ..Default::default() });
        match r {
            Ok(r) if r.ok => {
                clean += 1;
                println!("OK    {}  {} blocks  {:.0} s", f.display(), r.blocks, r.stats.cycle_time);
            }
            Ok(r) => {
                bad += 1;
                println!("ERROR {}", f.display());
                for e in r.errors.iter().take(5) {
                    println!("      line {:>5}  {}  | {}", e.line, e.msg, e.raw);
                }
            }
            Err(e) => {
                bad += 1;
                println!("FAIL  {}  {e}", f.display());
            }
        }
    }
    println!("{} programs · {clean} clean · {bad} with errors", files.len());
    if bad > 0 {
        std::process::exit(1);
    }
    Ok(())
}
