use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{self, CurrentUser, User};
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::util;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/auth/signup", post(signup))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/password", post(change_password))
        .route("/me", get(me))
        .route("/settings", get(get_settings).put(put_settings))
}

#[derive(Deserialize)]
struct Signup {
    email: String,
    name: String,
    password: String,
}

fn signed_in(st: &AppState, user: &User, token: &str, status: StatusCode) -> Response {
    let mut h = HeaderMap::new();
    h.insert(header::SET_COOKIE, auth::session_cookie(st, token));
    (status, h, Json(json!({ "user": user, "token": token }))).into_response()
}

/// The first account is the admin and can always be made; after that only with TNC_ALLOW_SIGNUP.
async fn signup(State(st): State<AppState>, headers: HeaderMap, Json(b): Json<Signup>) -> ApiResult<Response> {
    let first = auth::user_count(&st.db).await? == 0;
    if !first && !st.cfg.allow_signup {
        return Err(AppError::Forbidden("sign-up is closed; ask the admin for an account".into()));
    }
    let user = auth::create_user(&st.db, &b.email, &b.name, &b.password, if first { "admin" } else { "user" }).await?;
    let ua = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok());
    let token = auth::create_session(&st, &user.id, ua).await?;
    Ok(signed_in(&st, &user, &token, StatusCode::CREATED))
}

#[derive(Deserialize)]
struct Login {
    email: String,
    password: String,
}

async fn login(State(st): State<AppState>, headers: HeaderMap, Json(b): Json<Login>) -> ApiResult<Response> {
    let email = b.email.trim().to_lowercase();
    if st.limiter.blocked(&email) {
        return Err(AppError::TooMany("too many failed sign-ins; wait 15 minutes".into()));
    }
    let row: Option<(String, String, bool)> = sqlx::query_as("SELECT id, password_hash, disabled FROM users WHERE email = ?")
        .bind(&email)
        .fetch_optional(&st.db)
        .await?;
    // verify against a dummy hash when there is no such user, so timing does not tell which e-mails exist
    let (id, hash, disabled) = row.unwrap_or_else(|| (String::new(), auth::dummy_hash().to_owned(), true));
    let good = auth::verify_password(b.password, hash).await;
    if !good || disabled || id.is_empty() {
        st.limiter.fail(&email);
        return Err(AppError::Unauthorized);
    }
    st.limiter.clear(&email);
    let user: User = sqlx::query_as("SELECT id, email, name, role, disabled, created_at FROM users WHERE id = ?").bind(&id).fetch_one(&st.db).await?;
    let ua = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok());
    let token = auth::create_session(&st, &user.id, ua).await?;
    Ok(signed_in(&st, &user, &token, StatusCode::OK))
}

async fn logout(State(st): State<AppState>, headers: HeaderMap) -> ApiResult<Response> {
    if let Some(t) = auth::session_token(&headers) {
        auth::delete_session(&st.db, &t).await?;
    }
    let mut h = HeaderMap::new();
    h.insert(header::SET_COOKIE, auth::clear_cookie(&st));
    Ok((StatusCode::NO_CONTENT, h).into_response())
}

async fn me(CurrentUser(u): CurrentUser) -> Json<User> {
    Json(u)
}

#[derive(Deserialize)]
struct ChangePassword {
    current: String,
    new: String,
}

/// Changing the password signs out every other session.
async fn change_password(State(st): State<AppState>, headers: HeaderMap, CurrentUser(u): CurrentUser, Json(b): Json<ChangePassword>) -> ApiResult<StatusCode> {
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = ?").bind(&u.id).fetch_one(&st.db).await?;
    if !auth::verify_password(b.current, hash).await {
        return Err(AppError::Forbidden("current password is wrong".into()));
    }
    auth::check_password_rules(&b.new)?;
    let h = auth::hash_password(b.new).await?;
    sqlx::query("UPDATE users SET password_hash = ? WHERE id = ?").bind(h).bind(&u.id).execute(&st.db).await?;
    let keep = auth::session_token(&headers).map(|t| util::sha256_hex(t.as_bytes())).unwrap_or_default();
    sqlx::query("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").bind(&u.id).bind(keep).execute(&st.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_settings(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> ApiResult<Json<Value>> {
    let data: Option<String> = sqlx::query_scalar("SELECT data FROM settings WHERE owner_id = ?").bind(&u.id).fetch_optional(&st.db).await?;
    Ok(Json(data.map(|d| serde_json::from_str(&d)).transpose()?.unwrap_or_else(|| json!({}))))
}

/// Free-form preferences (a JSON object, 64 kB at most) shared by the web app and the simulator.
async fn put_settings(State(st): State<AppState>, CurrentUser(u): CurrentUser, Json(v): Json<Value>) -> ApiResult<Json<Value>> {
    if !v.is_object() {
        return Err(AppError::bad("settings must be a JSON object"));
    }
    let s = serde_json::to_string(&v)?;
    if s.len() > 64 << 10 {
        return Err(AppError::bad("settings are larger than 64 kB"));
    }
    sqlx::query("INSERT INTO settings (owner_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (owner_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
        .bind(&u.id)
        .bind(s)
        .bind(util::now())
        .execute(&st.db)
        .await?;
    Ok(Json(v))
}

