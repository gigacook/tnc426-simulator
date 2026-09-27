# HANDOFF — TNC 426 / 430 Simulator

**Written:** 2026-09-27 (docs sync pass)
**Project root:** `<repo>`
**Repo:** https://github.com/gigacook/tnc426-simulator · **Live:** https://gigacook.github.io/tnc426-simulator/
**HEAD:** `9618cce` "CONTINUE.md: TNC 430 layout — A/B swivel head, optional C table" (local
`main` == `origin/main`, working tree clean apart from this docs pass). The repo moved twice more
while this docs pass was in progress — re-run `git log --oneline -5` before trusting this line.

Pick this file up cold. Section 1 = what's built and verified. Section 2 = what's in flight.
Section 3 = the standing rules. Everything here was checked against the repo on disk on
2026-09-27 — `git log`, `node tests/manual.js`, `AUTOTOOLS=1 node tests/corpus.js`, and
`.tools/qa/qa.mjs` against a freshly built `index.html` — not carried over from an older doc.

---

## 0. WHAT THIS IS

Started as a small side project for a CNC engineer. Grew into a
real browser-based HEIDENHAIN TNC 426/430 simulator. One self-contained offline HTML file
(`index.html`, built by `build.py`); no build step or server for the end user. Standing user
priorities, in the order they were given:

1. **Authentic TNC behaviour is critical.** Not "close enough". Authority: the HEIDENHAIN
   TNC 426/430 manual for NC SW 280 476 (`research/tnc426_430_280476_manual_en.txt`, gitignored,
   downloaded from content.heidenhain.de) plus the pilot and basic/advanced course PDFs.
2. **Fully interactive.** Keyboard first (arrows / ENTER forward / ESC back, rest on screen).
3. **Ship a direct link.** Plain HTML file — never a claude.ai Artifact.
4. **If a tool is missing, name it and ask before installing.**
5. A DEV tab that lies is worse than no DEV tab.

---

## 1. WHAT IS BUILT, IN `index.html`, AND VERIFIED

### Interpreter (`core.js`)
`L`/`C`/`CC`/`CR`/`CP`/`LP` moves; `RL`/`RR` as real offset paths (not centreline); `RND`, `CHF`,
`CT`, `APPR`/`DEP`, `ZX`/`YZ` plane arcs; Q-parameter formulas `FN 0`–`FN 19`; jumps (`FN 9`,
`CALL LBL n REP`); modal M-functions with correct block-start/block-end timing; a tool table;
TNC-style error register. Cycles: 1, 2, 4, 17, 18, 7–11, 32, 247 (non-motion), 200–215, 220, 221,
230, 231.

Verified by `node tests/manual.js` — every worked example in the manual, plus inside corners,
errors, formulas, mirror — **all pass**. Caveat, carried from `tnc-programstation/instruct.md`:
expected values are derived from the manual's own rules, not measured on a real control, so a
misreading of the manual could still pass its own test.

Verified against real-world CAM output by `AUTOTOOLS=1 node tests/corpus.js`: **2,495 / 2,806**
programs run clean (`1,066 / 2,806` without `AUTOTOOLS`, i.e. before missing tools are
auto-created the way an import would). Remaining failures: `TCH PROBE 4xx` (correctly rejected —
an iTNC 530/TNC 640 dialect, not in the 426/430 manual), and ~399 `SPINDLE ?` errors from the
tapping cycles — see section 2, this is a real open bug, not a corpus artifact.

### UI, profiles, program I/O (`ui.js`, `profile.js`)
Four operating modes with their own soft-key rows, run comparison (reference A vs. current run),
material removal as a height field with backward scrubbing. One personal profile per browser
(IndexedDB via idb-keyval), autosave, name prompt, wipe/reset. Profile export/import as `.zip`
(Merge/Replace), per-machine tool table import/export as `TOOL.T`. Program I/O: `.H`/`.I`
(UTF-8 or Windows-1252), `.zip`, drag-and-drop, save with `Ctrl+S` as a numbered TNC listing.
Uploading a program that calls an undefined tool auto-creates it (matches real-control import
behaviour). Block editor with undo/redo. `window.TNC_UI` plugin bus other modules attach to.

### AI (`ai.js`)
OpenRouter only, BYOK — never Anthropic direct, confirmed by grep (no Anthropic endpoint string
anywhere in the built page) and by QA. Default model `deepseek/deepseek-v4.1-flash`
($0.035/M in, $0.29/M out, checked against OpenRouter's model list 2026-09-27 — re-check
periodically). One repair pass: compile the AI's program, feed errors back. Prompt includes the
operator's own tool table. Key lives in `sessionStorage`/`localStorage`, never a cookie.
**Only tested against a mocked OpenRouter so far** — no run against the real API has happened in
this repo (an `.env` + `OPENROUTER_API_KEY=` + `python3 build.py` path exists for that, via
`index.local.html`, gitignored, but hasn't been exercised).

### Materials and look (`materials.js`, `look.js`)
Alloy presets (aluminium, titanium, steel, stainless, brass, cast iron) and industry presets
(turbine, aerospace, ground finish, cast) driving PBR color/metalness/roughness and chip/spark
color, with a picker and `localStorage` persistence. `RoomEnvironment` via `PMREMGenerator` for
metal reflections, ACES filmic tone mapping, FXAA through `EffectComposer`, wired through
`TNC_UI`'s `ui.render` hook.

### Lessons (`lessons.js`)
LEARN, BREAK IT, a power-user manual, and the AI system prompt (`aiSystemPrompt`), in the build.

### Tools / callouts / flow (`tools3d.js`, `callouts.js`, `flow.js`)
Real tool geometries in their holders; view-aligned leader-line callouts (TOOL, TOOL HOLDER,
PART); the program-as-flowchart alternative view. All in the build.

### Effects (`fx.js`)
Chips, sparks, coolant spray on M8, smoke/fire (toggle, off by default), crash burst. In the
build, wired into `ui.js`. **Not yet on three.quarks** — see section 2.

### Build (`build.py`)
Fully data-driven: `LIBS` (JSZip, idb-keyval, fetched to `.libcache/`), `MODULES` (project `.js`
files, `ui.js` must stay last), `TEXTS` (`devlog.txt`/`history.txt`/`RELEASES.txt`/`ROADMAP.txt`
→ `window.TNC_*` globals for the DEV modal — `RELEASES.txt`/`ROADMAP.txt` don't exist yet, so
those two slots are empty). A new module is one line.

three.js was upgraded **r128 → r186**, bundled with its addons (OrbitControls, RoomEnvironment,
FXAA/EffectComposer, OutputPass) and the [three.quarks](https://github.com/Alchemist0823/three.quarks)
particle library by esbuild from `vendor/three-entry.mjs` into one classic script exposing
`window.THREE`/`window.QUARKS`. Needs `.tools/node_modules` (`cd .tools && npm i
three@0.186.1 three.quarks@0.17.1 esbuild@0.28.2`) — `build.py` prints the exact command if it's
missing. `THREE.ColorManagement.enabled = false` is set deliberately, to keep r128's hex-color
behaviour rather than changing the existing look.

**`LICENSE`'s own bundled-library note still says "three.js (r128)"** — stale, needs updating,
not touched in this docs pass (LICENSE is a licence file, not one of the six docs this pass
covers — flag it, don't silently fix it under a different mandate).

### QA (`.tools/qa/qa.mjs`)
Playwright, run against a built `index.html` (copy to `.tools/qa/under-test.html`, `node
qa.mjs`). **51 of 52 checks pass.** The one failure is stale by design: it still expects
`TOOL 27 NOT DEFINED` after an upload, but uploads now auto-add missing tools (see Profiles
above) — the check needs updating, not the product.

---

## 2. IN FLIGHT — PICK UP HERE, IN ORDER

1. **`SPINDLE ?` false alarms in the tapping cycles.** ~399 real programs in the corpus trip
   `cycleTap`'s `if (!keep) fail(st, bi, 'SPINDLE ?')` (`core.js`, cycles 206/207/209) because
   `st.spinDir` reads 0 at the cycle call. Investigate whether `M3` on the same block, or on the
   preceding `M99` positioning block, is being applied after the cycle runs rather than before.
   Fix against the manual's actual timing rules, then re-run `AUTOTOOLS=1 node tests/corpus.js`.
2. **Fix the stale QA check** — `.tools/qa/qa.mjs` feature 5, `TOOL 27 NOT DEFINED` expectation.
3. **Move `fx.js`'s chips/sparks/coolant onto three.quarks.** `window.QUARKS` is bundled and
   present in the page but unreferenced (`grep -c QUARKS fx.js` → 0). Keep `fx.js`'s existing
   public API (`TNC_FX.create(THREE, scene, opts)`, `setMaterial`).
4. **Thread milling cycles 262–265, 267.** Helix geometry already exists (`cycleBoreMill` in
   `core.js`); parameters are in the manual. Add cases to `tests/manual.js` as you go.
5. **TNC 430 multi-axis** (P9 in TODO.md) — large, several sessions. Machine layout is now
   answered (`CONTINUE.md`, 2026-09-27): X Y Z linear, A+B rotary in a swivel head (tool side),
   with an optional C rotary table (workpiece side) on some setups — 6 axes when C is present.
   Still to ask when implementing: pivot lengths/offsets, axis limits, which of A/B is primary.
   Build as a kinematics config in `window.TNC_MACHINES['430']`, never a fork of the UI. The
   height field only handles a vertical tool axis, so tilted-tool cutting needs a dexel/voxel
   model — the large piece of this task.
6. **Programming-station oracle** (P10 in TODO.md, see `tnc-programstation/instruct.md`) — needs
   the user's Windows VM plus HEIDENHAIN's free station demo; ask before setting it up.
7. **Deferred, per the user, not started:** future-proofing (backend + Windows/Mac desktop app).
   `tnc-sim` (BSL 1.1) was studied as a reference/oracle only, no code copied — licensing
   question is the user's to decide before anything from it is reused.

---

## 3. RULES THAT DON'T CHANGE

1. **Authentic TNC behaviour is critical.** Not "close enough".
2. **Fully interactive**, keyboard first.
3. **Ship a direct link.** Plain HTML file, never a claude.ai Artifact.
4. **If a tool is missing, name it and ask before installing.**
5. A DEV tab that lies is worse than no DEV tab.
6. AI = OpenRouter only, never Anthropic direct.
7. Never rebuild what exists — check `search-heidenhain/index.md` and Homebrew first.
8. Priority work (interpreter accuracy, profiles, program I/O, AI) gets full verification
   (tests + `.tools/qa/qa.mjs`); explicitly low-priority/visual work may skip testing only when
   the user says so for that specific piece — don't generalize that exception.

Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (per `CONTINUE.md` and
recent commits — note this is a step up from the `Opus 5` trailer some older docs in this repo
still reference; use whatever this session's own system instructions specify if they differ).

---

## 4. WHERE THINGS LIVE

- `build.py` — `LIBS` / `MODULES` / `TEXTS`, plus the three.js/three.quarks vendor bundle logic.
- `vendor/three-entry.mjs` — the esbuild entry point for the three.js/three.quarks bundle.
- `ui.js` — exposes `window.TNC_UI`, the plugin bus (`scene`/`tool`/`tick`/`crash`/`resize`,
  `ui.render`) other modules (`fx.js`, `look.js`, `materials.js`) attach to.
- `research/`, `search-heidenhain/`, `.tools/`, `.libcache/` — all gitignored.
- `tnc-programstation/instruct.md` — the plan for using a real programming station as an oracle
  (not yet acted on).
- `CONTINUE.md` — a same-day pickup note from the previous work session, including the user's
  answer on TNC 430 machine layout; useful cross-check if this file and it disagree on anything
  not yet re-verified here. It gets amended in place during a session, so re-read it — don't
  assume the version you last saw is current.

© 2026 TNC 426 Simulator contributors
