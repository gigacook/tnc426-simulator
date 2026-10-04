//! TNC server: accounts, a versioned program library checked by the simulator's own interpreter,
//! tool tables, share links, and an OpenRouter proxy that keeps the AI key off the browser.
//!
//! The router is a library so a desktop shell (Tauri) or tests can embed it; `main.rs` is the CLI.

pub mod ai;
pub mod auth;
pub mod config;
pub mod db;
pub mod error;
pub mod library;
pub mod local;
pub mod routes;
pub mod state;
pub mod util;
pub mod web;

pub use config::Config;
pub use state::AppState;

use axum::extract::{Request, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

pub fn router(state: AppState) -> Router {
    Router::new()
        .nest("/api", routes::api())
        .merge(web::routes())
        .layer(CompressionLayer::new())
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Serve `state` on `listener` until `shutdown` resolves (the CLI and the desktop shell both use this).
pub async fn serve(listener: tokio::net::TcpListener, state: AppState, shutdown: impl std::future::Future<Output = ()> + Send + 'static) -> std::io::Result<()> {
    axum::serve(listener, router(state)).with_graceful_shutdown(shutdown).await
}

/// Host allow-list and security headers, both off unless configured (TNC_ALLOWED_HOSTS, TNC_CSP).
async fn guard(State(st): State<AppState>, req: Request, next: Next) -> Response {
    let allowed = st.cfg.allowed_hosts();
    if !allowed.is_empty() {
        let host = req.headers().get(header::HOST).and_then(|v| v.to_str().ok()).map(str::to_ascii_lowercase);
        if !host.is_some_and(|h| allowed.contains(&h)) {
            return (StatusCode::MISDIRECTED_REQUEST, "unknown host").into_response();
        }
    }
    let mut res = next.run(req).await;
    if let Some(csp) = st.cfg.csp.as_deref().and_then(|c| HeaderValue::from_str(c).ok()) {
        let h = res.headers_mut();
        h.insert(header::CONTENT_SECURITY_POLICY, csp);
        h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
        h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    }
    res
}
