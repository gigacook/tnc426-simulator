use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use sqlx::SqlitePool;
use tnc_engine::Engine;

use crate::config::Config;

#[derive(Clone)]
pub struct AppState {
    pub db: SqlitePool,
    pub cfg: Arc<Config>,
    /// None when the interpreter could not start: programs are stored unchecked, never refused.
    pub engine: Option<Engine>,
    pub http: reqwest::Client,
    pub limiter: Arc<Limiter>,
    pub models_cache: Arc<Mutex<Option<(Instant, bytes::Bytes)>>>,
    /// One-time sign-in links (SHA-256 of the token -> user id, issued at), see `local.rs`.
    pub sign_in_links: Arc<Mutex<HashMap<String, (String, Instant)>>>,
}

impl AppState {
    pub async fn new(cfg: Config) -> anyhow::Result<AppState> {
        std::fs::create_dir_all(&cfg.data_dir)?;
        let db = crate::db::connect(&cfg.database_url()).await?;
        let engine = match Engine::start(tnc_engine::Config { workers: cfg.engine_workers, ..Default::default() }) {
            Ok(e) => Some(e),
            Err(e) => {
                tracing::error!("interpreter unavailable, programs will be stored unchecked: {e}");
                None
            }
        };
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(900))
            .user_agent(concat!("tnc-server/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(AppState {
            db,
            cfg: Arc::new(cfg),
            engine,
            http,
            limiter: Arc::new(Limiter::default()),
            models_cache: Arc::new(Mutex::new(None)),
            sign_in_links: Arc::new(Mutex::new(HashMap::new())),
        })
    }
}

/// Failed sign-ins per key (e-mail), in a sliding window. In memory: a restart forgets, which is fine.
#[derive(Default)]
pub struct Limiter {
    hits: Mutex<HashMap<String, Vec<Instant>>>,
}

impl Limiter {
    const WINDOW: Duration = Duration::from_secs(15 * 60);
    const MAX: usize = 10;

    pub fn blocked(&self, key: &str) -> bool {
        let mut m = self.hits.lock().unwrap();
        let v = m.entry(key.to_owned()).or_default();
        v.retain(|t| t.elapsed() < Self::WINDOW);
        v.len() >= Self::MAX
    }
    pub fn fail(&self, key: &str) {
        let mut m = self.hits.lock().unwrap();
        m.entry(key.to_owned()).or_default().push(Instant::now());
        if m.len() > 10_000 {
            m.retain(|_, v| v.iter().any(|t| t.elapsed() < Self::WINDOW));
        }
    }
    pub fn clear(&self, key: &str) {
        self.hits.lock().unwrap().remove(key);
    }
}
