use std::net::SocketAddr;
use std::path::PathBuf;

/// Everything the server reads from its environment (or `.env`) and command line.
#[derive(Debug, Clone, clap::Args)]
pub struct Config {
    /// Address to listen on.
    #[arg(long, env = "TNC_BIND", default_value = "127.0.0.1:8426")]
    pub bind: SocketAddr,
    /// Folder for the database (tnc.db).
    #[arg(long, env = "TNC_DATA_DIR", default_value = "data")]
    pub data_dir: PathBuf,
    /// The built web app (web/dist). Missing: the API still runs.
    #[arg(long, env = "TNC_WEB_DIR", default_value = "../web/dist")]
    pub web_dir: PathBuf,
    /// The built single-file simulator (index.html from build.py), served at /sim/.
    #[arg(long, env = "TNC_SIM_FILE", default_value = "../index.html")]
    pub sim_file: PathBuf,
    /// Public address, e.g. https://tnc.example.com — for share links and the CSRF origin check.
    #[arg(long, env = "TNC_PUBLIC_URL")]
    pub public_url: Option<String>,
    /// Let anyone create an account. The first account (the admin) can always be created.
    #[arg(long, env = "TNC_ALLOW_SIGNUP", default_value_t = false)]
    pub allow_signup: bool,
    /// Mark the session cookie Secure (on automatically when TNC_PUBLIC_URL is https).
    #[arg(long, env = "TNC_SECURE_COOKIES", default_value_t = false)]
    pub secure_cookies: bool,
    #[arg(long, env = "TNC_SESSION_DAYS", default_value_t = 30)]
    pub session_days: i64,
    /// The OpenRouter key. Without it the AI proxy is off. OpenRouter only — never another provider.
    #[arg(long, env = "OPENROUTER_API_KEY", hide_env_values = true)]
    pub openrouter_api_key: Option<String>,
    #[arg(long, env = "TNC_OPENROUTER_BASE", default_value = "https://openrouter.ai/api/v1")]
    pub openrouter_base: String,
    /// Comma-separated model ids users may pick; empty = any OpenRouter model.
    #[arg(long, env = "TNC_AI_MODELS", default_value = "", value_delimiter = ',')]
    pub ai_models: Vec<String>,
    #[arg(long, env = "TNC_AI_DEFAULT_MODEL", default_value = "deepseek/deepseek-v4.1-flash")]
    pub ai_default_model: String,
    /// Upper bound on max_tokens per request.
    #[arg(long, env = "TNC_AI_MAX_TOKENS", default_value_t = 16000)]
    pub ai_max_tokens: u64,
    /// Per user per calendar month, in US$ as OpenRouter reports it.
    #[arg(long, env = "TNC_AI_MONTHLY_BUDGET_USD", default_value_t = 5.0)]
    pub ai_monthly_budget_usd: f64,
    /// Interpreter threads.
    #[arg(long, env = "TNC_ENGINE_WORKERS", default_value_t = 2)]
    pub engine_workers: usize,
    /// Comma-separated `Host` header values to answer (e.g. `127.0.0.1:8427,localhost:8427`); anything
    /// else gets 421. Empty = any host. The desktop shell sets it: a loopback server must not answer a
    /// DNS-rebinding page that resolved some other name to 127.0.0.1.
    #[arg(long, env = "TNC_ALLOWED_HOSTS", default_value = "", value_delimiter = ',')]
    pub allowed_hosts: Vec<String>,
    /// A Content-Security-Policy header for every response (plus nosniff / no-referrer). Unset = none.
    #[arg(long, env = "TNC_CSP")]
    pub csp: Option<String>,
    /// Local mode (the desktop shell): one operator, signed in by a one-time link, no sign-out.
    #[arg(skip)]
    pub local_mode: bool,
}

impl Config {
    pub fn database_url(&self) -> String {
        format!("sqlite://{}", self.data_dir.join("tnc.db").display())
    }
    pub fn secure(&self) -> bool {
        self.secure_cookies || self.public_url.as_deref().is_some_and(|u| u.starts_with("https://"))
    }
    pub fn ai_enabled(&self) -> bool {
        self.openrouter_api_key.as_deref().is_some_and(|k| !k.trim().is_empty())
    }
    pub fn allowed_hosts(&self) -> Vec<String> {
        self.allowed_hosts.iter().map(|s| s.trim().to_ascii_lowercase()).filter(|s| !s.is_empty()).collect()
    }
    pub fn ai_models(&self) -> Vec<String> {
        self.ai_models.iter().map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()).collect()
    }
    /// A config for tests and embedding: everything off, nothing on disk but `data_dir`.
    pub fn minimal(data_dir: PathBuf) -> Config {
        Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            data_dir,
            web_dir: PathBuf::from("/nonexistent"),
            sim_file: PathBuf::from("/nonexistent"),
            public_url: None,
            allow_signup: false,
            secure_cookies: false,
            session_days: 30,
            openrouter_api_key: None,
            openrouter_base: "https://openrouter.ai/api/v1".into(),
            ai_models: vec![],
            ai_default_model: "deepseek/deepseek-v4.1-flash".into(),
            ai_max_tokens: 16000,
            ai_monthly_budget_usd: 5.0,
            engine_workers: 1,
            allowed_hosts: vec![],
            csp: None,
            local_mode: false,
        }
    }
}
