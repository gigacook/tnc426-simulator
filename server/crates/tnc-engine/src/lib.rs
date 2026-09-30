//! The simulator's own interpreter, `core.js`, run in embedded QuickJS.
//!
//! One interpreter everywhere: the browser, `node tests/`, and this server all run the same file,
//! so a program the server checks gets the same errors and the same cycle time the operator sees.
//! The JavaScript is compiled into the binary (`include_str!`), so a server build always matches
//! the `core.js` / `machines.js` it was built from.
//!
//! QuickJS runtimes are single-threaded, so the engine is a small pool of worker threads, each with
//! its own runtime. Every run has a wall-clock limit and a memory limit; a runtime that hit either
//! is thrown away and rebuilt.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rquickjs::{Context, Function, Runtime};
use serde::{Deserialize, Serialize};
use tnc_formats::Tool;

const CORE_JS: &str = include_str!("../../../../sim/core.js");
const MACHINES_JS: &str = include_str!("../../../../sim/machines.js");
const STOCK_JS: &str = include_str!("../../../../sim/stock.js");
const SIM_JS: &str = include_str!("../../../../sim/sim.js");
const SHIM_JS: &str = include_str!("shim.js");

/// Version of the interpreter source compiled in: a hash of `core.js`, `machines.js`, `stock.js`, `sim.js`.
/// Stored with every check so a stale report can be told apart from a fresh one.
pub fn interpreter_version() -> String {
    // FNV-1a, 64 bit: no dependency, stable across builds and platforms.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in CORE_JS.bytes().chain(MACHINES_JS.bytes()).chain(STOCK_JS.bytes()).chain(SIM_JS.bytes()) {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    format!("{h:016x}")
}

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("interpreter failed to load: {0}")]
    Load(String),
    #[error("program took longer than {0:?} to check")]
    Timeout(Duration),
    #[error("interpreter error: {0}")]
    Script(String),
    #[error("engine is shut down")]
    Closed,
}

/// What the interpreter is told besides the text.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Options {
    /// "426", "430", … — `machines.js` keys. Unknown or empty: the 3-axis defaults.
    #[serde(default)]
    pub machine: String,
    /// The operator's tool table; merged over the built-in one as in `ui.js` `mtools`.
    #[serde(default)]
    pub tools: Vec<Tool>,
    /// "ISO50" (default) or "SK40": the holder gauge length for tools with L = 0.
    #[serde(default)]
    pub holder: Option<String>,
    /// Create tools a program calls but the table lacks, as an import would.
    #[serde(default)]
    pub auto_tools: bool,
    /// Also return the numbered listing (what "save .H" writes).
    #[serde(default)]
    pub listing: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagnostic {
    /// 1-based line in the stored text.
    pub line: u32,
    /// The TNC block number shown on the control, if the line is a block.
    pub block: Option<i64>,
    pub msg: String,
    pub raw: String,
}

/// A finding of the simulator's safety analysis (sim.js): a crash (rapid into material, holder or vice hit,
/// spindle off while cutting…) or a warning (chip load…).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Event {
    /// "crash" or "warn"
    pub sev: String,
    pub line: u32,
    pub block: Option<i64>,
    pub msg: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ToolUse {
    pub t: i64,
    pub name: Option<String>,
    pub r: f64,
    pub moves: u64,
    pub time: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stats {
    pub move_count: u64,
    pub path_feed: f64,
    pub path_rapid: f64,
    /// Seconds, `sum(length / feed)` as in the simulator (no dwell, no tool change).
    pub cycle_time: f64,
    pub min_z: f64,
    pub max_z: f64,
    pub removed_volume: f64,
    pub tools_used: Vec<ToolUse>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stock {
    pub x0: f64,
    pub y0: f64,
    pub z0: f64,
    pub x1: f64,
    pub y1: f64,
    pub z1: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Report {
    /// No interpreter errors and no crashes — what the simulator's own verify calls a good program.
    pub ok: bool,
    pub errors: Vec<Diagnostic>,
    /// Safety analysis; empty when the program has errors (the simulator does not run a broken program).
    #[serde(default)]
    pub events: Vec<Event>,
    /// NC blocks (blank lines are not blocks).
    pub blocks: u32,
    pub stats: Stats,
    pub stock: Option<Stock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub listing: Option<String>,
    pub interpreter: String,
}

struct Job {
    text: String,
    opts: Options,
    reply: tokio::sync::oneshot::Sender<Result<Report, EngineError>>,
}

/// A pool of interpreter threads. Cheap to clone; the threads stop when the last clone is dropped.
#[derive(Clone)]
pub struct Engine {
    tx: SyncSender<Job>,
    builtin: Arc<Vec<Tool>>,
}

#[derive(Debug, Clone, Copy)]
pub struct Config {
    pub workers: usize,
    pub timeout: Duration,
    pub memory_limit: usize,
}

impl Default for Config {
    fn default() -> Self {
        Config { workers: 2, timeout: Duration::from_secs(10), memory_limit: 512 << 20 }
    }
}

impl Engine {
    /// Starts the workers. Loads the interpreter once up front so a broken build fails here, not on first use.
    pub fn start(cfg: Config) -> Result<Engine, EngineError> {
        let builtin = Arc::new(Js::new(&cfg)?.builtin_tools()?);
        let (tx, rx) = mpsc::sync_channel::<Job>(256);
        let rx = Arc::new(Mutex::new(rx));
        for i in 0..cfg.workers.max(1) {
            let rx = Arc::clone(&rx);
            std::thread::Builder::new()
                .name(format!("tnc-engine-{i}"))
                .spawn(move || worker(rx, cfg))
                .map_err(|e| EngineError::Load(e.to_string()))?;
        }
        Ok(Engine { tx, builtin })
    }

    /// The tool table built into core.js (`TNC.TOOLS`); the operator's table overrides it by number.
    pub fn builtin_tools(&self) -> &[Tool] {
        &self.builtin
    }

    pub async fn check(&self, text: String, opts: Options) -> Result<Report, EngineError> {
        let (reply, rx) = tokio::sync::oneshot::channel();
        let tx = self.tx.clone();
        // the channel is bounded: a full queue blocks, so send off the async runtime
        let job = Job { text, opts, reply };
        match tx.try_send(job) {
            Ok(()) => {}
            Err(mpsc::TrySendError::Full(job)) => {
                tokio::task::spawn_blocking(move || tx.send(job)).await.map_err(|_| EngineError::Closed)?.map_err(|_| EngineError::Closed)?
            }
            Err(mpsc::TrySendError::Disconnected(_)) => return Err(EngineError::Closed),
        }
        rx.await.map_err(|_| EngineError::Closed)?
    }

    /// For command-line use, outside any async runtime.
    pub fn check_blocking(&self, text: String, opts: Options) -> Result<Report, EngineError> {
        let (reply, rx) = tokio::sync::oneshot::channel();
        self.tx.send(Job { text, opts, reply }).map_err(|_| EngineError::Closed)?;
        rx.blocking_recv().map_err(|_| EngineError::Closed)?
    }
}

fn worker(rx: Arc<Mutex<Receiver<Job>>>, cfg: Config) {
    let mut js: Option<Js> = None;
    loop {
        let job = match rx.lock() {
            Ok(r) => match r.recv() {
                Ok(j) => j,
                Err(_) => return,
            },
            Err(_) => return,
        };
        if js.is_none() {
            match Js::new(&cfg) {
                Ok(j) => js = Some(j),
                Err(e) => {
                    let _ = job.reply.send(Err(e));
                    continue;
                }
            }
        }
        let res = js.as_ref().unwrap().run(&job.text, &job.opts, cfg.timeout);
        if matches!(res, Err(EngineError::Timeout(_)) | Err(EngineError::Script(_))) {
            js = None; // start clean after an interrupt or an exception inside the interpreter
        }
        let _ = job.reply.send(res);
    }
}

struct Js {
    _rt: Runtime,
    ctx: Context,
    deadline: Arc<AtomicU64>,
    epoch: Instant,
}

impl Js {
    fn new(cfg: &Config) -> Result<Js, EngineError> {
        let load = |e: rquickjs::Error| EngineError::Load(e.to_string());
        let rt = Runtime::new().map_err(load)?;
        rt.set_memory_limit(cfg.memory_limit);
        rt.set_max_stack_size(4 << 20);
        let epoch = Instant::now();
        let deadline = Arc::new(AtomicU64::new(u64::MAX));
        {
            let deadline = Arc::clone(&deadline);
            rt.set_interrupt_handler(Some(Box::new(move || {
                epoch.elapsed().as_millis() as u64 > deadline.load(Ordering::Relaxed)
            })));
        }
        let ctx = Context::full(&rt).map_err(load)?;
        ctx.with(|ctx| -> Result<(), EngineError> {
            for (name, src) in [("core.js", CORE_JS), ("machines.js", MACHINES_JS), ("stock.js", STOCK_JS), ("sim.js", SIM_JS), ("shim.js", SHIM_JS)] {
                ctx.eval::<(), _>(src).map_err(|e| EngineError::Load(format!("{name}: {}", caught(&ctx, e))))?;
            }
            Ok(())
        })?;
        Ok(Js { _rt: rt, ctx, deadline, epoch })
    }

    fn builtin_tools(&self) -> Result<Vec<Tool>, EngineError> {
        let json = self.ctx.with(|ctx| -> Result<String, EngineError> {
            let f: Function = ctx.globals().get("__tncBuiltinTools").map_err(|e| EngineError::Load(e.to_string()))?;
            f.call::<_, String>(()).map_err(|e| EngineError::Load(caught(&ctx, e)))
        })?;
        serde_json::from_str(&json).map_err(|e| EngineError::Load(e.to_string()))
    }

    fn run(&self, text: &str, opts: &Options, timeout: Duration) -> Result<Report, EngineError> {
        let opts_json = serde_json::to_string(opts).map_err(|e| EngineError::Script(e.to_string()))?;
        let start = self.epoch.elapsed();
        self.deadline.store((start + timeout).as_millis() as u64, Ordering::Relaxed);
        let out = self.ctx.with(|ctx| -> Result<String, EngineError> {
            let f: Function = ctx.globals().get("__tncCheck").map_err(|e| EngineError::Script(e.to_string()))?;
            f.call::<_, String>((text, opts_json.as_str())).map_err(|e| {
                let msg = caught(&ctx, e);
                if self.epoch.elapsed() >= start + timeout || msg.contains("interrupted") {
                    EngineError::Timeout(timeout)
                } else {
                    EngineError::Script(msg)
                }
            })
        });
        self.deadline.store(u64::MAX, Ordering::Relaxed);
        let mut report: Report = serde_json::from_str(&out?).map_err(|e| EngineError::Script(e.to_string()))?;
        report.interpreter = interpreter_version();
        Ok(report)
    }
}

/// The JavaScript exception behind an `Error::Exception`, as text.
fn caught(ctx: &rquickjs::Ctx<'_>, e: rquickjs::Error) -> String {
    if let rquickjs::Error::Exception = e {
        let v = ctx.catch();
        if let Some(ex) = v.as_exception() {
            return format!("{}{}", ex.message().unwrap_or_default(), ex.stack().map(|s| format!("\n{s}")).unwrap_or_default());
        }
        if let Ok(s) = v.get::<rquickjs::Coerced<String>>() {
            return s.0;
        }
    }
    e.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Engine {
        Engine::start(Config { workers: 1, timeout: Duration::from_secs(5), ..Config::default() }).unwrap()
    }

    const OK: &str = "BEGIN PGM T MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 5 Z S3000\nL Z+50 R0 FMAX M3\nL X+10 Y+10 R0 FMAX\nL Z-2 R0 F200\nL X+90 F500\nL Z+50 R0 FMAX M2\nEND PGM T MM";

    #[test]
    fn runs_a_clean_program() {
        let r = engine().check_blocking(OK.into(), Options { listing: true, ..Default::default() }).unwrap();
        assert!(r.ok, "{:?}", r.errors);
        assert_eq!(r.blocks, 10);
        assert!(r.stats.cycle_time > 0.0);
        assert!((r.stats.path_feed - 132.0).abs() < 1e-6, "{}", r.stats.path_feed); // Z+50 -> Z-2, then 80 in X
        assert_eq!(r.stats.tools_used.len(), 1);
        assert_eq!(r.stats.tools_used[0].t, 5);
        let listing = r.listing.unwrap();
        assert!(listing.starts_with("0 BEGIN PGM T MM\r\n1 BLK FORM"), "{listing}");
        assert_eq!(r.stock.unwrap().x1, 100.0);
    }

    #[test]
    fn reports_errors_by_line_and_block() {
        let src = "BEGIN PGM T MM\nTOOL CALL 99 Z S3000\nL X+0 FMAX\nEND PGM T MM";
        let r = engine().check_blocking(src.into(), Options::default()).unwrap();
        assert!(!r.ok);
        let e = &r.errors[0];
        assert_eq!(e.line, 2);
        assert_eq!(e.block, Some(1));
        assert!(e.msg.contains("TOOL"), "{}", e.msg);
    }

    #[test]
    fn user_tools_and_auto_tools() {
        let src = "BEGIN PGM T MM\nTOOL CALL 99 Z S3000\nEND PGM T MM";
        let e = engine();
        let tools = vec![Tool { t: 99, name: "MINE".into(), l: 50.0, r: 2.0 }];
        assert!(e.check_blocking(src.into(), Options { tools, ..Default::default() }).unwrap().ok);
        assert!(e.check_blocking(src.into(), Options { auto_tools: true, ..Default::default() }).unwrap().ok);
    }

    #[test]
    fn machine_430_parameters_apply() {
        // the 430's rapid rates and feed cap (machines.js) change the cycle time of the same program
        let src = "BEGIN PGM T MM\nTOOL CALL 5 Z S1000\nL X-5000 Y-100 Z-100 R0 FMAX M3\nL X+10 F200\nEND PGM T MM";
        let e = engine();
        let a = e.check_blocking(src.into(), Options { machine: "430".into(), ..Default::default() }).unwrap();
        let b = e.check_blocking(src.into(), Options { machine: "426".into(), ..Default::default() }).unwrap();
        assert!((a.stats.cycle_time - b.stats.cycle_time).abs() > 1.0, "{} vs {}", a.stats.cycle_time, b.stats.cycle_time);
    }

    #[test]
    fn endless_loop_is_stopped() {
        // FN 9 jump back to itself: core.js stops it at MAX_STEPS or the engine's clock does
        let src = "BEGIN PGM T MM\nLBL 1\nFN 9: IF +0 EQU +0 GOTO LBL 1\nEND PGM T MM";
        let e = Engine::start(Config { workers: 1, timeout: Duration::from_millis(300), ..Config::default() }).unwrap();
        match e.check_blocking(src.into(), Options::default()) {
            Ok(r) => assert!(!r.ok),
            Err(EngineError::Timeout(_)) => {}
            Err(x) => panic!("{x}"),
        }
        // and the worker is still usable afterwards
        assert!(e.check_blocking(OK.into(), Options::default()).unwrap().ok);
    }

    #[test]
    fn crashes_come_from_sim_js() {
        // FMAX straight down into the blank: a crash in the simulator, so not ok here either
        let src = "BEGIN PGM T MM\nBLK FORM 0.1 Z X+0 Y+0 Z-20\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL CALL 5 Z S3000\nL X+50 Y+50 Z+50 R0 FMAX M3\nL Z-10 R0 FMAX\nL Z+50 R0 FMAX M2\nEND PGM T MM";
        let r = engine().check_blocking(src.into(), Options::default()).unwrap();
        assert!(r.errors.is_empty(), "{:?}", r.errors);
        assert!(r.events.iter().any(|e| e.sev == "crash" && e.line == 6), "{:?}", r.events);
        assert!(!r.ok);
    }

    #[test]
    fn builtin_tools_come_from_core_js() {
        let e = engine();
        assert!(e.builtin_tools().iter().any(|t| t.t == 5 && t.r == 6.0));
    }

    #[tokio::test]
    async fn async_check_and_version() {
        let r = engine().check(OK.into(), Options::default()).await.unwrap();
        assert!(r.ok);
        assert_eq!(r.interpreter, interpreter_version());
        assert_eq!(r.interpreter.len(), 16);
    }
}
