//! Read-only links to a program. Anyone with the link sees the text and its check; signed-in users can
//! copy it into their own library. Revoking or deleting the program ends the link.

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{delete, get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::auth::CurrentUser;
use crate::error::{ApiResult, AppError};
use crate::library::{self, Write};
use crate::state::AppState;
use crate::util;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/programs/{id}/shares", get(list).post(create))
        .route("/shares/{token}", delete(revoke))
        .route("/shares/{token}/copy", post(copy))
        .route("/public/shares/{token}", get(public))
        .route("/public/shares/{token}/download", get(public_download))
}

#[derive(Serialize, sqlx::FromRow)]
struct Share {
    token: String,
    version: Option<i64>,
    created_at: String,
    expires_at: Option<String>,
    revoked_at: Option<String>,
}

fn with_url(st: &AppState, headers: &HeaderMap, s: &Share) -> Value {
    let base = st.cfg.public_url.clone().unwrap_or_else(|| {
        let host = headers.get("host").and_then(|h| h.to_str().ok()).unwrap_or("localhost");
        format!("http://{host}")
    });
    let mut v = serde_json::to_value(s).unwrap_or_default();
    v["url"] = json!(format!("{}/s/{}", base.trim_end_matches('/'), s.token));
    v
}

async fn list(State(st): State<AppState>, headers: HeaderMap, CurrentUser(u): CurrentUser, Path(id): Path<String>) -> ApiResult<Json<Vec<Value>>> {
    library::summary(&st, &u.id, &id).await?;
    let rows: Vec<Share> = sqlx::query_as("SELECT token, version, created_at, expires_at, revoked_at FROM shares WHERE program_id = ? ORDER BY created_at DESC")
        .bind(&id)
        .fetch_all(&st.db)
        .await?;
    Ok(Json(rows.iter().map(|s| with_url(&st, &headers, s)).collect()))
}

#[derive(Deserialize, Default)]
struct CreateShare {
    /// Pin a version; absent = always the latest.
    version: Option<i64>,
    expires_days: Option<i64>,
}

async fn create(
    State(st): State<AppState>,
    headers: HeaderMap,
    CurrentUser(u): CurrentUser,
    Path(id): Path<String>,
    body: Option<Json<CreateShare>>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let b = body.map(|j| j.0).unwrap_or_default();
    let p = library::live(&st, &u.id, &id).await?;
    if let Some(v) = b.version {
        if v < 1 || v > p.version {
            return Err(AppError::bad("no such version"));
        }
    }
    let s = Share {
        token: util::token(18),
        version: b.version,
        created_at: util::now(),
        expires_at: b.expires_days.filter(|d| *d > 0).map(|d| util::days_from_now(d.min(3650))),
        revoked_at: None,
    };
    sqlx::query("INSERT INTO shares (token, program_id, version, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&s.token)
        .bind(&id)
        .bind(s.version)
        .bind(&u.id)
        .bind(&s.created_at)
        .bind(&s.expires_at)
        .execute(&st.db)
        .await?;
    Ok((StatusCode::CREATED, Json(with_url(&st, &headers, &s))))
}

async fn revoke(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(token): Path<String>) -> ApiResult<StatusCode> {
    let n = sqlx::query("UPDATE shares SET revoked_at = ? WHERE token = ? AND created_by = ? AND revoked_at IS NULL")
        .bind(util::now())
        .bind(&token)
        .bind(&u.id)
        .execute(&st.db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}

struct Shared {
    name: String,
    machine: String,
    version: i64,
    latest: i64,
    content: String,
    report: Option<String>,
    owner_name: String,
    owner_id: String,
    updated_at: String,
}

/// The shared version, if the link is live (not revoked, not expired, program not deleted).
#[allow(clippy::type_complexity)]
async fn resolve(st: &AppState, token: &str) -> ApiResult<Shared> {
    let row: Option<(String, Option<i64>, Option<String>, Option<String>, String, String, i64, Option<String>, String, String, String)> = sqlx::query_as(
        "SELECT s.program_id, s.version, s.expires_at, s.revoked_at, p.name, p.machine, p.current_version, p.deleted_at, u.name, u.id, p.updated_at
         FROM shares s JOIN programs p ON p.id = s.program_id JOIN users u ON u.id = p.owner_id WHERE s.token = ?",
    )
    .bind(token)
    .fetch_optional(&st.db)
    .await?;
    let (pid, pinned, expires, revoked, name, machine, current, deleted, owner_name, owner_id, updated_at) = row.ok_or(AppError::NotFound)?;
    if revoked.is_some() || deleted.is_some() || expires.is_some_and(|e| e < util::now()) {
        return Err(AppError::NotFound);
    }
    let version = pinned.unwrap_or(current);
    let (content, report): (String, Option<String>) = sqlx::query_as("SELECT content, report FROM program_versions WHERE program_id = ? AND version = ?")
        .bind(&pid)
        .bind(version)
        .fetch_optional(&st.db)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Shared { name, machine, version, latest: current, content, report, owner_name, owner_id, updated_at })
}

async fn public(State(st): State<AppState>, Path(token): Path<String>) -> ApiResult<Json<Value>> {
    let s = resolve(&st, &token).await?;
    Ok(Json(json!({
        "name": s.name, "machine": s.machine, "version": s.version, "latest_version": s.latest,
        "content": s.content, "report": s.report.and_then(|r| serde_json::from_str::<Value>(&r).ok()),
        "owner_name": s.owner_name, "updated_at": s.updated_at,
    })))
}

#[derive(Deserialize)]
struct Enc {
    encoding: Option<String>,
}

async fn public_download(State(st): State<AppState>, Path(token): Path<String>, Query(q): Query<Enc>) -> ApiResult<Response> {
    let s = resolve(&st, &token).await?;
    // numbered with the owner's tool table, as the owner would download it
    let listing = library::listing(&st, &s.owner_id, &s.machine, &s.content).await?;
    super::programs::file_response(&s.name, listing, q.encoding.as_deref())
}

/// Copies the shared program into the caller's library under a free name.
async fn copy(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(token): Path<String>) -> ApiResult<(StatusCode, Json<library::ProgramSummary>)> {
    let s = resolve(&st, &token).await?;
    let name = library::free_name(&st, &u.id, &s.machine, &s.name).await?;
    let msg = format!("copied from {}'s {} v{}", s.owner_name, s.name, s.version);
    let w = Write { content: &s.content, message: Some(&msg), source: "import", author: &u.id };
    let p = library::create(&st, &u.id, &s.machine, &name, None, w).await?;
    library::adopt_tools(&st, &u.id, &s.machine, &s.content).await?;
    Ok((StatusCode::CREATED, Json(p)))
}
