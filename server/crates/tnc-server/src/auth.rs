//! Accounts and sessions.
//!
//! A session is a random token; the database keeps only its SHA-256. Browsers carry it in an
//! HttpOnly SameSite=Lax cookie, other clients (desktop shell, scripts) as `Authorization: Bearer`.
//! Cookie-authenticated writes must come from our own origin (Origin / Sec-Fetch-Site check), which
//! together with SameSite=Lax closes cross-site request forgery.

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use axum::http::{header, HeaderMap, HeaderValue, Method};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::util;

pub const COOKIE: &str = "tnc_session";

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
    pub role: String,
    #[serde(skip)]
    pub disabled: bool,
    pub created_at: String,
}

impl User {
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }
}

pub async fn hash_password(pw: String) -> ApiResult<String> {
    tokio::task::spawn_blocking(move || {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default().hash_password(pw.as_bytes(), &salt).map(|h| h.to_string())
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))?
    .map_err(|e| AppError::Internal(anyhow::anyhow!("hash: {e}")))
}

pub async fn verify_password(pw: String, hash: String) -> bool {
    tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash).is_ok_and(|h| Argon2::default().verify_password(pw.as_bytes(), &h).is_ok())
    })
    .await
    .unwrap_or(false)
}

/// A real hash of a random password, to verify against when the e-mail is unknown (same timing).
pub fn dummy_hash() -> &'static str {
    static H: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| {
        let salt = SaltString::generate(&mut OsRng);
        Argon2::default().hash_password(util::token(16).as_bytes(), &salt).map(|h| h.to_string()).unwrap_or_default()
    });
    &H
}

pub fn check_password_rules(pw: &str) -> ApiResult<()> {
    if pw.chars().count() < 8 {
        return Err(AppError::bad("password must be at least 8 characters"));
    }
    if pw.len() > 256 {
        return Err(AppError::bad("password is too long"));
    }
    Ok(())
}

pub fn normalize_email(e: &str) -> ApiResult<String> {
    let e = e.trim().to_lowercase();
    let ok = e.len() <= 254 && e.split_once('@').is_some_and(|(a, b)| !a.is_empty() && b.contains('.') && !b.starts_with('.'));
    if !ok {
        return Err(AppError::bad("that is not an e-mail address"));
    }
    Ok(e)
}

pub async fn create_user(db: &SqlitePool, email: &str, name: &str, password: &str, role: &str) -> ApiResult<User> {
    let email = normalize_email(email)?;
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(AppError::bad("name must be 1-80 characters"));
    }
    check_password_rules(password)?;
    let hash = hash_password(password.to_owned()).await?;
    let user = User { id: util::new_id(), email, name: name.to_owned(), role: role.to_owned(), disabled: false, created_at: util::now() };
    sqlx::query("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&user.id)
        .bind(&user.email)
        .bind(&user.name)
        .bind(&hash)
        .bind(&user.role)
        .bind(&user.created_at)
        .execute(db)
        .await
        .map_err(|e| match AppError::from(e) {
            AppError::Conflict(..) => AppError::conflict("an account with that e-mail exists", serde_json::Value::Null),
            e => e,
        })?;
    Ok(user)
}

pub async fn user_count(db: &SqlitePool) -> ApiResult<i64> {
    Ok(sqlx::query_scalar("SELECT COUNT(*) FROM users").fetch_one(db).await?)
}

/// New session; returns the token (shown to the client once, never stored).
pub async fn create_session(st: &AppState, user_id: &str, user_agent: Option<&str>) -> ApiResult<String> {
    let token = util::token(32);
    sqlx::query("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)")
        .bind(util::sha256_hex(token.as_bytes()))
        .bind(user_id)
        .bind(util::now())
        .bind(util::days_from_now(st.cfg.session_days))
        .bind(user_agent.map(|s| s.chars().take(200).collect::<String>()))
        .execute(&st.db)
        .await?;
    // expired sessions go when anyone signs in: no background job to forget
    sqlx::query("DELETE FROM sessions WHERE expires_at < ?").bind(util::now()).execute(&st.db).await?;
    Ok(token)
}

pub async fn delete_session(db: &SqlitePool, token: &str) -> ApiResult<()> {
    sqlx::query("DELETE FROM sessions WHERE token_hash = ?").bind(util::sha256_hex(token.as_bytes())).execute(db).await?;
    Ok(())
}

pub fn session_cookie(st: &AppState, token: &str) -> HeaderValue {
    let secure = if st.cfg.secure() { "; Secure" } else { "" };
    let max_age = st.cfg.session_days * 86400;
    HeaderValue::from_str(&format!("{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}{secure}")).unwrap()
}

pub fn clear_cookie(st: &AppState) -> HeaderValue {
    let secure = if st.cfg.secure() { "; Secure" } else { "" };
    HeaderValue::from_str(&format!("{COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0{secure}")).unwrap()
}

enum Via {
    Cookie,
    Bearer,
}

/// The session token from `Authorization: Bearer` or the cookie.
pub fn session_token(headers: &HeaderMap) -> Option<String> {
    token_from(headers).map(|(t, _)| t)
}

fn token_from(headers: &HeaderMap) -> Option<(String, Via)> {
    if let Some(v) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        if let Some(t) = v.strip_prefix("Bearer ") {
            return Some((t.trim().to_owned(), Via::Bearer));
        }
    }
    for v in headers.get_all(header::COOKIE) {
        let Ok(s) = v.to_str() else { continue };
        for part in s.split(';') {
            if let Some((k, val)) = part.trim().split_once('=') {
                if k == COOKIE && !val.is_empty() {
                    return Some((val.to_owned(), Via::Cookie));
                }
            }
        }
    }
    None
}

/// A cookie-authenticated write must come from this site.
fn same_origin(st: &AppState, parts: &Parts) -> bool {
    if matches!(parts.method, Method::GET | Method::HEAD | Method::OPTIONS) {
        return true;
    }
    let h = &parts.headers;
    if let Some(origin) = h.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if let Some(public) = &st.cfg.public_url {
            if origin.trim_end_matches('/') == public.trim_end_matches('/') {
                return true;
            }
        }
        let host = h.get(header::HOST).and_then(|v| v.to_str().ok()).unwrap_or("");
        let bare = origin.strip_prefix("https://").or_else(|| origin.strip_prefix("http://")).unwrap_or("");
        return !host.is_empty() && bare == host;
    }
    // no Origin: old browser or not a browser; a modern browser still tells us the fetch site
    h.get("sec-fetch-site").and_then(|v| v.to_str().ok()).is_none_or(|s| s == "same-origin" || s == "none")
}

async fn lookup(st: &AppState, token: &str) -> ApiResult<Option<User>> {
    Ok(sqlx::query_as::<_, User>(
        "SELECT u.id, u.email, u.name, u.role, u.disabled, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.disabled = 0",
    )
    .bind(util::sha256_hex(token.as_bytes()))
    .bind(util::now())
    .fetch_optional(&st.db)
    .await?)
}

/// The signed-in user. Rejects with 401 (no or bad session) or 403 (cross-site write).
pub struct CurrentUser(pub User);

impl FromRequestParts<AppState> for CurrentUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, st: &AppState) -> Result<Self, Self::Rejection> {
        let (token, via) = token_from(&parts.headers).ok_or(AppError::Unauthorized)?;
        if matches!(via, Via::Cookie) && !same_origin(st, parts) {
            return Err(AppError::Forbidden("cross-site request refused".into()));
        }
        lookup(st, &token).await?.map(CurrentUser).ok_or(AppError::Unauthorized)
    }
}

/// A signed-in admin.
pub struct AdminUser(pub User);

impl FromRequestParts<AppState> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, st: &AppState) -> Result<Self, Self::Rejection> {
        let CurrentUser(u) = CurrentUser::from_request_parts(parts, st).await?;
        if !u.is_admin() {
            return Err(AppError::Forbidden("admins only".into()));
        }
        Ok(AdminUser(u))
    }
}

/// The signed-in user if there is one; never rejects.
pub struct MaybeUser(pub Option<User>);

impl FromRequestParts<AppState> for MaybeUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, st: &AppState) -> Result<Self, Self::Rejection> {
        Ok(MaybeUser(CurrentUser::from_request_parts(parts, st).await.ok().map(|c| c.0)))
    }
}
