use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth::CurrentUser;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::util;

pub fn routes() -> Router<AppState> {
    Router::new().route("/projects", get(list).post(create)).route("/projects/{id}", patch(rename).delete(remove))
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Project {
    id: String,
    name: String,
    created_at: String,
    updated_at: String,
    program_count: i64,
}

async fn list(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> ApiResult<Json<Vec<Project>>> {
    Ok(Json(
        sqlx::query_as(
            "SELECT j.id, j.name, j.created_at, j.updated_at,
               (SELECT COUNT(*) FROM programs p WHERE p.project_id = j.id AND p.deleted_at IS NULL) AS program_count
             FROM projects j WHERE j.owner_id = ? ORDER BY j.name COLLATE NOCASE",
        )
        .bind(&u.id)
        .fetch_all(&st.db)
        .await?,
    ))
}

#[derive(Deserialize)]
struct Name {
    name: String,
}

fn clean_name(n: &str) -> ApiResult<String> {
    let n = n.trim();
    if n.is_empty() || n.chars().count() > 80 {
        return Err(AppError::bad("project name must be 1-80 characters"));
    }
    Ok(n.to_owned())
}

async fn fetch(st: &AppState, owner: &str, id: &str) -> ApiResult<Project> {
    sqlx::query_as(
        "SELECT j.id, j.name, j.created_at, j.updated_at,
           (SELECT COUNT(*) FROM programs p WHERE p.project_id = j.id AND p.deleted_at IS NULL) AS program_count
         FROM projects j WHERE j.id = ? AND j.owner_id = ?",
    )
    .bind(id)
    .bind(owner)
    .fetch_optional(&st.db)
    .await?
    .ok_or(AppError::NotFound)
}

async fn create(State(st): State<AppState>, CurrentUser(u): CurrentUser, Json(b): Json<Name>) -> ApiResult<(StatusCode, Json<Project>)> {
    let id = util::new_id();
    let now = util::now();
    sqlx::query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(&id)
        .bind(&u.id)
        .bind(clean_name(&b.name)?)
        .bind(&now)
        .bind(&now)
        .execute(&st.db)
        .await?;
    Ok((StatusCode::CREATED, Json(fetch(&st, &u.id, &id).await?)))
}

async fn rename(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>, Json(b): Json<Name>) -> ApiResult<Json<Project>> {
    let n = sqlx::query("UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND owner_id = ?")
        .bind(clean_name(&b.name)?)
        .bind(util::now())
        .bind(&id)
        .bind(&u.id)
        .execute(&st.db)
        .await?
        .rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(Json(fetch(&st, &u.id, &id).await?))
}

/// The project goes; its programs stay in the library, outside any project.
async fn remove(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>) -> ApiResult<StatusCode> {
    let n = sqlx::query("DELETE FROM projects WHERE id = ? AND owner_id = ?").bind(&id).bind(&u.id).execute(&st.db).await?.rows_affected();
    if n == 0 {
        return Err(AppError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
