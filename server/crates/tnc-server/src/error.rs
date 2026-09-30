use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::{json, Value};

/// Every API error is `{"error": {"code": "...", "message": "...", ...details}}` with a fitting status.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(String),
    #[error("sign in first")]
    Unauthorized,
    #[error("{0}")]
    Forbidden(String),
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    Conflict(String, Value),
    #[error("{0}")]
    PaymentRequired(String),
    #[error("{0}")]
    TooMany(String),
    #[error("{0}")]
    Unavailable(String),
    #[error("{0}")]
    Upstream(String),
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub type ApiResult<T> = Result<T, AppError>;

impl AppError {
    pub fn bad(msg: impl Into<String>) -> Self {
        AppError::BadRequest(msg.into())
    }
    pub fn conflict(msg: impl Into<String>, details: Value) -> Self {
        AppError::Conflict(msg.into(), details)
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        match e {
            sqlx::Error::RowNotFound => AppError::NotFound,
            sqlx::Error::Database(d) if d.is_unique_violation() => AppError::conflict("already exists", Value::Null),
            e => AppError::Internal(e.into()),
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.into())
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            AppError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            AppError::Unauthorized => (StatusCode::UNAUTHORIZED, "unauthorized"),
            AppError::Forbidden(_) => (StatusCode::FORBIDDEN, "forbidden"),
            AppError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            AppError::Conflict(..) => (StatusCode::CONFLICT, "conflict"),
            AppError::PaymentRequired(_) => (StatusCode::PAYMENT_REQUIRED, "budget_exceeded"),
            AppError::TooMany(_) => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
            AppError::Unavailable(_) => (StatusCode::SERVICE_UNAVAILABLE, "unavailable"),
            AppError::Upstream(_) => (StatusCode::BAD_GATEWAY, "upstream"),
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        };
        let message = match &self {
            AppError::Internal(e) => {
                tracing::error!(error = ?e, "internal error");
                "internal error".to_owned()
            }
            e => e.to_string(),
        };
        let mut body = json!({ "error": { "code": code, "message": message } });
        if let AppError::Conflict(_, Value::Object(d)) = &self {
            for (k, v) in d {
                body["error"][k] = v.clone();
            }
        }
        (status, Json(body)).into_response()
    }
}
