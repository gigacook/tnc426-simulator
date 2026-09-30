use axum::body::Body;
use axum::extract::{Path, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::auth::CurrentUser;
use crate::error::{ApiResult, AppError};
use crate::library::{self, ProgramSummary, Write, SUMMARY_SELECT};
use crate::state::AppState;
use crate::util;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/programs", get(list).post(create))
        .route("/programs/{id}", get(detail).put(save).patch(update).delete(remove))
        .route("/programs/{id}/undelete", post(undelete))
        .route("/programs/{id}/versions", get(versions))
        .route("/programs/{id}/versions/{v}", get(version))
        .route("/programs/{id}/versions/{v}/restore", post(restore))
        .route("/programs/{id}/download", get(download))
        .route("/check", post(check))
}

#[derive(Deserialize)]
struct ListQuery {
    machine: Option<String>,
    project: Option<String>,
    q: Option<String>,
    #[serde(default)]
    trash: bool,
}

async fn list(State(st): State<AppState>, CurrentUser(u): CurrentUser, Query(q): Query<ListQuery>) -> ApiResult<Json<Vec<ProgramSummary>>> {
    let mut sql = format!("{SUMMARY_SELECT} WHERE p.owner_id = ?");
    sql += if q.trash { " AND p.deleted_at IS NOT NULL" } else { " AND p.deleted_at IS NULL" };
    if q.machine.is_some() {
        sql += " AND p.machine = ?";
    }
    match q.project.as_deref() {
        Some("none") => sql += " AND p.project_id IS NULL",
        Some(_) => sql += " AND p.project_id = ?",
        None => {}
    }
    if q.q.is_some() {
        sql += " AND (p.name LIKE ? ESCAPE '\\' OR v.content LIKE ? ESCAPE '\\')";
    }
    sql += " ORDER BY p.updated_at DESC LIMIT 2000";
    let mut query = sqlx::query_as::<_, ProgramSummary>(&sql).bind(&u.id);
    if let Some(m) = &q.machine {
        query = query.bind(m);
    }
    if let Some(p) = q.project.as_deref().filter(|p| *p != "none") {
        query = query.bind(p);
    }
    if let Some(s) = &q.q {
        let like = format!("%{}%", s.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_"));
        query = query.bind(like.clone()).bind(like);
    }
    Ok(Json(query.fetch_all(&st.db).await?))
}

#[derive(Serialize)]
struct Detail {
    #[serde(flatten)]
    program: ProgramSummary,
    content: String,
    report: Option<Value>,
    message: Option<String>,
    source: String,
}

async fn detail_of(st: &AppState, owner: &str, id: &str, version: Option<i64>) -> ApiResult<Detail> {
    let program = library::summary(st, owner, id).await?;
    let v = version.unwrap_or(program.version);
    let row: Option<(String, Option<String>, Option<String>, String)> =
        sqlx::query_as("SELECT content, report, message, source FROM program_versions WHERE program_id = ? AND version = ?")
            .bind(id)
            .bind(v)
            .fetch_optional(&st.db)
            .await?;
    let (content, report, message, source) = row.ok_or(AppError::NotFound)?;
    Ok(Detail { program, content, report: report.and_then(|r| serde_json::from_str(&r).ok()), message, source })
}

async fn detail(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>) -> ApiResult<Json<Detail>> {
    Ok(Json(detail_of(&st, &u.id, &id, None).await?))
}

#[derive(Deserialize)]
struct Create {
    name: String,
    machine: String,
    #[serde(default)]
    content: Option<String>,
    project_id: Option<String>,
    message: Option<String>,
    source: Option<String>,
}

/// A new program. Without content it starts as an empty `BEGIN PGM … END PGM`, as NEW does on the control.
async fn create(State(st): State<AppState>, CurrentUser(u): CurrentUser, Json(b): Json<Create>) -> ApiResult<(StatusCode, Json<Detail>)> {
    let name = tnc_formats::program_name(&b.name);
    let stem = name.trim_end_matches(".H");
    let content = b.content.map(|c| tnc_formats::clean(&c)).unwrap_or_else(|| format!("BEGIN PGM {stem} MM\nEND PGM {stem} MM"));
    let w = Write { content: &content, message: b.message.as_deref(), source: b.source.as_deref().unwrap_or("edit"), author: &u.id };
    let p = library::create(&st, &u.id, &b.machine, &name, b.project_id.as_deref(), w).await?;
    Ok((StatusCode::CREATED, Json(detail_of(&st, &u.id, &p.id, None).await?)))
}

#[derive(Deserialize)]
struct Save {
    content: String,
    base_version: Option<i64>,
    message: Option<String>,
    source: Option<String>,
}

/// Saves the text as a new version. `base_version` (recommended) turns a lost update into a 409.
async fn save(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>, Json(b): Json<Save>) -> ApiResult<Json<Value>> {
    let content = tnc_formats::clean(&b.content);
    let w = Write { content: &content, message: b.message.as_deref(), source: b.source.as_deref().unwrap_or("edit"), author: &u.id };
    let (p, changed) = library::save(&st, &u.id, &id, b.base_version, w).await?;
    let d = detail_of(&st, &u.id, &p.id, None).await?;
    let mut v = serde_json::to_value(d)?;
    v["changed"] = json!(changed);
    Ok(Json(v))
}

#[derive(Deserialize)]
struct Update {
    name: Option<String>,
    /// `null` takes it out of its project; absent leaves it.
    #[serde(default, deserialize_with = "some_or_null")]
    project_id: Option<Option<String>>,
    machine: Option<String>,
}

fn some_or_null<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Option<String>>, D::Error> {
    Ok(Some(Option::deserialize(d)?))
}

/// Rename, move to a project, or move to another machine. Names stay unique per machine.
async fn update(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>, Json(b): Json<Update>) -> ApiResult<Json<ProgramSummary>> {
    let p = library::live(&st, &u.id, &id).await?;
    let name = b.name.as_deref().map(tnc_formats::program_name).unwrap_or(p.name.clone());
    let machine = b.machine.clone().unwrap_or(p.machine.clone());
    library::check_machine(&machine)?;
    if (name != p.name || machine != p.machine) && library::name_taken(&st, &u.id, &machine, &name).await? {
        return Err(AppError::conflict(format!("{name} already exists on the TNC {machine}"), json!({})));
    }
    let project = match b.project_id {
        Some(Some(pid)) => {
            library::project_owned(&st, &u.id, &pid).await?;
            Some(pid)
        }
        Some(None) => None,
        None => p.project_id.clone(),
    };
    sqlx::query("UPDATE programs SET name = ?, machine = ?, project_id = ?, updated_at = ? WHERE id = ?")
        .bind(&name)
        .bind(&machine)
        .bind(&project)
        .bind(util::now())
        .bind(&id)
        .execute(&st.db)
        .await?;
    Ok(Json(library::summary(&st, &u.id, &id).await?))
}

/// To the trash (kept with every version; `undelete` brings it back).
async fn remove(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>) -> ApiResult<StatusCode> {
    library::live(&st, &u.id, &id).await?;
    sqlx::query("UPDATE programs SET deleted_at = ? WHERE id = ?").bind(util::now()).bind(&id).execute(&st.db).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn undelete(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>) -> ApiResult<Json<ProgramSummary>> {
    let p = library::summary(&st, &u.id, &id).await?;
    if p.deleted_at.is_none() {
        return Ok(Json(p));
    }
    if library::name_taken(&st, &u.id, &p.machine, &p.name).await? {
        return Err(AppError::conflict(format!("{} exists again on the TNC {}; rename that one first", p.name, p.machine), json!({})));
    }
    sqlx::query("UPDATE programs SET deleted_at = NULL WHERE id = ?").bind(&id).execute(&st.db).await?;
    Ok(Json(library::summary(&st, &u.id, &id).await?))
}

#[derive(Serialize, sqlx::FromRow)]
struct VersionRow {
    version: i64,
    created_at: String,
    size: i64,
    sha256: String,
    message: Option<String>,
    source: String,
    author: Option<String>,
    ok: Option<bool>,
    error_count: Option<i64>,
    cycle_time: Option<f64>,
}

async fn versions(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>) -> ApiResult<Json<Vec<VersionRow>>> {
    library::summary(&st, &u.id, &id).await?;
    Ok(Json(
        sqlx::query_as(
            "SELECT v.version, v.created_at, v.size, v.sha256, v.message, v.source, u.name AS author, v.ok, v.error_count, v.cycle_time
             FROM program_versions v LEFT JOIN users u ON u.id = v.author_id WHERE v.program_id = ? ORDER BY v.version DESC",
        )
        .bind(&id)
        .fetch_all(&st.db)
        .await?,
    ))
}

async fn version(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path((id, v)): Path<(String, i64)>) -> ApiResult<Json<Detail>> {
    Ok(Json(detail_of(&st, &u.id, &id, Some(v)).await?))
}

/// An old version becomes the newest one; nothing is lost.
async fn restore(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path((id, v)): Path<(String, i64)>) -> ApiResult<Json<Detail>> {
    let old = library::content(&st, &id, v).await?;
    library::live(&st, &u.id, &id).await?;
    let msg = format!("restored version {v}");
    let w = Write { content: &old, message: Some(&msg), source: "restore", author: &u.id };
    library::save(&st, &u.id, &id, None, w).await?;
    Ok(Json(detail_of(&st, &u.id, &id, None).await?))
}

#[derive(Deserialize)]
struct DownloadQuery {
    version: Option<i64>,
    /// "utf8" (default) or "cp1252" — what the control's file transfer reads.
    encoding: Option<String>,
}

/// The numbered TNC listing, as `NAME.H`, CRLF.
async fn download(State(st): State<AppState>, CurrentUser(u): CurrentUser, Path(id): Path<String>, Query(q): Query<DownloadQuery>) -> ApiResult<Response> {
    let p = library::summary(&st, &u.id, &id).await?;
    let text = library::content(&st, &id, q.version.unwrap_or(p.version)).await?;
    let listing = library::listing(&st, &u.id, &p.machine, &text).await?;
    file_response(&p.name, listing, q.encoding.as_deref())
}

pub fn file_response(name: &str, text: String, encoding: Option<&str>) -> ApiResult<Response> {
    let (bytes, charset) = match encoding {
        Some("cp1252") => (
            tnc_formats::encode_cp1252(&text).ok_or_else(|| AppError::bad("the program has characters Windows-1252 cannot hold"))?,
            "windows-1252",
        ),
        _ => (text.into_bytes(), "utf-8"),
    };
    Ok((
        [
            (header::CONTENT_TYPE, format!("text/plain; charset={charset}")),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{name}\"")),
        ],
        Body::from(bytes),
    )
        .into_response())
}

#[derive(Deserialize)]
struct CheckBody {
    content: String,
    #[serde(default = "default_machine")]
    machine: String,
    #[serde(default)]
    listing: bool,
}

fn default_machine() -> String {
    "426".into()
}

/// Runs the interpreter on text without saving it (the operator's tool table applies).
async fn check(State(st): State<AppState>, CurrentUser(u): CurrentUser, Json(b): Json<CheckBody>) -> ApiResult<Json<tnc_engine::Report>> {
    library::check_machine(&b.machine)?;
    library::check_content(&b.content)?;
    library::check(&st, &u.id, &b.machine, &b.content, b.listing)
        .await?
        .map(Json)
        .ok_or_else(|| AppError::Unavailable("the interpreter is not running on this server".into()))
}
