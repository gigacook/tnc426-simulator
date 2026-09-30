use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};

use crate::auth::{self, AdminUser, User};
use crate::error::{ApiResult, AppError};
use crate::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new().route("/admin/users", get(list).post(create)).route("/admin/users/{id}", patch(update))
}

#[derive(Serialize, sqlx::FromRow)]
struct Row {
    id: String,
    email: String,
    name: String,
    role: String,
    disabled: bool,
    created_at: String,
    programs: i64,
    last_seen: Option<String>,
}

async fn list(State(st): State<AppState>, _: AdminUser) -> ApiResult<Json<Vec<Row>>> {
    Ok(Json(
        sqlx::query_as(
            "SELECT u.id, u.email, u.name, u.role, u.disabled, u.created_at,
               (SELECT COUNT(*) FROM programs p WHERE p.owner_id = u.id AND p.deleted_at IS NULL) AS programs,
               (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
             FROM users u ORDER BY u.created_at",
        )
        .fetch_all(&st.db)
        .await?,
    ))
}

#[derive(Deserialize)]
struct Create {
    email: String,
    name: String,
    password: String,
    #[serde(default)]
    admin: bool,
}

async fn create(State(st): State<AppState>, _: AdminUser, Json(b): Json<Create>) -> ApiResult<(StatusCode, Json<User>)> {
    let u = auth::create_user(&st.db, &b.email, &b.name, &b.password, if b.admin { "admin" } else { "user" }).await?;
    Ok((StatusCode::CREATED, Json(u)))
}

#[derive(Deserialize)]
struct Update {
    name: Option<String>,
    role: Option<String>,
    disabled: Option<bool>,
    password: Option<String>,
}

/// Rename, change role, disable (signs them out) or set a new password. The last admin stays an admin.
async fn update(State(st): State<AppState>, AdminUser(me): AdminUser, Path(id): Path<String>, Json(b): Json<Update>) -> ApiResult<Json<Row>> {
    let (role, disabled): (String, bool) = sqlx::query_as("SELECT role, disabled FROM users WHERE id = ?").bind(&id).fetch_optional(&st.db).await?.ok_or(AppError::NotFound)?;
    let new_role = b.role.clone().unwrap_or(role.clone());
    if new_role != "admin" && new_role != "user" {
        return Err(AppError::bad("role must be admin or user"));
    }
    let new_disabled = b.disabled.unwrap_or(disabled);
    if role == "admin" && (new_role != "admin" || new_disabled) {
        let admins: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users WHERE role = 'admin' AND disabled = 0").fetch_one(&st.db).await?;
        if admins <= 1 {
            return Err(AppError::bad("this is the last admin"));
        }
    }
    if id == me.id && new_disabled {
        return Err(AppError::bad("you cannot disable yourself"));
    }
    if let Some(n) = &b.name {
        let n = n.trim();
        if n.is_empty() || n.chars().count() > 80 {
            return Err(AppError::bad("name must be 1-80 characters"));
        }
        sqlx::query("UPDATE users SET name = ? WHERE id = ?").bind(n).bind(&id).execute(&st.db).await?;
    }
    sqlx::query("UPDATE users SET role = ?, disabled = ? WHERE id = ?").bind(&new_role).bind(new_disabled).bind(&id).execute(&st.db).await?;
    if let Some(pw) = b.password {
        auth::check_password_rules(&pw)?;
        let h = auth::hash_password(pw).await?;
        sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?").bind(h).bind(&id).execute(&st.db).await?;
    }
    if new_disabled || b.role.is_some() {
        sqlx::query("DELETE FROM sessions WHERE user_id = ? AND ? = 1").bind(&id).bind(new_disabled).execute(&st.db).await?;
    }
    Ok(Json(
        sqlx::query_as(
            "SELECT u.id, u.email, u.name, u.role, u.disabled, u.created_at,
               (SELECT COUNT(*) FROM programs p WHERE p.owner_id = u.id AND p.deleted_at IS NULL) AS programs,
               (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id = u.id) AS last_seen
             FROM users u WHERE u.id = ?",
        )
        .bind(&id)
        .fetch_one(&st.db)
        .await?,
    ))
}
