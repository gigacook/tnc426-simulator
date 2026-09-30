//! `/api` — everything under `/api/v1` is the versioned JSON API; `/api/ai/v1` is the OpenRouter proxy.

mod account;
mod admin;
mod io;
mod meta;
mod programs;
mod projects;
mod shares;
mod tools;

use axum::extract::DefaultBodyLimit;
use axum::Router;

use crate::state::AppState;

pub fn api() -> Router<AppState> {
    let v1 = Router::new()
        .merge(meta::routes())
        .merge(account::routes())
        .merge(projects::routes())
        .merge(programs::routes())
        .merge(tools::routes())
        .merge(shares::routes())
        .merge(admin::routes())
        .merge(io::routes().layer(DefaultBodyLimit::max(64 << 20)))
        .layer(DefaultBodyLimit::max(8 << 20));
    Router::new()
        .route("/health", axum::routing::get(meta::health))
        .nest("/v1", v1)
        .nest("/ai/v1", crate::ai::routes())
}
