use axum::extract::{Path, State};
use axum::response::Response;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tnc_formats::Tool;

use crate::auth::CurrentUser;
use crate::error::{ApiResult, AppError};
use crate::library;
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/tools/{machine}", get(get_table).put(put_table))
        .route("/tools/{machine}/tool.t", get(get_tool_t).put(put_tool_t))
}

async fn table_json(st: &AppState, owner: &str, machine: &str) -> ApiResult<Value> {
    let t = library::tool_table(st, owner, machine).await?;
    let builtin = st.engine.as_ref().map(|e| e.builtin_tools().to_vec()).unwrap_or_default();
    Ok(json!({ "machine": machine, "tools": t.tools, "holder": t.holder, "updated_at": t.updated_at, "builtin": builtin }))
}

/// The operator's table (overrides the built-in tools by number) plus the built-in table for reference.
async fn get_table(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(machine): Path<String>) -> ApiResult<Json<Value>> {
    library::check_machine(&machine)?;
    Ok(Json(table_json(&st, &u.id, &machine).await?))
}

#[derive(Deserialize)]
struct PutTable {
    tools: Vec<Tool>,
    holder: Option<String>,
}

async fn put_table(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(machine): Path<String>, Json(b): Json<PutTable>) -> ApiResult<Json<Value>> {
    library::check_machine(&machine)?;
    let holder = match b.holder {
        Some(h) => h,
        None => library::tool_table(&st, &u.id, &machine).await?.holder,
    };
    let tools: Vec<Tool> = b.tools.into_iter().map(|t| Tool { name: t.name.trim().to_uppercase(), ..t }).collect();
    library::save_tool_table(&st, &u.id, &machine, &tools, &holder).await?;
    Ok(Json(table_json(&st, &u.id, &machine).await?))
}

async fn get_tool_t(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(machine): Path<String>) -> ApiResult<Response> {
    library::check_machine(&machine)?;
    let t = library::tool_table(&st, &u.id, &machine).await?;
    super::programs::file_response("TOOL.T", tnc_formats::write_tool_t(&t.tools), None)
}

/// Replaces the table with a HEIDENHAIN TOOL.T file (request body, UTF-8 or Windows-1252).
async fn put_tool_t(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(machine): Path<String>, body: axum::body::Bytes) -> ApiResult<Json<Value>> {
    library::check_machine(&machine)?;
    let tools = tnc_formats::parse_tool_t(&tnc_formats::decode(&body)).ok_or_else(|| AppError::bad("not a TOOL.T file (no T NAME header line)"))?;
    let holder = library::tool_table(&st, &u.id, &machine).await?.holder;
    library::save_tool_table(&st, &u.id, &machine, &tools, &holder).await?;
    Ok(Json(table_json(&st, &u.id, &machine).await?))
}
