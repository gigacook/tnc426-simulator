//! Local mode: the desktop shell (Tauri) runs this server in-process on loopback for one operator.
//!
//! There is no sign-in form in local mode. The shell makes sure a local account exists
//! (`ensure_local_user`), asks for a one-time link (`issue_sign_in_link`) and opens its window on it;
//! `GET /api/v1/auth/once?t=…` turns the link into the ordinary session cookie and redirects to `/`.
//! A link is random (256 bit), lives 2 minutes, works once, and only its SHA-256 is kept (in memory).

use std::time::{Duration, Instant};

use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use serde::Deserialize;

use crate::auth::{self, User};
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::util;

/// The local operator's e-mail. `.invalid` is reserved (RFC 2606): it can never be a real address.
pub const LOCAL_EMAIL: &str = "operator@local.invalid";
const LINK_TTL: Duration = Duration::from_secs(120);

/// The local operator account, created on first start (admin, random password nobody knows).
pub async fn ensure_local_user(st: &AppState) -> ApiResult<User> {
    let found: Option<User> =
        sqlx::query_as("SELECT id, email, name, role, disabled, created_at FROM users WHERE email = ?").bind(LOCAL_EMAIL).fetch_optional(&st.db).await?;
    match found {
        Some(u) => Ok(u),
        None => auth::create_user(&st.db, LOCAL_EMAIL, "Local operator", &util::token(32), "admin").await,
    }
}

/// A one-time sign-in link for `user_id`: open `/api/v1/auth/once?t=<token>` within 2 minutes.
pub fn issue_sign_in_link(st: &AppState, user_id: &str) -> String {
    let token = util::token(32);
    let mut m = st.sign_in_links.lock().unwrap();
    m.retain(|_, (_, t)| t.elapsed() < LINK_TTL);
    m.insert(util::sha256_hex(token.as_bytes()), (user_id.to_owned(), Instant::now()));
    token
}

#[derive(Deserialize)]
pub struct Once {
    t: String,
}

pub async fn redeem(State(st): State<AppState>, headers: HeaderMap, Query(q): Query<Once>) -> ApiResult<Response> {
    let entry = st.sign_in_links.lock().unwrap().remove(&util::sha256_hex(q.t.as_bytes()));
    let Some((user_id, _)) = entry.filter(|(_, t)| t.elapsed() < LINK_TTL) else {
        return Err(AppError::Unauthorized);
    };
    let ua = headers.get(header::USER_AGENT).and_then(|v| v.to_str().ok());
    let token = auth::create_session(&st, &user_id, ua).await?;
    Ok((StatusCode::SEE_OTHER, [(header::SET_COOKIE, auth::session_cookie(&st, &token)), (header::LOCATION, "/".parse().unwrap())]).into_response())
}
