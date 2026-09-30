//! `/api/ai/v1` — an OpenRouter-compatible proxy. OpenRouter only, never another provider.
//!
//! The browser (the simulator's ai.js or the web app) calls these paths exactly as it would call
//! `https://openrouter.ai/api/v1`, with its session instead of a key. The server adds its key, caps
//! `max_tokens`, enforces the model allow-list and a monthly budget per user, streams the answer back
//! untouched, and records the cost OpenRouter reports.

use std::time::{Duration, Instant};

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::StreamExt;
use serde_json::{json, Value};

use crate::auth::CurrentUser;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::util;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/chat/completions", post(chat))
        .route("/key", get(key))
        .route("/models", get(models))
        .route("/usage", get(usage))
}

fn key_of(st: &AppState) -> ApiResult<&str> {
    st.cfg
        .openrouter_api_key
        .as_deref()
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| AppError::Unavailable("AI is off on this server (no OPENROUTER_API_KEY)".into()))
}

async fn spent(st: &AppState, user: &str) -> ApiResult<(f64, i64)> {
    let (cost, n): (Option<f64>, i64) = sqlx::query_as("SELECT SUM(cost), COUNT(*) FROM ai_usage WHERE user_id = ? AND created_at >= ?")
        .bind(user)
        .bind(util::month_start())
        .fetch_one(&st.db)
        .await?;
    Ok((cost.unwrap_or(0.0), n))
}

/// Shaped like OpenRouter's `GET /key`, so ai.js `testKey` works unchanged.
async fn key(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> ApiResult<Json<Value>> {
    key_of(&st)?;
    let (cost, _) = spent(&st, &u.id).await?;
    let limit = st.cfg.ai_monthly_budget_usd;
    Ok(Json(json!({ "data": {
        "label": "TNC server key (your monthly budget)",
        "usage": cost, "limit": limit, "limit_remaining": (limit - cost).max(0.0), "is_free_tier": false,
    }})))
}

async fn usage(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> ApiResult<Json<Value>> {
    let (cost, calls) = spent(&st, &u.id).await?;
    Ok(Json(json!({
        "month_start": util::month_start(), "cost_usd": cost, "calls": calls,
        "budget_usd": st.cfg.ai_monthly_budget_usd, "enabled": st.cfg.ai_enabled(),
    })))
}

/// OpenRouter's public model list, cached for an hour, narrowed to the allow-list if there is one.
async fn models(State(st): State<AppState>, _: CurrentUser) -> ApiResult<Response> {
    let cached = st.models_cache.lock().unwrap().as_ref().filter(|(t, _)| t.elapsed() < Duration::from_secs(3600)).map(|(_, b)| b.clone());
    let body = match cached {
        Some(b) => b,
        None => {
            let res = st.http.get(format!("{}/models", st.cfg.openrouter_base)).send().await.map_err(|e| AppError::Upstream(e.to_string()))?;
            if !res.status().is_success() {
                return Err(AppError::Upstream(format!("OpenRouter answered {}", res.status())));
            }
            let b = res.bytes().await.map_err(|e| AppError::Upstream(e.to_string()))?;
            *st.models_cache.lock().unwrap() = Some((Instant::now(), b.clone()));
            b
        }
    };
    let allow = st.cfg.ai_models();
    if allow.is_empty() {
        return Ok(([(header::CONTENT_TYPE, "application/json")], body).into_response());
    }
    let mut v: Value = serde_json::from_slice(&body)?;
    if let Some(list) = v.get_mut("data").and_then(Value::as_array_mut) {
        list.retain(|m| m.get("id").and_then(Value::as_str).is_some_and(|id| allow.iter().any(|a| a == id)));
    }
    Ok(Json(v).into_response())
}

async fn chat(State(st): State<AppState>, CurrentUser(u): CurrentUser, body: Bytes) -> ApiResult<Response> {
    let key = key_of(&st)?.to_owned();
    let mut req: Value = serde_json::from_slice(&body).map_err(|_| AppError::bad("body must be JSON"))?;
    let obj = req.as_object_mut().ok_or_else(|| AppError::bad("body must be a JSON object"))?;
    let model = obj.get("model").and_then(Value::as_str).unwrap_or(&st.cfg.ai_default_model).to_owned();
    let allow = st.cfg.ai_models();
    if !allow.is_empty() && !allow.contains(&model) {
        return Err(AppError::Forbidden(format!("model {model} is not allowed on this server; allowed: {}", allow.join(", "))));
    }
    obj.insert("model".into(), json!(model));
    let cap = st.cfg.ai_max_tokens;
    if !obj.get("max_tokens").and_then(Value::as_u64).is_some_and(|n| n <= cap) {
        obj.insert("max_tokens".into(), json!(cap));
    }
    obj.insert("usage".into(), json!({ "include": true }));
    let stream = obj.get("stream").and_then(Value::as_bool).unwrap_or(false);

    let (cost, _) = spent(&st, &u.id).await?;
    if cost >= st.cfg.ai_monthly_budget_usd {
        return Err(AppError::PaymentRequired(format!(
            "MONTHLY AI BUDGET USED UP (US${cost:.2} of US${:.2}); it resets on the 1st",
            st.cfg.ai_monthly_budget_usd
        )));
    }

    let referer = st.cfg.public_url.clone().unwrap_or_else(|| "https://gigacook.github.io/tnc426-simulator/".into());
    let upstream = st
        .http
        .post(format!("{}/chat/completions", st.cfg.openrouter_base))
        .bearer_auth(key)
        .header("HTTP-Referer", referer)
        .header("X-Title", "TNC 426 Simulator")
        .json(&req)
        .send()
        .await
        .map_err(|e| AppError::Upstream(e.to_string()))?;
    let status = upstream.status();

    if !stream || !status.is_success() {
        let bytes = upstream.bytes().await.map_err(|e| AppError::Upstream(e.to_string()))?;
        let mut scan = UsageScan::default();
        if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
            scan.take(&v);
        }
        record(&st, &u.id, &model, &scan, status.as_u16()).await;
        let code = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
        return Ok((code, [(header::CONTENT_TYPE, "application/json")], bytes).into_response());
    }

    // Stream: forward every chunk as it arrives; watch the SSE lines for the final usage record.
    let (tx, rx) = tokio::sync::mpsc::channel::<Result<Bytes, std::io::Error>>(64);
    let st2 = st.clone();
    let user = u.id.clone();
    tokio::spawn(async move {
        let mut s = upstream.bytes_stream();
        let mut scan = UsageScan::default();
        while let Some(chunk) = s.next().await {
            match chunk {
                Ok(b) => {
                    scan.feed(&b);
                    if tx.send(Ok(b)).await.is_err() {
                        break; // the browser went away (cancel): stop reading, OpenRouter stops billing
                    }
                }
                Err(e) => {
                    let _ = tx.send(Err(std::io::Error::other(e))).await;
                    break;
                }
            }
        }
        scan.finish();
        record(&st2, &user, &model, &scan, 200).await;
    });
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header("X-Accel-Buffering", "no")
        .body(Body::from_stream(tokio_stream::wrappers::ReceiverStream::new(rx)))
        .unwrap())
}

async fn record(st: &AppState, user: &str, model: &str, scan: &UsageScan, status: u16) {
    let r = sqlx::query(
        "INSERT INTO ai_usage (id, user_id, model, prompt_tokens, completion_tokens, cost, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(util::new_id())
    .bind(user)
    .bind(model)
    .bind(scan.prompt_tokens)
    .bind(scan.completion_tokens)
    .bind(scan.cost)
    .bind(status as i64)
    .bind(util::now())
    .execute(&st.db)
    .await;
    if let Err(e) = r {
        tracing::error!("could not record AI usage: {e}");
    }
}

/// Finds OpenRouter's `usage` object in an SSE stream (`data: {...}` lines) or a JSON answer.
#[derive(Default, Debug)]
pub struct UsageScan {
    buf: Vec<u8>,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub cost: f64,
}

impl UsageScan {
    pub fn feed(&mut self, chunk: &[u8]) {
        self.buf.extend_from_slice(chunk);
        while let Some(i) = self.buf.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.buf.drain(..=i).collect();
            self.line(&line);
        }
    }
    pub fn finish(&mut self) {
        let rest = std::mem::take(&mut self.buf);
        self.line(&rest);
    }
    fn line(&mut self, line: &[u8]) {
        let Ok(s) = std::str::from_utf8(line) else { return };
        let Some(data) = s.trim().strip_prefix("data:") else { return };
        // cheap filter: only the chunk(s) carrying usage are parsed
        if !data.contains("\"usage\"") {
            return;
        }
        if let Ok(v) = serde_json::from_str::<Value>(data.trim()) {
            self.take(&v);
        }
    }
    fn take(&mut self, v: &Value) {
        if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
            self.prompt_tokens = u.get("prompt_tokens").and_then(Value::as_i64).or(self.prompt_tokens);
            self.completion_tokens = u.get("completion_tokens").and_then(Value::as_i64).or(self.completion_tokens);
            if let Some(c) = u.get("cost").and_then(Value::as_f64) {
                self.cost = c;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::UsageScan;

    #[test]
    fn finds_usage_across_chunk_boundaries() {
        let mut s = UsageScan::default();
        s.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"BEGIN\"}}]}\n\ndata: {\"choices\":[],\"us");
        s.feed(b"age\":{\"prompt_tokens\":120,\"completion_tokens\":30,\"cost\":0.00042}}\n\ndata: [DONE]");
        s.finish();
        assert_eq!(s.prompt_tokens, Some(120));
        assert_eq!(s.completion_tokens, Some(30));
        assert!((s.cost - 0.00042).abs() < 1e-12);
    }
}
