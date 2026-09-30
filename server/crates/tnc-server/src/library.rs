//! The program library: programs, their versions, the interpreter check on every save, tool tables.
//! Route handlers stay thin; everything that writes a program goes through here.

use serde::Serialize;
use serde_json::{json, Value};
use tnc_engine::{Options, Report};
use tnc_formats::Tool;

use crate::error::{ApiResult, AppError};
use crate::state::AppState;
use crate::util;

pub const MAX_PROGRAM_BYTES: usize = 4 << 20;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct ProgramSummary {
    pub id: String,
    pub name: String,
    pub machine: String,
    pub project_id: Option<String>,
    pub version: i64,
    pub created_at: String,
    pub updated_at: String,
    pub size: i64,
    pub ok: Option<bool>,
    pub error_count: Option<i64>,
    pub cycle_time: Option<f64>,
    pub deleted_at: Option<String>,
}

pub const SUMMARY_SELECT: &str = "SELECT p.id, p.name, p.machine, p.project_id, p.current_version AS version, p.created_at, p.updated_at,
    v.size, v.ok, v.error_count, v.cycle_time, p.deleted_at
    FROM programs p JOIN program_versions v ON v.program_id = p.id AND v.version = p.current_version";

pub fn check_machine(m: &str) -> ApiResult<()> {
    if tnc_formats::is_machine(m) {
        Ok(())
    } else {
        Err(AppError::bad(format!("unknown machine {m:?}; known: {}", tnc_formats::MACHINES.join(", "))))
    }
}

pub fn check_content(content: &str) -> ApiResult<()> {
    if content.len() > MAX_PROGRAM_BYTES {
        return Err(AppError::bad(format!("program is larger than {} MB", MAX_PROGRAM_BYTES >> 20)));
    }
    Ok(())
}

pub async fn summary(st: &AppState, owner: &str, id: &str) -> ApiResult<ProgramSummary> {
    sqlx::query_as::<_, ProgramSummary>(&format!("{SUMMARY_SELECT} WHERE p.id = ? AND p.owner_id = ?"))
        .bind(id)
        .bind(owner)
        .fetch_optional(&st.db)
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn live(st: &AppState, owner: &str, id: &str) -> ApiResult<ProgramSummary> {
    let p = summary(st, owner, id).await?;
    if p.deleted_at.is_some() {
        return Err(AppError::NotFound);
    }
    Ok(p)
}

pub async fn by_name(st: &AppState, owner: &str, machine: &str, name: &str) -> ApiResult<Option<ProgramSummary>> {
    Ok(sqlx::query_as::<_, ProgramSummary>(&format!(
        "{SUMMARY_SELECT} WHERE p.owner_id = ? AND p.machine = ? AND p.name = ? AND p.deleted_at IS NULL"
    ))
    .bind(owner)
    .bind(machine)
    .bind(name)
    .fetch_optional(&st.db)
    .await?)
}

pub async fn content(st: &AppState, program_id: &str, version: i64) -> ApiResult<String> {
    sqlx::query_scalar("SELECT content FROM program_versions WHERE program_id = ? AND version = ?")
        .bind(program_id)
        .bind(version)
        .fetch_optional(&st.db)
        .await?
        .ok_or(AppError::NotFound)
}

pub async fn name_taken(st: &AppState, owner: &str, machine: &str, name: &str) -> ApiResult<bool> {
    Ok(by_name(st, owner, machine, name).await?.is_some())
}

/// A free name for `want` on this machine (`_2`, `_3`, … as the control's file manager would need).
pub async fn free_name(st: &AppState, owner: &str, machine: &str, want: &str) -> ApiResult<String> {
    let taken: Vec<String> = sqlx::query_scalar("SELECT name FROM programs WHERE owner_id = ? AND machine = ? AND deleted_at IS NULL")
        .bind(owner)
        .bind(machine)
        .fetch_all(&st.db)
        .await?;
    Ok(tnc_formats::unique_name(want, |n| taken.iter().any(|t| t == n)))
}

/* ---------------- tool tables ---------------- */

pub struct ToolTable {
    pub tools: Vec<Tool>,
    pub holder: String,
    pub updated_at: Option<String>,
}

pub async fn tool_table(st: &AppState, owner: &str, machine: &str) -> ApiResult<ToolTable> {
    let row: Option<(String, String, String)> =
        sqlx::query_as("SELECT tools, holder, updated_at FROM tool_tables WHERE owner_id = ? AND machine = ?")
            .bind(owner)
            .bind(machine)
            .fetch_optional(&st.db)
            .await?;
    Ok(match row {
        Some((tools, holder, at)) => ToolTable { tools: serde_json::from_str(&tools)?, holder, updated_at: Some(at) },
        None => ToolTable { tools: vec![], holder: "ISO50".into(), updated_at: None },
    })
}

pub async fn save_tool_table(st: &AppState, owner: &str, machine: &str, tools: &[Tool], holder: &str) -> ApiResult<()> {
    tnc_formats::validate_tools(tools).map_err(AppError::BadRequest)?;
    if holder != "ISO50" && holder != "SK40" {
        return Err(AppError::bad("holder must be ISO50 or SK40"));
    }
    let mut sorted = tools.to_vec();
    sorted.sort_by_key(|t| t.t);
    sqlx::query(
        "INSERT INTO tool_tables (owner_id, machine, tools, holder, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (owner_id, machine) DO UPDATE SET tools = excluded.tools, holder = excluded.holder, updated_at = excluded.updated_at",
    )
    .bind(owner)
    .bind(machine)
    .bind(serde_json::to_string(&sorted)?)
    .bind(holder)
    .bind(util::now())
    .execute(&st.db)
    .await?;
    Ok(())
}

/// Tools the program calls that neither the built-in nor the operator's table has are added to the
/// operator's table (L = 0, radius from a CAM comment or R3), the way an import grows a control's TOOL.T.
/// Returns how many were added.
pub async fn adopt_tools(st: &AppState, owner: &str, machine: &str, text: &str) -> ApiResult<usize> {
    let Some(engine) = &st.engine else { return Ok(0) };
    let table = tool_table(st, owner, machine).await?;
    let opts = Options { machine: machine.into(), tools: table.tools.clone(), holder: Some(table.holder.clone()), auto_tools: true, listing: false };
    let Ok(report) = engine.check(text.to_owned(), opts).await else { return Ok(0) };
    let known = |t: i64| t == 0 || engine.builtin_tools().iter().any(|b| b.t as i64 == t) || table.tools.iter().any(|b| b.t as i64 == t);
    let mut tools = table.tools.clone();
    let mut added = 0;
    for u in report.stats.tools_used.iter().filter(|u| u.t > 0 && !known(u.t)) {
        if tools.iter().any(|t| t.t as i64 == u.t) {
            continue;
        }
        let name = u.name.clone().filter(|n| !n.is_empty()).unwrap_or_else(|| format!("T{}", u.t));
        tools.push(Tool { t: u.t as u32, name: name.to_uppercase().chars().take(16).collect(), l: 0.0, r: u.r.max(0.0) });
        added += 1;
    }
    if added > 0 {
        save_tool_table(st, owner, machine, &tools, &table.holder).await?;
    }
    Ok(added)
}

/* ---------------- the interpreter ---------------- */

/// The interpreter's report on `text` with the operator's tools. `None` if the engine is unavailable or
/// the run failed (timeout): the program is then stored unchecked, never refused.
pub async fn check(st: &AppState, owner: &str, machine: &str, text: &str, listing: bool) -> ApiResult<Option<Report>> {
    let Some(engine) = &st.engine else { return Ok(None) };
    let table = tool_table(st, owner, machine).await?;
    let opts = Options { machine: machine.into(), tools: table.tools, holder: Some(table.holder), auto_tools: false, listing };
    match engine.check(text.to_owned(), opts).await {
        Ok(r) => Ok(Some(r)),
        Err(e) => {
            tracing::warn!("check failed: {e}");
            Ok(None)
        }
    }
}

/// The numbered listing a control expects (CRLF); the stored text with CRLF if the engine is unavailable.
pub async fn listing(st: &AppState, owner: &str, machine: &str, text: &str) -> ApiResult<String> {
    Ok(match check(st, owner, machine, text, true).await? {
        Some(Report { listing: Some(l), .. }) => l,
        _ => text.replace('\r', "").replace('\n', "\r\n") + "\r\n",
    })
}

/* ---------------- writes ---------------- */

pub struct Write<'a> {
    pub content: &'a str,
    pub message: Option<&'a str>,
    pub source: &'a str,
    pub author: &'a str,
}

/// ok, error_count, cycle_time, report JSON, interpreter version — the checked columns of a version row.
type ReportCols = (Option<bool>, Option<i64>, Option<f64>, Option<String>, Option<String>);

fn report_cols(r: &Option<Report>) -> ReportCols {
    match r {
        Some(r) => {
            let mut r = r.clone();
            r.listing = None;
            (
                Some(r.ok),
                Some(r.errors.len() as i64),
                Some(r.stats.cycle_time),
                serde_json::to_string(&r).ok(),
                Some(r.interpreter.clone()),
            )
        }
        None => (None, None, None, None, None),
    }
}

pub fn valid_source(s: &str) -> &str {
    match s {
        "edit" | "import" | "ai" | "restore" | "simulator" => s,
        _ => "edit",
    }
}

/// A new program (version 1). Name normalized; 409 if the name is taken on that machine.
pub async fn create(st: &AppState, owner: &str, machine: &str, name: &str, project_id: Option<&str>, w: Write<'_>) -> ApiResult<ProgramSummary> {
    check_machine(machine)?;
    check_content(w.content)?;
    let name = tnc_formats::program_name(name);
    if let Some(existing) = by_name(st, owner, machine, &name).await? {
        return Err(AppError::conflict(format!("{name} already exists on the TNC {machine}"), json!({ "existing_id": existing.id })));
    }
    if let Some(pid) = project_id {
        project_owned(st, owner, pid).await?;
    }
    let report = check(st, owner, machine, w.content, false).await?;
    let (ok, errs, ct, rep, interp) = report_cols(&report);
    let id = util::new_id();
    let now = util::now();
    let mut tx = st.db.begin().await?;
    sqlx::query("INSERT INTO programs (id, owner_id, project_id, machine, name, current_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)")
        .bind(&id)
        .bind(owner)
        .bind(project_id)
        .bind(machine)
        .bind(&name)
        .bind(&now)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| match AppError::from(e) {
            AppError::Conflict(..) => AppError::conflict(format!("{name} already exists on the TNC {machine}"), Value::Null),
            e => e,
        })?;
    insert_version(&mut tx, &id, 1, &w, &now, (ok, errs, ct, rep, interp)).await?;
    tx.commit().await?;
    summary(st, owner, &id).await
}

/// A new version when the text changed; returns the program and whether a version was written.
/// `base_version`: the version the client edited — a different current version is a 409, not an overwrite.
pub async fn save(st: &AppState, owner: &str, id: &str, base_version: Option<i64>, w: Write<'_>) -> ApiResult<(ProgramSummary, bool)> {
    check_content(w.content)?;
    let p = live(st, owner, id).await?;
    if let Some(b) = base_version {
        if b != p.version {
            return Err(AppError::conflict(
                format!("{} changed since you opened it (version {} is now current, you edited {b})", p.name, p.version),
                json!({ "current_version": p.version }),
            ));
        }
    }
    let cur = content(st, id, p.version).await?;
    if cur == w.content {
        return Ok((p, false));
    }
    let report = check(st, owner, &p.machine, w.content, false).await?;
    let cols = report_cols(&report);
    let now = util::now();
    let next = p.version + 1;
    let mut tx = st.db.begin().await?;
    let moved = sqlx::query("UPDATE programs SET current_version = ?, updated_at = ? WHERE id = ? AND current_version = ?")
        .bind(next)
        .bind(&now)
        .bind(id)
        .bind(p.version)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if moved == 0 {
        return Err(AppError::conflict(format!("{} was saved by someone else just now", p.name), json!({})));
    }
    insert_version(&mut tx, id, next, &w, &now, cols).await?;
    tx.commit().await?;
    Ok((summary(st, owner, id).await?, true))
}

async fn insert_version(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    id: &str,
    version: i64,
    w: &Write<'_>,
    now: &str,
    (ok, errs, ct, rep, interp): ReportCols,
) -> ApiResult<()> {
    let msg = w.message.map(str::trim).filter(|m| !m.is_empty()).map(|m| m.chars().take(500).collect::<String>());
    sqlx::query(
        "INSERT INTO program_versions (program_id, version, content, sha256, size, message, source, author_id, created_at, ok, error_count, cycle_time, report, interpreter)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id)
    .bind(version)
    .bind(w.content)
    .bind(util::sha256_hex(w.content.as_bytes()))
    .bind(w.content.len() as i64)
    .bind(msg)
    .bind(valid_source(w.source))
    .bind(w.author)
    .bind(now)
    .bind(ok)
    .bind(errs)
    .bind(ct)
    .bind(rep)
    .bind(interp)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn project_owned(st: &AppState, owner: &str, project_id: &str) -> ApiResult<()> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM projects WHERE id = ? AND owner_id = ?")
        .bind(project_id)
        .bind(owner)
        .fetch_one(&st.db)
        .await?;
    if n == 0 {
        return Err(AppError::bad("no such project"));
    }
    Ok(())
}

pub enum Upsert {
    Created(ProgramSummary),
    Updated(ProgramSummary),
    Unchanged(ProgramSummary),
}

/// Import semantics: same name on the machine → a new version of it (or nothing if the text is equal);
/// otherwise a new program.
pub async fn upsert(st: &AppState, owner: &str, machine: &str, name: &str, project_id: Option<&str>, w: Write<'_>) -> ApiResult<Upsert> {
    let name = tnc_formats::program_name(name);
    match by_name(st, owner, machine, &name).await? {
        Some(p) => {
            let (p, changed) = save(st, owner, &p.id, None, w).await?;
            Ok(if changed { Upsert::Updated(p) } else { Upsert::Unchanged(p) })
        }
        None => Ok(Upsert::Created(create(st, owner, machine, &name, project_id, w).await?)),
    }
}
