//! Files in and out, in the simulator's own formats so nothing is locked in:
//! - import: `.H`/`.I` programs, `.zip` of programs (`TNC426/` folders pick the machine),
//!   a simulator profile `.zip`/`.json` (profile.js v2), a `TOOL.T`
//! - export: one `.zip` that the simulator's profile import reads back (profile.json + programs + TOOL.T)

use std::io::{Cursor, Read, Write as _};

use axum::body::Body;
use axum::extract::{Multipart, State};
use axum::http::header;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Serialize;
use serde_json::{json, Map, Value};
use tnc_formats::Tool;
use zip::write::SimpleFileOptions;

use crate::auth::CurrentUser;
use crate::error::{ApiResult, AppError};
use crate::library::{self, Upsert, Write};
use crate::state::AppState;
use crate::util;

pub fn routes() -> Router<AppState> {
    Router::new().route("/import", post(import)).route("/export", get(export))
}

#[derive(Serialize, Default)]
struct ImportReport {
    created: Vec<Value>,
    updated: Vec<Value>,
    unchanged: Vec<Value>,
    tools_added: usize,
    tool_tables: Vec<String>,
    projects: usize,
    skipped: Vec<Value>,
}

struct Incoming {
    name: String,
    machine: String,
    text: String,
    project: Option<String>,
}

/// multipart fields: `file` (repeatable), optional `machine` (default 426) and `project_id`.
async fn import(State(st): State<AppState>, CurrentUser(u): CurrentUser, mut mp: Multipart) -> ApiResult<Json<ImportReport>> {
    let mut files: Vec<(String, Vec<u8>)> = vec![];
    let mut machine = "426".to_owned();
    let mut project: Option<String> = None;
    while let Some(field) = mp.next_field().await.map_err(|e| AppError::bad(e.to_string()))? {
        match field.name().unwrap_or("") {
            "machine" => machine = field.text().await.map_err(|e| AppError::bad(e.to_string()))?,
            "project_id" => project = Some(field.text().await.map_err(|e| AppError::bad(e.to_string()))?).filter(|s| !s.is_empty()),
            _ => {
                let name = field.file_name().unwrap_or("UPLOAD.H").to_owned();
                let data = field.bytes().await.map_err(|e| AppError::bad(e.to_string()))?;
                files.push((name, data.to_vec()));
            }
        }
    }
    library::check_machine(&machine)?;
    if let Some(p) = &project {
        library::project_owned(&st, &u.id, p).await?;
    }
    if files.is_empty() {
        return Err(AppError::bad("no files in the upload"));
    }

    let mut rep = ImportReport::default();
    let mut programs: Vec<Incoming> = vec![];
    for (name, data) in files {
        let lower = name.to_lowercase();
        if lower.ends_with(".zip") {
            read_zip(&st, &u.id, &name, &data, &machine, &project, &mut programs, &mut rep).await?;
        } else if lower.ends_with(".json") {
            let v: Value = serde_json::from_slice(&data).map_err(|_| AppError::bad(format!("{name}: not JSON")))?;
            read_profile(&st, &u.id, &v, &mut programs, &mut rep).await?;
        } else if lower.ends_with(".t") || tnc_formats::decode(&data).trim_start().to_uppercase().starts_with("BEGIN TOOL") {
            let tools = tnc_formats::parse_tool_t(&tnc_formats::decode(&data)).ok_or_else(|| AppError::bad(format!("{name}: not a TOOL.T file")))?;
            merge_tools(&st, &u.id, &machine, &tools).await?;
            rep.tool_tables.push(format!("{name} → TNC {machine} ({} tools)", tools.len()));
        } else {
            programs.push(Incoming { name, machine: machine.clone(), text: tnc_formats::decode(&data), project: project.clone() });
        }
    }

    for p in programs {
        let text = tnc_formats::clean(&p.text);
        let entry = |s: &library::ProgramSummary| json!({ "id": s.id, "name": s.name, "machine": s.machine, "version": s.version, "ok": s.ok });
        if text.is_empty() {
            rep.skipped.push(json!({ "name": p.name, "reason": "empty file" }));
            continue;
        }
        if text.len() > library::MAX_PROGRAM_BYTES {
            rep.skipped.push(json!({ "name": p.name, "reason": "larger than 4 MB" }));
            continue;
        }
        rep.tools_added += library::adopt_tools(&st, &u.id, &p.machine, &text).await?;
        let w = Write { content: &text, message: Some("imported"), source: "import", author: &u.id };
        match library::upsert(&st, &u.id, &p.machine, &p.name, p.project.as_deref(), w).await {
            Ok(Upsert::Created(s)) => rep.created.push(entry(&s)),
            Ok(Upsert::Updated(s)) => rep.updated.push(entry(&s)),
            Ok(Upsert::Unchanged(s)) => rep.unchanged.push(entry(&s)),
            Err(e) => rep.skipped.push(json!({ "name": p.name, "reason": e.to_string() })),
        }
    }
    Ok(Json(rep))
}

#[allow(clippy::too_many_arguments)]
async fn read_zip(
    st: &AppState,
    owner: &str,
    zname: &str,
    data: &[u8],
    machine: &str,
    project: &Option<String>,
    out: &mut Vec<Incoming>,
    rep: &mut ImportReport,
) -> ApiResult<()> {
    // unpack synchronously first: ZipArchive is not Send across awaits
    let mut profile: Option<Value> = None;
    let mut entries: Vec<(String, Vec<u8>)> = vec![];
    {
        let mut z = zip::ZipArchive::new(Cursor::new(data)).map_err(|e| AppError::bad(format!("{zname}: {e}")))?;
        let mut total = 0usize;
        for i in 0..z.len() {
            let mut f = z.by_index(i).map_err(|e| AppError::bad(format!("{zname}: {e}")))?;
            if f.is_dir() {
                continue;
            }
            let path = f.name().to_owned();
            let mut buf = vec![];
            // bounded read: a zip bomb stops at 64 MB in total
            (&mut f).take((64usize << 20).saturating_sub(total) as u64 + 1).read_to_end(&mut buf).map_err(|e| AppError::bad(e.to_string()))?;
            total += buf.len();
            if total > 64 << 20 {
                return Err(AppError::bad(format!("{zname}: more than 64 MB unpacked")));
            }
            if path.rsplit('/').next() == Some("profile.json") {
                profile = serde_json::from_slice(&buf).ok();
            } else {
                entries.push((path, buf));
            }
        }
    }
    if let Some(p) = profile {
        // a simulator profile: profile.json holds the programs; the listings beside it are copies
        return read_profile(st, owner, &p, out, rep).await;
    }
    for (path, buf) in entries {
        let file = path.rsplit('/').next().unwrap_or(&path).to_owned();
        let m = path.split('/').find_map(|seg| seg.strip_prefix("TNC").filter(|m| tnc_formats::is_machine(m))).unwrap_or(machine).to_owned();
        if tnc_formats::is_program_file(&file) {
            out.push(Incoming { name: file, machine: m, text: tnc_formats::decode(&buf), project: project.clone() });
        } else if file.to_lowercase().ends_with(".t") {
            if let Some(tools) = tnc_formats::parse_tool_t(&tnc_formats::decode(&buf)) {
                let tm = file.to_uppercase().strip_prefix("TOOL_TNC").and_then(|r| r.strip_suffix(".T").map(str::to_owned)).filter(|m| tnc_formats::is_machine(m)).unwrap_or(m);
                merge_tools(st, owner, &tm, &tools).await?;
                rep.tool_tables.push(format!("{file} → TNC {tm} ({} tools)", tools.len()));
            }
        }
    }
    Ok(())
}

/// profile.js v2: `{v:2, machines:{426:{pgms:{NAME.H:text}, tools:[…]}}, projects:[{name, pgms:[{m,name}]}]}`
async fn read_profile(st: &AppState, owner: &str, p: &Value, out: &mut Vec<Incoming>, rep: &mut ImportReport) -> ApiResult<()> {
    if p.get("v").and_then(Value::as_i64) != Some(2) || !p.get("machines").is_some_and(Value::is_object) {
        return Err(AppError::bad("not a TNC simulator profile (v2)"));
    }
    // projects first, so their programs land in them
    let mut member: Vec<((String, String), String)> = vec![];
    for pj in p.get("projects").and_then(Value::as_array).into_iter().flatten() {
        let Some(name) = pj.get("name").and_then(Value::as_str) else { continue };
        let id = util::new_id();
        let now = util::now();
        sqlx::query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(owner)
            .bind(name.chars().take(80).collect::<String>())
            .bind(&now)
            .bind(&now)
            .execute(&st.db)
            .await?;
        rep.projects += 1;
        for r in pj.get("pgms").and_then(Value::as_array).into_iter().flatten() {
            if let (Some(m), Some(n)) = (r.get("m").and_then(Value::as_str), r.get("name").and_then(Value::as_str)) {
                member.push(((m.to_owned(), n.to_owned()), id.clone()));
            }
        }
    }
    for (m, mm) in p["machines"].as_object().unwrap() {
        if !tnc_formats::is_machine(m) {
            continue;
        }
        if let Some(tools) = mm.get("tools").and_then(|t| serde_json::from_value::<Vec<Tool>>(t.clone()).ok()) {
            if !tools.is_empty() {
                merge_tools(st, owner, m, &tools).await?;
                rep.tool_tables.push(format!("profile → TNC {m} ({} tools)", tools.len()));
            }
        }
        for (name, text) in mm.get("pgms").and_then(Value::as_object).into_iter().flatten() {
            let Some(text) = text.as_str() else { continue };
            let project = member.iter().find(|((pm, pn), _)| pm == m && pn == name).map(|(_, id)| id.clone());
            out.push(Incoming { name: name.clone(), machine: m.clone(), text: text.to_owned(), project });
        }
    }
    Ok(())
}

/// Incoming tools replace the operator's tools with the same number; the rest stay.
async fn merge_tools(st: &AppState, owner: &str, machine: &str, incoming: &[Tool]) -> ApiResult<()> {
    let t = library::tool_table(st, owner, machine).await?;
    let mut tools: Vec<Tool> = t.tools.into_iter().filter(|x| !incoming.iter().any(|i| i.t == x.t)).collect();
    let mut seen = std::collections::HashSet::new();
    tools.extend(incoming.iter().filter(|i| seen.insert(i.t)).cloned());
    library::save_tool_table(st, owner, machine, &tools, &t.holder).await
}

/// Everything the user has, as a simulator profile `.zip` (import it in the plain simulator page too).
#[allow(clippy::type_complexity)]
async fn export(State(st): State<AppState>, CurrentUser(u): CurrentUser) -> ApiResult<Response> {
    let rows: Vec<(String, String, String, Option<String>, String, String, i64, String)> = sqlx::query_as(
        "SELECT p.id, p.machine, p.name, p.project_id, p.created_at, p.updated_at, p.current_version, v.content
         FROM programs p JOIN program_versions v ON v.program_id = p.id AND v.version = p.current_version
         WHERE p.owner_id = ? AND p.deleted_at IS NULL ORDER BY p.machine, p.name",
    )
    .bind(&u.id)
    .fetch_all(&st.db)
    .await?;
    let projects: Vec<(String, String, String)> = sqlx::query_as("SELECT id, name, created_at FROM projects WHERE owner_id = ? ORDER BY created_at")
        .bind(&u.id)
        .fetch_all(&st.db)
        .await?;
    let prefs: Value = sqlx::query_scalar::<_, String>("SELECT data FROM settings WHERE owner_id = ?")
        .bind(&u.id)
        .fetch_optional(&st.db)
        .await?
        .and_then(|d| serde_json::from_str::<Value>(&d).ok())
        .and_then(|v| v.get("simulator").cloned())
        .unwrap_or_else(|| json!({}));

    let mut machines = Map::new();
    let mut listings: Vec<(String, String)> = vec![];
    for m in tnc_formats::MACHINES {
        let t = library::tool_table(&st, &u.id, m).await?;
        let mut pgms = Map::new();
        let mut meta = Map::new();
        for (_, pm, name, _, created, updated, version, content) in rows.iter().filter(|r| r.1 == *m) {
            pgms.insert(name.clone(), json!(content));
            meta.insert(name.clone(), json!({ "c": created, "m": updated, "v": version }));
            listings.push((format!("programs/TNC{pm}/{name}"), library::listing(&st, &u.id, pm, content).await?));
        }
        if pgms.is_empty() && t.tools.is_empty() {
            continue;
        }
        if !t.tools.is_empty() {
            listings.push((format!("TOOL_TNC{m}.T"), tnc_formats::write_tool_t(&t.tools)));
        }
        machines.insert(
            m.to_string(),
            json!({ "pgms": pgms, "cur": null, "tools": t.tools, "meta": meta, "settings": { "holderType": t.holder } }),
        );
    }
    let projects_json: Vec<Value> = projects
        .iter()
        .map(|(id, name, created)| {
            let pgms: Vec<Value> = rows.iter().filter(|r| r.3.as_deref() == Some(id)).map(|r| json!({ "m": r.1, "name": r.2 })).collect();
            json!({ "id": id, "name": name, "created": created, "pgms": pgms })
        })
        .collect();
    let now = util::now();
    let profile = json!({
        "v": 2, "name": u.name, "created": u.created_at, "updated": now, "prefs": prefs,
        "machines": machines, "projects": projects_json, "active": null,
    });

    let count = rows.len();
    let slug: String = u.name.chars().map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c } else { '_' }).take(40).collect();
    let bytes = tokio::task::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let o = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        z.start_file("profile.json", o)?;
        z.write_all(serde_json::to_string_pretty(&profile)?.as_bytes())?;
        for (path, text) in &listings {
            z.start_file(path.as_str(), o)?;
            z.write_all(text.as_bytes())?;
        }
        z.start_file("README.txt", o)?;
        z.write_all(
            [
                format!("Exported from the TNC server {now}"),
                format!("{count} program(s)."),
                String::new(),
                "Import this .zip in the simulator (profile button -> Import) or in the web app (Import).".into(),
                "programs/ holds each program as a numbered TNC listing (.H, CRLF).".into(),
                "TOOL_*.T are HEIDENHAIN tool tables. profile.json is the whole profile.".into(),
            ]
            .join("\r\n")
            .as_bytes(),
        )?;
        Ok(z.finish()?.into_inner())
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))??;
    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_owned()),
            (header::CONTENT_DISPOSITION, format!("attachment; filename=\"TNC_PROFILE_{slug}.zip\"")),
        ],
        Body::from(bytes),
    )
        .into_response())
}
