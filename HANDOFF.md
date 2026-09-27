# HANDOFF — TNC 426 / 430 Simulator

**Written:** 2026-09-23
**Project root:** `/Users/danieltrifunovic/Developer/sandbox/mac_tnc426-orbital`
**Live:** https://gigacook.github.io/tnc426-simulator/ · **Repo:** https://github.com/gigacook/tnc426-simulator
**Last commit:** `d3aa945` "Interim push: authentic spindle and numbering, TRIFUNOVIC V1/V2, DEV tab" (v0.4, 2026-09-21 15:15)

Pick this file up cold. Section 1 = what exists. Section 2 = what's in flight.
Section 3 = **where the docs in this folder disagree with reality** — read it before you
trust `devlog.txt`, `history.txt` or `README.md`.

---

## 0. WHAT THIS IS

Started as a joke gift for Nebojsa Trifunovic, a CNC engineer (Daniel's father). Grew into a
real browser-based HEIDENHAIN simulator. One self-contained offline HTML file, no build step
for the user, no server. Standing user priorities, in the order they were given:

1. **Authentic TNC behaviour is critical.** Not "close enough".
2. **Fully interactive.** Keyboard first (arrows / ENTER forward / ESC back, rest on screen).
3. **Ship a direct link.** The user's words: *"the only thing I accept is a direct LINK."*
4. **Plain HTML file** — not a claude.ai Artifact. This was a loud correction early on; do not
   regress it.
5. Speed over ceremony ("skip verifications, prio fast push") — but see the v0.2/v0.3 lessons
   in `history.txt`: the one smoke test that was kept caught two silent interpreter bugs.

---

## 1. WHAT IS DONE AND ON DISK

### Committed and live (v0.4)
| File | Size | State |
|---|---|---|
| `core.js` | 36 KB | Klartext parser + interpreter. `TNC = {parse, compile, run, TOOLS}`. Committed, live. |
| `sim.js` | 7 KB | `TNC_SIM`: `expand/grid/analyse/isCone`. Safety events. Committed, live (runs in tests only, not surfaced in live UI). |
| `programs.js` | 8.6 KB | `TNC_PROGRAMS`: TRIFUNOVIC.H, TRIFUNOVIC_V2.H, BRACKET.H. Committed, live. |
| `ui.js` | 31 KB | **The old UI. This is what the live site runs.** |
| `sim-shell.html` | 38 KB | **MODIFIED since the build — rewritten, not yet built or pushed.** |
| `index.html` | 735 KB | Built 2026-09-21 15:15 from `ui.js` + the *old* shell. This is the live artifact. |
| `build.py`, `README.md`, `LICENSE`, `.gitignore`, `orbital.html`, `devlog.txt`, `TRIFUNOVIC_V2.H` | | Committed. |

### Written, syntax-clean, **NOT committed, NOT built in, NEVER RUN IN A BROWSER**
All ten JS modules pass `node --check`. That is the only verification most of them have had.

| File | Size | Exposes | Verified? |
|---|---|---|---|
| `ui.new.js` | 74 KB | the whole new UI | `node --check` only. Never executed. |
| `lessons.js` | 51 KB | `TNC_LESSONS` (6 LEARN, 8 BREAK IT, 16 manual sections, `aiSystemPrompt`) | agent's own verify script: all PASS |
| `fx.js` | 32 KB | `TNC_FX.create(THREE, scene, opts)` | loads in bare vm; no `</script`; `fx-demo.html` exists |
| `tools3d.js` | 22 KB | `TNC_TOOLS3D` | syntax only — **no demo, agent died mid-task** |
| `callouts.js` | 7.5 KB | `TNC_CALLOUTS` | syntax only — **no demo** |
| `flow.js` | 34 KB | `TNC_FLOW.{create,describe,pathSVG}` | syntax only — **no demo, agent died mid-write** |
| `history.txt` | 10 KB | version history for the DEV tab | written, 3 factual errors already corrected |

### `ui.new.js` — what it adds over `ui.js`
Machine profiles (`MACHINES`, merges `window.TNC_MACHINES`), localStorage persistence (stores
only diffs from built-ins), cookie prefs, undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y), compile
with live safety events, height field with 45° cone stamping for chamfer/spot tools, **live
trace comet** (`traceFor` / `traceTick` — the user's "direction little snow thing beaming"),
crash alarm + camera shake + WebAudio beep, PGM MGT, load `.H` from disk + drag-drop, save `.H`,
projects + JSZip download, lesson coach, help modal, AI generate with one repair pass, DEV
modal, mobile pane bar, boot splash.

It degrades gracefully when a module is missing — every optional global is guarded
(`if(window.TNC_FLOW)`, `if(!window.JSZip)` etc.), so a partial build boots rather than
white-screening. **Exception: the AI tab needs `ai.js` and there is no fallback.**

---

## 2. IN FLIGHT — PICK UP HERE

**The authoritative task list is [TODO.md](TODO.md).** Every item below also lives there,
prioritised, and stays there until it ships. This section is the narrative version.

Ordered by the user's own urgency.

### 2.1 QC / visual quality — **user said "IMMEDIATELY", never started**
Most recent instruction, with a screenshot attached:

> "PASS THIS TO QC SUBAGENT QUALITY OPUS IMMEDIATELY - THIS IS BAD!! WE NEED 'FAKE ANTIALIASING'
> TO MAKE NICER LOOK - WE ALSO NEED A SHINY SURFACE TEXTURE, ABLE TO CHOOSE ALUMINIUM
> TITATINIUM, DEFAULT OPTIONS FOR TURBINES, AEROSPACE, GROUND SHIT, CAST STUFF"

Three defects visible in that screenshot:
1. Staircase jaggies on diagonal height-field walls (geometric, not just edge AA).
2. CRT scanlines bleeding over the whole 3D view — **already fixed in the rewritten
   `sim-shell.html`, still live on the site** (see 3.3).
3. Plastic-looking, non-metallic surfaces.

Suggested shape — **new files only**, so it can run in parallel with everything else:
- `hfield.js` → `TNC_HF`, smoothed height-field mesh (kill the staircase at the geometry level).
- `look.js` → env map, FXAA, material rendering.
- `materials.js` → alloy picker (aluminium, titanium) + presets: turbines, aerospace, ground, cast.
- May extend `fx.js` (finished, its agent completed) for material-aware chips and sparks.
- **Must not touch:** `ui.js`, `ui.new.js`, `sim-shell.html`, `core.js`, `sim.js`, `programs.js`,
  `build.py`, `flow.js`, `tools3d.js`, `callouts.js`.

### 2.2 `ai.js` — **does not exist, and `ui.new.js` already calls it**
Planned API (`ui.new.js:870` does `const AI = window.TNC_AI || null;`):
```
TNC_AI.DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash'   // verified against OpenRouter's live list
TNC_AI.generate({key, model, prompt, system, verify, onStep, signal, maxRepairs})
TNC_AI.testKey(key)        // GET /api/v1/key
TNC_AI.extract(text)
TNC_AI.FALLBACK_SYSTEM
```
Browser-side BYOK via OpenRouter (CORS `*`, send `HTTP-Referer` + `X-Title`). Key lives in
`sessionStorage`, never in the cookie. One repair pass: compile the AI's program, feed errors back.
`lessons.js` already carries a 1020-word `aiSystemPrompt` to use as the system message.

### 2.3 v0.5 build + push — the big one
`build.py` currently inlines only: three.js, OrbitControls, `core.js`, `sim.js`, `programs.js`,
`devlog.txt`, `ui.js`, `sim-shell.html`. To ship v0.5 it must also inline:
`lessons.js`, `fx.js`, `tools3d.js`, `callouts.js`, `flow.js`, `ai.js`, JSZip
(a copy is at `/private/tmp/claude-501/jszip.min.js`), `history.txt` → `window.TNC_HISTORY`,
`RELEASES.txt` → `window.TNC_RELEASES`.

Then: swap `ui.new.js` → `ui.js`, build, runtime-check, commit, push, and update the v0.5 section
of `history.txt` once it actually ships.

### 2.4 PM agent's three releases — files written, unverified, undelivered
Owned tools/callouts/flow. Died at the session limit mid-`flow.js`. Outstanding:
verify `tools3d.js` / `callouts.js` / `flow.js`, write their demos, write `RELEASES.txt`.
It had already received the added requirement below.

### 2.5 TNC 430 5-axis — research only, no code
Lead agent killed by the session limit. **`m430/` does not exist.** All that survives is
~30 MB of HEIDENHAIN PDFs + extracted text at `/private/tmp/claude-501/tnc430/research/`
(`322_938-24.pdf`, `331_644-22.pdf`, `de476.pdf`, `a.txt`, `b.txt`, `c.txt`) — **that is a
session-scoped tmp dir and will be wiped; copy it into the project before relying on it.**

Brief was: Opus lead (research → plan → decide → verify) with three workers (Builder 1,
Builder 2, Graphical Designer). Tool visuals from real spec/dimensions. Same meta-program
functionality as the 426: user programs, example runs, good/bad lessons, visual translation,
loading global programs from the user's own space, save/download. Plugs in as
`window.TNC_MACHINES['430']` so it reuses the one UI (`ui.new.js:70` already merges it).

### 2.6 Live visual translation — the last critical function
> "VISUAL TRANSLATION FOR BOTH 426 430 AS ALT VIEW ALSO HOLDS USE IF USER STANDS AT A ROW AND
> IT IS VISUALIZAZIBLE - IT THEN PRINTS THE VISUAL WITH THE TOOL TRACE LIVE (DIRECTION LITTLE
> SNOW THING BEAMING) FIX."

i.e. put the cursor on a block → the flow/alt view renders that block's geometry with a live
animated tool trace showing direction. `ui.new.js` has the comet (`traceFor`/`traceTick`);
`flow.js` has `pathSVG`. They have never been wired together.

### 2.7 Known interpreter gap
Reported by the lessons agent, not yet fixed: **`Q208=0` should retract at the `Q206` feed rate,
not at rapid.**

---

## 3. WHERE THE DOCS DIVERGE FROM REALITY

Checked `devlog.txt`, `history.txt`, `README.md` and `todo /todo.md` against the files on disk.

### 3.1 The project moved
Every earlier note says the work lives in
`~/Documents/gigacook/gigacook-projects/sandbox/mac_tnc426-orbital`. **That path no longer
exists.** The repo is now at `~/Developer/sandbox/mac_tnc426-orbital`. A separate `gigacook`
tree still exists under `~/Library/CloudStorage/ProtonDrive-.../gigacook` — do not confuse them,
and do not put `node_modules` / `.venv` into the ProtonDrive-synced copy.

### 3.2 `~/.claude/CLAUDE.md` is now empty (0 bytes, 2026-09-23 09:41)
The standing constraints used to live there; a backup sits in `~/.Trash/CLAUDE.md.bak-20260920`.
Until it's restored, carry these here:
- Sandbox work stays in the project folder; never scratch in the home root.
- No `.venv` / `node_modules` inside a synced folder.
- **If a tool is missing, name it and ask before installing.** (Violated once — see 3.8.)
- Git commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

### 3.3 The live site does not contain the scanline fix
`index.html` was built at 15:15; `sim-shell.html` was rewritten at 15:22 and never rebuilt.
Live `index.html:53` still has `.crt:after{position:fixed}`, which paints CRT scanlines across
the entire viewport including the 3D view — **this is defect #2 in the user's screenshot.**
The rewritten shell replaces it with a `.scan` background applied only to `.plist` / `.mgt`
(`sim-shell.html:63`). A build+push fixes it immediately; it does not need the QC agent.

### 3.4 `devlog.txt` "IN PROGRESS" ≠ buildable
Everything under IN PROGRESS (PGM MGT, persistence, projects, live safety checks, LEARN/BREAK IT,
AI generation, effects) is written but **cannot appear in a build**, because `build.py` doesn't
inline any of those modules and `ui.js` (not `ui.new.js`) is what gets bundled. The log is honest
about status but reads as "nearly there" when the wiring is the actual remaining work.
AI generation is worse than in-progress: **`ai.js` has not been written at all.**

### 3.5 `history.txt` is three instructions stale
Its v0.5 section covers the UI rewrite, effects, lessons, AI and the PM agent's three releases.
It does **not** mention: TNC 430 5-axis support, the live visual-translation requirement, or the
QC/antialiasing/materials work. Its "BY THE NUMBERS" count of 7 sub-agents is also low — the PM
agent and the 430 lead came after, and the QC agent was never spawned.

### 3.6 `README.md` is stale
- Build table lists only `core.js`, `ui.js`, `sim-shell.html`, `orbital.html` — omits `sim.js`
  and `programs.js`, which have been in the build since v0.4.
- Says "The sample program — `BRACKET.H`", but the control opens **TRIFUNOVIC.H** by default and
  ships three programs.
- The "Known simplifications" list is accurate and worth keeping.

### 3.7 `todo /` is not a todo list
A folder literally named `todo ` (with a trailing space) containing `.DS_Store` and `todo.md`.
`todo.md` is a **truncated copy of `README.md`** (cut off at the build table, missing the licence
section) — not a task list, no unique content. Nothing was lost by ignoring it; safe to delete.
It is untracked and appears not to have been created by this project's agents.

### 3.8 An unauthorised 1.1 GB install happened
The fx sub-agent ran a Playwright browser install: `~/Library/Caches/ms-playwright` is **1.1 GB**
(chromium 1234/1243, chromium_headless_shell 1234/1243, ffmpeg-1011). The user's rule is to name
a missing tool and ask first. The brief given to that agent didn't forbid it, so this is the lead
assistant's failure, not the agent's. Still on disk; removable with
`rm -rf ~/Library/Caches/ms-playwright`. Separately: Chrome is not installed on this machine, so
every "verification" so far is `node --check` plus booting `index.html` in node against a stubbed
DOM / THREE Proxy — **no build has ever been opened in a real browser.**

### 3.9 Untracked files git doesn't know about
`callouts.js`, `flow.js`, `fx.js`, `fx-demo.html`, `history.txt`, `lessons.js`, `tools3d.js`,
`ui.new.js`, `todo /` — plus `sim-shell.html` modified. Roughly 220 KB of unpushed work.
If this machine dies, it's gone.

---

## 4. BUGS ALREADY FOUND AND FIXED (don't re-introduce)

- `CALL LBL n REP r/r` recursed forever. Fixed — but the first fix was itself wrong: the
  discriminator `rep > 0 && target < i` misfired because the parser defaults `rep` to 1, so
  every plain `CALL LBL n` recursed silently. Real fix gates on **`args.repProg`**.
- `M99` on a positioning block never fired the cycle. Fixed via `hasM99()`.
- Q-parameter lines were getting their own NC block numbers. On a real TNC, `CYCL DEF` plus its
  Q lines are **one** block; `CYCLPARM` carries its `CYCL DEF`'s `n`, `BLANK` gets `null`.
- `TOOL CALL S…` switched the spindle on. On a real TNC `S` only sets speed — `M3`/`M4` start it,
  a tool change stops it. Spindle is now split into `sRpm` / `spinDir` with
  `applyM(st, list, phase)` for `'start'` / `'end'`.
- `BRACKET.H` milled its T5 pocket with no `M3` — exposed by the spindle fix. Fixed.
- `sim.js` cried wolf three ways: a correct through-drill (`Q201 -22` in a 20 mm blank) read as a
  crash; 60 duplicate chip-load warnings masked real events; drill retracts read as "rapid into
  material" because a column cut to the bottom still counted as material. All three fixed.
- `TRIFUNOVIC.H` needed a Ø3 tool that didn't exist (T9 ENDMILL_3, l 58.0 r 1.500 added) and its
  "break the outer edge" pass traced the frame groove, not the plate edge. Both fixed.
- `devlog.txt` and `history.txt` both once claimed features were LIVE that weren't. Corrected.
  A DEV tab that lies on day one is worse than no DEV tab.

---

## 5. FASTEST PATH TO A GOOD NEXT PUSH

1. `rm -rf "todo "` — junk.
2. Copy `/private/tmp/claude-501/tnc430/research/` into the project (or it's lost) and
   `/private/tmp/claude-501/jszip.min.js` into `.libcache/`.
3. **Commit the 220 KB of untracked work as-is**, before anything else touches it.
4. Extend `build.py`, swap `ui.new.js` → `ui.js`, build, boot-check, push. This alone kills the
   scanline defect and lights up lessons / fx / projects / undo / PGM MGT.
5. Write `ai.js` — it is the only hard dependency `ui.new.js` has no fallback for.
6. Spawn the QC agent (2.1) on new files only; it can run while 4 and 5 happen.
7. `RELEASES.txt`, then the 430.

---

© 2026 Daniel and Nebojsa Trifunovic Corp.
