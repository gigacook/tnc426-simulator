use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde_json::{json, Value};

use crate::auth;
use crate::error::ApiResult;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/info", get(info))
}

pub async fn health(State(st): State<AppState>) -> ApiResult<Json<Value>> {
    sqlx::query("SELECT 1").execute(&st.db).await?;
    Ok(Json(json!({ "ok": true })))
}

/// What a client needs before signing in: versions, whether the first account still has to be made,
/// and which optional parts (interpreter, AI) are running.
async fn info(State(st): State<AppState>) -> ApiResult<Json<Value>> {
    let users = auth::user_count(&st.db).await?;
    Ok(Json(json!({
        "name": "tnc-server",
        "version": env!("CARGO_PKG_VERSION"),
        "api": 1,
        "interpreter": st.engine.as_ref().map(|_| tnc_engine::interpreter_version()),
        "machines": tnc_formats::MACHINES,
        "needs_setup": users == 0,
        "signup": users == 0 || st.cfg.allow_signup,
        "ai": {
            "enabled": st.cfg.ai_enabled(),
            "provider": "openrouter",
            "default_model": st.cfg.ai_default_model,
            "models": st.cfg.ai_models(),
            "max_tokens": st.cfg.ai_max_tokens,
            "monthly_budget_usd": st.cfg.ai_monthly_budget_usd,
        },
    })))
}
