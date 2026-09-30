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
pub mod routes;
pub mod state;
pub mod util;
pub mod web;

pub use config::Config;
pub use state::AppState;

use axum::Router;
use tower_http::compression::CompressionLayer;
use tower_http::trace::TraceLayer;

pub fn router(state: AppState) -> Router {
    Router::new()
        .nest("/api", routes::api())
        .merge(web::routes())
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}
