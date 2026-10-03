//! The HTTP API end to end, in process (no port), on a throwaway database.

use std::sync::{Arc, Mutex};

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::Router;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tnc_server::{AppState, Config};
use tower::ServiceExt;

struct T {
    app: Router,
    _dir: tempfile::TempDir,
}

async fn setup_with(f: impl FnOnce(&mut Config)) -> T {
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = Config::minimal(dir.path().to_path_buf());
    f(&mut cfg);
    let st = AppState::new(cfg).await.unwrap();
    T { app: tnc_server::router(st), _dir: dir }
}

async fn setup() -> T {
    setup_with(|_| {}).await
}

struct Res {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
}

impl Res {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.body).unwrap_or(Value::Null)
    }
    fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }
}

impl T {
    async fn req(&self, r: Request<Body>) -> Res {
        let res = self.app.clone().oneshot(r).await.unwrap();
        let status = res.status();
        let headers = res.headers().clone();
        let body = res.into_body().collect().await.unwrap().to_bytes().to_vec();
        Res { status, headers, body }
    }
    async fn call(&self, method: Method, uri: &str, token: Option<&str>, body: Option<Value>) -> Res {
        let mut b = Request::builder().method(method).uri(uri);
        if let Some(t) = token {
            b = b.header(header::AUTHORIZATION, format!("Bearer {t}"));
        }
        let body = match body {
            Some(v) => {
                b = b.header(header::CONTENT_TYPE, "application/json");
                Body::from(v.to_string())
            }
            None => Body::empty(),
        };
        self.req(b.body(body).unwrap()).await
    }
    async fn get(&self, uri: &str, token: &str) -> Res {
        self.call(Method::GET, uri, Some(token), None).await
    }
    async fn post(&self, uri: &str, token: &str, body: Value) -> Res {
        self.call(Method::POST, uri, Some(token), Some(body)).await
    }
    async fn put(&self, uri: &str, token: &str, body: Value) -> Res {
        self.call(Method::PUT, uri, Some(token), Some(body)).await
    }
    async fn signup(&self, email: &str) -> String {
        let r = self.call(Method::POST, "/api/v1/auth/signup", None, Some(json!({ "email": email, "name": "Op", "password": "correct horse" }))).await;
        assert_eq!(r.status, StatusCode::CREATED, "{}", r.text());
        r.json()["token"].as_str().unwrap().to_owned()
    }
    async fn upload(&self, token: &str, files: &[(&str, &[u8])], fields: &[(&str, &str)]) -> Res {
        let boundary = "XtncBOUNDARYx";
        let mut body = Vec::new();
        for (k, v) in fields {
            body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n").as_bytes());
        }
        for (name, data) in files {
            body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes());
            body.extend_from_slice(data);
            body.extend(b"\r\n");
        }
        body.extend(format!("--{boundary}--\r\n").as_bytes());
        let r = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/import")
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .header(header::CONTENT_TYPE, format!("multipart/form-data; boundary={boundary}"))
            .body(Body::from(body))
            .unwrap();
        self.req(r).await
    }
}

const PART: &str = "BEGIN PGM PART MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 5 Z S3000\nL Z+50 R0 FMAX M3\nL X+10 Y+10 R0 FMAX\nL Z-2 R0 F200\nL X+90 F500\nL Z+50 R0 FMAX M2\nEND PGM PART MM";

#[tokio::test]
async fn accounts_first_is_admin_then_signup_closes() {
    let t = setup().await;
    let info = t.call(Method::GET, "/api/v1/info", None, None).await.json();
    assert_eq!(info["needs_setup"], true);
    assert_eq!(info["ai"]["enabled"], false);
    assert!(info["interpreter"].is_string());

    let tok = t.signup("Admin@Shop.test").await;
    let me = t.get("/api/v1/me", &tok).await.json();
    assert_eq!(me["role"], "admin");
    assert_eq!(me["email"], "admin@shop.test");

    let r = t.call(Method::POST, "/api/v1/auth/signup", None, Some(json!({ "email": "b@shop.test", "name": "B", "password": "12345678" }))).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    let bad = t.call(Method::POST, "/api/v1/auth/login", None, Some(json!({ "email": "admin@shop.test", "password": "nope nope" }))).await;
    assert_eq!(bad.status, StatusCode::UNAUTHORIZED);
    let ok = t.call(Method::POST, "/api/v1/auth/login", None, Some(json!({ "email": "ADMIN@shop.test", "password": "correct horse" }))).await;
    assert_eq!(ok.status, StatusCode::OK);
    let cookie = ok.headers.get(header::SET_COOKIE).unwrap().to_str().unwrap();
    assert!(cookie.contains("HttpOnly") && cookie.contains("SameSite=Lax"), "{cookie}");

    // admin makes a user; the user can sign in
    let r = t.post("/api/v1/admin/users", &tok, json!({ "email": "op@shop.test", "name": "Operator", "password": "machinist1" })).await;
    assert_eq!(r.status, StatusCode::CREATED);
    let r = t.call(Method::POST, "/api/v1/auth/login", None, Some(json!({ "email": "op@shop.test", "password": "machinist1" }))).await;
    let op = r.json()["token"].as_str().unwrap().to_owned();
    assert_eq!(t.get("/api/v1/admin/users", &op).await.status, StatusCode::FORBIDDEN);

    // the last admin cannot be demoted
    let admin_id = me["id"].as_str().unwrap();
    let r = t.call(Method::PATCH, &format!("/api/v1/admin/users/{admin_id}"), Some(&tok), Some(json!({ "role": "user" }))).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);

    // logout ends the session
    assert_eq!(t.call(Method::POST, "/api/v1/auth/logout", Some(&op), None).await.status, StatusCode::NO_CONTENT);
    assert_eq!(t.get("/api/v1/me", &op).await.status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn cookie_writes_must_be_same_origin() {
    let t = setup().await;
    let tok = t.signup("a@shop.test").await;
    let mk = |origin: &str| {
        Request::builder()
            .method(Method::POST)
            .uri("/api/v1/projects")
            .header(header::HOST, "tnc.local:8426")
            .header(header::ORIGIN, origin)
            .header(header::COOKIE, format!("other=1; tnc_session={tok}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"name":"P"}"#))
            .unwrap()
    };
    assert_eq!(t.req(mk("https://evil.example")).await.status, StatusCode::FORBIDDEN);
    assert_eq!(t.req(mk("http://tnc.local:8426")).await.status, StatusCode::CREATED);
    // reads by cookie are fine from anywhere (SameSite keeps them same-site anyway)
    let r = Request::builder().uri("/api/v1/me").header(header::COOKIE, format!("tnc_session={tok}")).body(Body::empty()).unwrap();
    assert_eq!(t.req(r).await.status, StatusCode::OK);
}

#[tokio::test]
async fn programs_are_versioned_and_checked() {
    let t = setup().await;
    let tok = t.signup("a@shop.test").await;

    let r = t.post("/api/v1/programs", &tok, json!({ "name": "part", "machine": "426", "content": PART })).await;
    assert_eq!(r.status, StatusCode::CREATED, "{}", r.text());
    let p = r.json();
    let id = p["id"].as_str().unwrap().to_owned();
    assert_eq!(p["name"], "PART.H");
    assert_eq!(p["version"], 1);
    assert_eq!(p["ok"], true, "{}", p["report"]);
    assert!(p["cycle_time"].as_f64().unwrap() > 0.0);
    assert_eq!(p["report"]["stats"]["tools_used"][0]["t"], 5);

    // same name again: 409 with the existing id
    let r = t.post("/api/v1/programs", &tok, json!({ "name": "PART.H", "machine": "426" })).await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    assert_eq!(r.json()["error"]["existing_id"], id.as_str());
    // same name on the other machine is a different program
    let r = t.post("/api/v1/programs", &tok, json!({ "name": "PART.H", "machine": "430" })).await;
    assert_eq!(r.status, StatusCode::CREATED);
    assert!(r.json()["content"].as_str().unwrap().starts_with("BEGIN PGM PART MM"));

    // a broken edit is stored, with its errors
    let broken = PART.replace("TOOL CALL 5", "TOOL CALL 77");
    let r = t.put(&format!("/api/v1/programs/{id}"), &tok, json!({ "content": broken, "base_version": 1, "message": "try T77" })).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let v2 = r.json();
    assert_eq!(v2["version"], 2);
    assert_eq!(v2["changed"], true);
    assert_eq!(v2["ok"], false);
    assert_eq!(v2["report"]["errors"][0]["line"], 4);

    // unchanged text: no new version
    let r = t.put(&format!("/api/v1/programs/{id}"), &tok, json!({ "content": broken, "base_version": 2 })).await;
    assert_eq!(r.json()["changed"], false);
    assert_eq!(r.json()["version"], 2);

    // editing an old version: 409, nothing lost
    let r = t.put(&format!("/api/v1/programs/{id}"), &tok, json!({ "content": "x", "base_version": 1 })).await;
    assert_eq!(r.status, StatusCode::CONFLICT);
    assert_eq!(r.json()["error"]["current_version"], 2);

    // restore v1 → v3
    let r = t.post(&format!("/api/v1/programs/{id}/versions/1/restore"), &tok, json!({})).await;
    assert_eq!(r.json()["version"], 3);
    assert_eq!(r.json()["ok"], true);
    assert_eq!(r.json()["source"], "restore");
    let vs = t.get(&format!("/api/v1/programs/{id}/versions"), &tok).await.json();
    assert_eq!(vs.as_array().unwrap().len(), 3);
    assert_eq!(vs[1]["message"], "try T77");
    assert_eq!(vs[1]["author"], "Op");
    let old = t.get(&format!("/api/v1/programs/{id}/versions/2"), &tok).await.json();
    assert!(old["content"].as_str().unwrap().contains("TOOL CALL 77"));

    // download: the numbered listing, CRLF
    let r = t.get(&format!("/api/v1/programs/{id}/download"), &tok).await;
    assert_eq!(r.status, StatusCode::OK);
    assert!(r.headers.get(header::CONTENT_DISPOSITION).unwrap().to_str().unwrap().contains("PART.H"));
    assert!(r.text().starts_with("0 BEGIN PGM PART MM\r\n1 BLK FORM 0.1 Z"), "{}", r.text());

    // search, rename, trash, undelete
    let l = t.get("/api/v1/programs?machine=426&q=BLK%20FORM", &tok).await.json();
    assert_eq!(l.as_array().unwrap().len(), 1);
    let r = t.call(Method::PATCH, &format!("/api/v1/programs/{id}"), Some(&tok), Some(json!({ "name": "plate 2" }))).await;
    assert_eq!(r.json()["name"], "PLATE_2.H");
    assert_eq!(t.call(Method::DELETE, &format!("/api/v1/programs/{id}"), Some(&tok), None).await.status, StatusCode::NO_CONTENT);
    assert_eq!(t.get("/api/v1/programs?machine=426", &tok).await.json().as_array().unwrap().len(), 0);
    assert_eq!(t.get("/api/v1/programs?trash=true", &tok).await.json().as_array().unwrap().len(), 1);
    assert_eq!(t.post(&format!("/api/v1/programs/{id}/undelete"), &tok, json!({})).await.status, StatusCode::OK);

    // another user sees none of it
    let t2 = t.call(Method::POST, "/api/v1/admin/users", Some(&tok), Some(json!({ "email": "b@shop.test", "name": "B", "password": "12345678" }))).await;
    assert_eq!(t2.status, StatusCode::CREATED);
    let b = t.call(Method::POST, "/api/v1/auth/login", None, Some(json!({ "email": "b@shop.test", "password": "12345678" }))).await.json()["token"].as_str().unwrap().to_owned();
    assert_eq!(t.get(&format!("/api/v1/programs/{id}"), &b).await.status, StatusCode::NOT_FOUND);
    assert_eq!(t.get("/api/v1/programs", &b).await.json().as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn projects_group_programs() {
    let t = setup().await;
    let tok = t.signup("a@shop.test").await;
    let pj = t.post("/api/v1/projects", &tok, json!({ "name": "Bracket job" })).await.json();
    let pid = pj["id"].as_str().unwrap();
    let p = t.post("/api/v1/programs", &tok, json!({ "name": "OP10", "machine": "426", "project_id": pid })).await.json();
    t.post("/api/v1/programs", &tok, json!({ "name": "LOOSE", "machine": "426" })).await;
    assert_eq!(t.get(&format!("/api/v1/programs?project={pid}"), &tok).await.json().as_array().unwrap().len(), 1);
    assert_eq!(t.get("/api/v1/programs?project=none", &tok).await.json().as_array().unwrap().len(), 1);
    assert_eq!(t.get("/api/v1/projects", &tok).await.json()[0]["program_count"], 1);
    // move out with null
    let r = t.call(Method::PATCH, &format!("/api/v1/programs/{}", p["id"].as_str().unwrap()), Some(&tok), Some(json!({ "project_id": null }))).await;
    assert_eq!(r.json()["project_id"], Value::Null);
    assert_eq!(t.call(Method::DELETE, &format!("/api/v1/projects/{pid}"), Some(&tok), None).await.status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn tool_table_changes_the_check() {
    let t = setup().await;
    let tok = t.signup("a@shop.test").await;
    let src = PART.replace("TOOL CALL 5", "TOOL CALL 99");
    let p = t.post("/api/v1/programs", &tok, json!({ "name": "T99", "machine": "426", "content": src })).await.json();
    assert_eq!(p["ok"], false);

    let r = t.put("/api/v1/tools/426", &tok, json!({ "tools": [{ "t": 99, "name": "mill_99", "l": 60.0, "r": 4.0 }], "holder": "SK40" })).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()["tools"][0]["name"], "MILL_99");
    assert!(!r.json()["builtin"].as_array().unwrap().is_empty());
    let c = t.post("/api/v1/check", &tok, json!({ "content": src, "machine": "426" })).await.json();
    assert_eq!(c["ok"], true, "{c}");

    // TOOL.T round trip
    let tt = t.get("/api/v1/tools/426/tool.t", &tok).await.text();
    assert!(tt.starts_with("BEGIN TOOL .T MM\r\n") && tt.contains("MILL_99"));
    let r = t.req(
        Request::builder()
            .method(Method::PUT)
            .uri("/api/v1/tools/430/tool.t")
            .header(header::AUTHORIZATION, format!("Bearer {tok}"))
            .body(Body::from(tt))
            .unwrap(),
    )
    .await;
    assert_eq!(r.json()["tools"][0]["t"], 99);

    // duplicates refused
    let r = t.put("/api/v1/tools/426", &tok, json!({ "tools": [{ "t": 1, "name": "A", "l": 0, "r": 1 }, { "t": 1, "name": "B", "l": 0, "r": 1 }] })).await;
    assert_eq!(r.status, StatusCode::BAD_REQUEST);
    assert_eq!(t.get("/api/v1/tools/999", &tok).await.status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn share_links() {
    let t = setup().await;
    let tok = t.signup("a@shop.test").await;
    let p = t.post("/api/v1/programs", &tok, json!({ "name": "PART", "machine": "426", "content": PART })).await.json();
    let id = p["id"].as_str().unwrap();
    let s = t.post(&format!("/api/v1/programs/{id}/shares"), &tok, json!({})).await;
    assert_eq!(s.status, StatusCode::CREATED);
    let s = s.json();
    let token = s["token"].as_str().unwrap();
    assert!(s["url"].as_str().unwrap().ends_with(&format!("/s/{token}")));

    // anyone with the link, no account
    let pub_ = t.call(Method::GET, &format!("/api/v1/public/shares/{token}"), None, None).await;
    assert_eq!(pub_.status, StatusCode::OK);
    assert_eq!(pub_.json()["name"], "PART.H");
    assert_eq!(pub_.json()["report"]["ok"], true);
    let dl = t.call(Method::GET, &format!("/api/v1/public/shares/{token}/download"), None, None).await;
    assert!(dl.text().starts_with("0 BEGIN PGM PART MM\r\n"));

    // a second user copies it
    t.post("/api/v1/admin/users", &tok, json!({ "email": "b@shop.test", "name": "B", "password": "12345678" })).await;
    let b = t.call(Method::POST, "/api/v1/auth/login", None, Some(json!({ "email": "b@shop.test", "password": "12345678" }))).await.json()["token"].as_str().unwrap().to_owned();
    let c = t.post(&format!("/api/v1/shares/{token}/copy"), &b, json!({})).await;
    assert_eq!(c.status, StatusCode::CREATED, "{}", c.text());
    assert_eq!(c.json()["name"], "PART.H");
    let c2 = t.post(&format!("/api/v1/shares/{token}/copy"), &b, json!({})).await;
    assert_eq!(c2.json()["name"], "PART_2.H");

    // revoked: gone
    assert_eq!(t.call(Method::DELETE, &format!("/api/v1/shares/{token}"), Some(&tok), None).await.status, StatusCode::NO_CONTENT);
    assert_eq!(t.call(Method::GET, &format!("/api/v1/public/shares/{token}"), None, None).await.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn import_and_export_round_trip() {
    let t = setup().await;
    let tok = t.signup("a@shop.test").await;
    // a listing from a control: numbered, CRLF, Windows-1252 comment, calls a tool nobody has
    let listing = b"0 BEGIN PGM FROMCTRL MM\r\n1 ; M\xFCller\r\n2 TOOL CALL 31 Z S2000\r\n3 L Z+50 R0 FMAX M3\r\n4 END PGM FROMCTRL MM\r\n";
    let tool_t = b"BEGIN TOOL .T MM\r\nT    NAME             L          R\r\n12   DRILL_10         +100.000   +5.000\r\n[END]\r\n";
    let r = t.upload(&tok, &[("FROMCTRL.H", listing), ("TOOL.T", tool_t), ("part.h", PART.as_bytes())], &[("machine", "426")]).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    let rep = r.json();
    assert_eq!(rep["created"].as_array().unwrap().len(), 2, "{rep}");
    assert_eq!(rep["tools_added"], 1, "T31 joins the table like an import on a control");
    assert_eq!(rep["tool_tables"].as_array().unwrap().len(), 1);
    let fc = rep["created"].as_array().unwrap().iter().find(|c| c["name"] == "FROMCTRL.H").unwrap();
    assert_eq!(fc["ok"], true);
    let d = t.get(&format!("/api/v1/programs/{}", fc["id"].as_str().unwrap()), &tok).await.json();
    assert!(d["content"].as_str().unwrap().contains("Müller"));

    // the same upload again changes nothing
    let r = t.upload(&tok, &[("part.h", PART.as_bytes())], &[]).await.json();
    assert_eq!(r["unchanged"].as_array().unwrap().len(), 1);

    // export → a fresh account imports it → same programs and tools
    let z = t.get("/api/v1/export", &tok).await;
    assert_eq!(z.status, StatusCode::OK);
    assert_eq!(z.headers.get(header::CONTENT_TYPE).unwrap(), "application/zip");
    t.post("/api/v1/admin/users", &tok, json!({ "email": "b@shop.test", "name": "B", "password": "12345678" })).await;
    let b = t.call(Method::POST, "/api/v1/auth/login", None, Some(json!({ "email": "b@shop.test", "password": "12345678" }))).await.json()["token"].as_str().unwrap().to_owned();
    let r = t.upload(&b, &[("TNC_PROFILE_Op.zip", &z.body)], &[]).await;
    assert_eq!(r.status, StatusCode::OK, "{}", r.text());
    assert_eq!(r.json()["created"].as_array().unwrap().len(), 2, "{}", r.text());
    let tools = t.get("/api/v1/tools/426", &b).await.json();
    let nums: Vec<i64> = tools["tools"].as_array().unwrap().iter().map(|x| x["t"].as_i64().unwrap()).collect();
    assert!(nums.contains(&12) && nums.contains(&31), "{nums:?}");
}

/* ---------------- AI proxy against a fake OpenRouter ---------------- */

type Seen = Arc<Mutex<Vec<(Option<String>, Value)>>>;

async fn fake_openrouter() -> (String, Seen) {
    use axum::routing::post;
    let seen: Seen = Arc::default();
    let s2 = seen.clone();
    let app = Router::new().route(
        "/chat/completions",
        post(move |headers: HeaderMap, axum::Json(body): axum::Json<Value>| {
            let seen = s2.clone();
            async move {
                let auth = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).map(str::to_owned);
                seen.lock().unwrap().push((auth, body.clone()));
                if body["stream"] == true {
                    let sse = "data: {\"choices\":[{\"delta\":{\"content\":\"BEGIN PGM A MM\"}}]}\n\n\
                               data: {\"choices\":[],\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":5,\"cost\":0.75}}\n\ndata: [DONE]\n\n";
                    ([(header::CONTENT_TYPE, "text/event-stream")], sse).into_response()
                } else {
                    axum::Json(json!({ "choices": [{ "message": { "content": "hi" } }], "usage": { "prompt_tokens": 1, "completion_tokens": 1, "cost": 0.5 } })).into_response()
                }
            }
        }),
    );
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    (format!("http://{addr}"), seen)
}
use axum::response::IntoResponse;

#[tokio::test]
async fn ai_proxy_keeps_the_key_and_the_budget() {
    let (base, seen) = fake_openrouter().await;
    let t = setup_with(|c| {
        c.openrouter_api_key = Some("test-server-secret".into());
        c.openrouter_base = base;
        c.ai_models = vec!["deepseek/deepseek-v4.1-flash".into()];
        c.ai_max_tokens = 1000;
        c.ai_monthly_budget_usd = 1.0;
    })
    .await;
    let info = t.call(Method::GET, "/api/v1/info", None, None).await.json();
    assert_eq!(info["ai"]["enabled"], true);
    assert!(!info.to_string().contains("test-server-secret"));

    assert_eq!(t.call(Method::POST, "/api/ai/v1/chat/completions", None, Some(json!({}))).await.status, StatusCode::UNAUTHORIZED);
    let tok = t.signup("a@shop.test").await;

    let r = t.post("/api/ai/v1/chat/completions", &tok, json!({ "model": "openai/other", "messages": [] })).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);

    // streamed answer passes through; the server's key goes upstream, max_tokens is capped
    let r = t.post("/api/ai/v1/chat/completions", &tok, json!({ "model": "deepseek/deepseek-v4.1-flash", "messages": [], "stream": true, "max_tokens": 99999 })).await;
    assert_eq!(r.status, StatusCode::OK);
    assert_eq!(r.headers.get(header::CONTENT_TYPE).unwrap(), "text/event-stream");
    assert!(r.text().contains("BEGIN PGM A MM") && r.text().contains("[DONE]"));
    {
        let s = seen.lock().unwrap();
        assert_eq!(s[0].0.as_deref(), Some("Bearer test-server-secret"));
        assert_eq!(s[0].1["max_tokens"], 1000);
        assert_eq!(s[0].1["usage"]["include"], true);
    }
    // usage is recorded when the stream ends (in a task): wait for it
    let mut used = 0.0;
    for _ in 0..50 {
        used = t.get("/api/ai/v1/usage", &tok).await.json()["cost_usd"].as_f64().unwrap_or(0.0);
        if used > 0.0 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert!((used - 0.75).abs() < 1e-9, "{used}");
    let k = t.get("/api/ai/v1/key", &tok).await.json();
    assert!((k["data"]["limit_remaining"].as_f64().unwrap() - 0.25).abs() < 1e-9);

    // non-streamed call takes the rest of the budget; the next one is refused
    let r = t.post("/api/ai/v1/chat/completions", &tok, json!({ "messages": [] })).await;
    assert_eq!(r.status, StatusCode::OK);
    let r = t.post("/api/ai/v1/chat/completions", &tok, json!({ "messages": [] })).await;
    assert_eq!(r.status, StatusCode::PAYMENT_REQUIRED);
    assert_eq!(r.json()["error"]["code"], "budget_exceeded");
}

#[tokio::test]
async fn ai_off_without_key() {
    let t = setup().await;
    let tok = t.signup("a@shop.test").await;
    assert_eq!(t.post("/api/ai/v1/chat/completions", &tok, json!({})).await.status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn simulator_page_gets_the_backend_marker() {
    let dir = tempfile::tempdir().unwrap();
    let sim = dir.path().join("index.html");
    std::fs::write(&sim, "<!DOCTYPE html><html><head><title>x</title></head><body></body></html>").unwrap();
    let t = setup_with(|c| c.sim_file = sim.clone()).await;
    let r = t.call(Method::GET, "/sim/", None, None).await;
    assert_eq!(r.status, StatusCode::OK);
    let html = r.text();
    let i = html.find("TNC_BACKEND").unwrap();
    assert!(i < html.find("</head>").unwrap());
    // unknown API routes are JSON 404s, not the web app
    let r = t.call(Method::GET, "/api/v1/nope", None, None).await;
    assert_eq!(r.status, StatusCode::NOT_FOUND);
    assert_eq!(t.call(Method::GET, "/api/health", None, None).await.json()["ok"], true);
}

#[tokio::test]
async fn host_allow_list_and_security_headers() {
    let t = setup_with(|c| {
        c.allowed_hosts = vec!["127.0.0.1:8427".into()];
        c.csp = Some("default-src 'self'".into());
    })
    .await;
    let get = |host: &'static str| Request::builder().uri("/api/health").header(header::HOST, host).body(Body::empty()).unwrap();
    let ok = t.req(get("127.0.0.1:8427")).await;
    assert_eq!(ok.status, StatusCode::OK);
    assert_eq!(ok.headers.get(header::CONTENT_SECURITY_POLICY).unwrap(), "default-src 'self'");
    assert_eq!(ok.headers.get(header::X_CONTENT_TYPE_OPTIONS).unwrap(), "nosniff");
    // a DNS-rebinding page arrives with its own name in Host
    assert_eq!(t.req(get("evil.example:8427")).await.status, StatusCode::MISDIRECTED_REQUEST);
    let none = Request::builder().uri("/api/health").body(Body::empty()).unwrap();
    assert_eq!(t.req(none).await.status, StatusCode::MISDIRECTED_REQUEST);
}

#[tokio::test]
async fn local_mode_one_time_sign_in_link() {
    let dir = tempfile::tempdir().unwrap();
    let st = AppState::new(Config::minimal(dir.path().to_path_buf())).await.unwrap();
    let u = tnc_server::local::ensure_local_user(&st).await.unwrap();
    assert_eq!(u.role, "admin");
    // idempotent: the second start finds the same account
    assert_eq!(tnc_server::local::ensure_local_user(&st).await.unwrap().id, u.id);
    let link = tnc_server::local::issue_sign_in_link(&st, &u.id);
    let t = T { app: tnc_server::router(st), _dir: dir };

    let r = t.call(Method::GET, &format!("/api/v1/auth/once?t={link}"), None, None).await;
    assert_eq!(r.status, StatusCode::SEE_OTHER);
    assert_eq!(r.headers.get(header::LOCATION).unwrap(), "/");
    let cookie = r.headers.get(header::SET_COOKIE).unwrap().to_str().unwrap();
    assert!(cookie.starts_with("tnc_session=") && cookie.contains("HttpOnly"), "{cookie}");
    let session = cookie.trim_start_matches("tnc_session=").split(';').next().unwrap();
    assert_eq!(t.get("/api/v1/me", session).await.json()["email"], "operator@local.invalid");

    // used once: the second visit is refused, as is a made-up token
    assert_eq!(t.call(Method::GET, &format!("/api/v1/auth/once?t={link}"), None, None).await.status, StatusCode::UNAUTHORIZED);
    assert_eq!(t.call(Method::GET, "/api/v1/auth/once?t=guess", None, None).await.status, StatusCode::UNAUTHORIZED);
    // the local account exists, so nobody else can claim the "first account is admin" sign-up
    let r = t.call(Method::POST, "/api/v1/auth/signup", None, Some(json!({ "email": "x@y.test", "name": "X", "password": "12345678" }))).await;
    assert_eq!(r.status, StatusCode::FORBIDDEN);
}
