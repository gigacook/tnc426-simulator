# CONTINUE — read this first when the user says "continue"

Written 2026-09-27, end of session. Last commit `39031d0` (pushed; live on GitHub Pages).
Repo stays PUBLIC (user decision). Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## How the user wants work split
- Priority work (interpreter accuracy, profiles, program I/O, AI) → the main thread, Opus.
- Cheap/visual/content work (effects, sprites, lessons, docs) → a Sonnet subagent, speed over polish, no testing.
- Verification of priority work → a short Opus subagent with Playwright (`.tools/qa/qa.mjs`).
- **Don't test the low-priority visual work.** The user said stop testing at the end of this session.
- Heidenhain accuracy is a top priority. The authority is `research/tnc426_430_280476_manual_en.txt`, the TNC 426/430 manual for NC SW 280 476 (gitignored; PDFs downloaded from content.heidenhain.de).
- AI = OpenRouter only. Never Anthropic direct.
- Never re-build what exists: search GitHub (`search-heidenhain/index.md`) and brew first. Name any install and ask before running it.

## State
- Interpreter (`core.js`):
  - RL/RR, RND, CHF, CT, CP/LP/CTP, APPR/DEP, Q formulas, FN 0-19, jumps.
  - Cycles 1 2 4 7 8 9 10 11 17 18 32 200-215 220 221 230 231 247.
  - `tests/manual.js` all pass.
  - `AUTOTOOLS=1 node tests/corpus.js`: 2,495 / 2,806 real programs clean.
- Profiles, upload/download, tool table, AI (`profile.js`, `ai.js`, `ui.js`) pass 51 Playwright QA checks.
- three.js r186 + three.quarks bundled by esbuild. `python3 build.py` needs `.tools/node_modules` (three@0.186.1, three.quarks@0.17.1, esbuild@0.28.2, playwright-core); it prints the npm command if they're missing.
- Local AI key: put `OPENROUTER_API_KEY=` in `.env` and run `python3 build.py` → `index.local.html` (gitignored). No real-key run has been done yet.

## Uncommitted when this was written
A Sonnet docs agent was rewriting `TODO.md`, `HANDOFF.md`, `NEXT-SESSION-PROMPT.md`, `devlog.txt`, `history.txt` and `README.md` to match reality.
- Run `git diff --stat`, skim, then commit them as "Docs synced to v0.6".
- If they're missing or wrong, redo them from this file plus `git log`.
- Also update `LICENSE` (it still says three.js r128; now r186 + three.quarks MIT).

## Next, in order
1. **`SPINDLE ?` false alarms** (~399 in the corpus). `cycleTap` in `core.js` fails when `st.spinDir` is 0 at the cycle call. Check how those programs start the spindle (M3 on the M99 block starts at block START, but `runCycle` may run before `applyM`?). Fix, then re-run the corpus.
2. **Stale QA check** in `.tools/qa/qa.mjs` feature 5: it expects `TOOL 27 NOT DEFINED` after upload, but uploads now auto-add tools. Update the expectation.
3. **Sonnet: particle effects on three.quarks.** `window.QUARKS` is loaded but unused. Move `fx.js` chips, sparks and coolant onto it, keeping `fx.js`'s public API. Speed over polish, no testing.
4. **Thread milling cycles 262, 263, 264, 265, 267.** Small; helix geometry already exists (see `cycleBoreMill`). Parameters are in the manual; tests go in `tests/manual.js`.
5. **TNC 430 multi-axis.** Large (about 3-4 sessions).
   - **Machine layout (answered by the user 2026-09-27):**
     - X Y Z linear.
     - A and B are rotary axes in a **swivel head** (tool side).
     - **Sometimes** a C **rotary table** is added (workpiece side), making 6 axes: X Y Z A B C.
     - So the config needs head axes A+B, plus an optional table axis C toggled per machine profile or setup.
     - Still to ask the user when implementing: the head's pivot lengths/offsets, the axis limits, and which of A/B is the outer (primary) head axis.
   - Build it as a kinematics CONFIG in `window.TNC_MACHINES['430']`: an axis list, each linear/rotary and head/table, with pivot offsets. A 6th axis = one config line. Never fork the UI.
   - Interpreter additions: A/B/C words, cycle 19 WORKING PLANE, M128/M114, M126, rotary feed. All are in the same 280 476 manual.
   - Material model: the height field only handles a vertical tool, so tilted tools need a dexel/voxel model. This is the big piece.
6. **Programming-station oracle.** See `tnc-programstation/instruct.md`. It needs the user's Windows VM plus HEIDENHAIN's free station demo; ask first. Our side: `tests/golden/*.json` + `tests/station.js`.
7. **Deferred (the user said not now):** future-proofing concept (backend + Windows/Mac desktop) as text in the DEV tab.

## Map
- `build.py`: LIBS / MODULES / TEXTS lists plus the vendor bundle.
- `ui.js`: exposes the `window.TNC_UI` plugin bus (scene/tool/tick/crash/resize, `ui.render`).
- Research, gitignored:
  - `search-heidenhain/` (GitHub scrape + clones)
  - `research/` (manuals, 426/430 CAM posts, iTNC530 5-axis samples zip)
- `tnc-sim` (BSL 1.1) is used only as a reference, never copied. The user will handle licensing.
