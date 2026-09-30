# CONTINUE — read this first when the user says "continue"

Written 2026-09-30. Last commit: see `git log -1` (pushed; live on GitHub Pages).
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

## Docs
The docs (TODO, HANDOFF, NEXT-SESSION-PROMPT, devlog, history, README, LICENSE) were synced and committed at the end of the 2026-09-27 session.
The Serbian questions for the machinist (pivot lengths, axis limits, which head axis is outer, C table position) were sent via the user. Wait for the answer before building the 430 kinematics.

`private/` is gitignored and holds personal material: the question sheet with answer slots (the Q&A .md in there) and `private/.env` (`OPENROUTER_API_KEY=`, read by `build.py` for the local build). Keep all personal names and keys out of tracked files.

## Latest round (2026-09-27, evening)
- **Operator feedback done:**
  - PROGRAM mode has CYCL DEF / TOOL DEF / TOOL CALL / path-function soft-key rows with one-question-per-step dialogs (`dialogs.js`).
  - The tool list opens in the machine view (TOOL LIST button next to PROGRAMS, key T).
  - Keys: 1–4 modes, 5–9 speed, F focus.
  - Modes are named PROGRAM / TEST / SINGLE-BLOCK / FULL-RUN.
  - NC START follows the mode: green/red soft keys; in SINGLE-BLOCK it runs the next block.
  - A breadcrumb row sits above nested soft keys.
  - Right pane tabs: Diagnostics / Reference (keys, cycles, tools, machine, manual sections) / <name>'s programs (created, edited, version; projects collapsed).
  - Position (DRO) is an overlay on the 3D view. Effects live in the "Effects & view" menu. Manual sections are collapsed.
  - Focus view hides the whole right pane.
  - Arrows move the machine in the run modes.
  - `viz.js`: axis vectors from the program zero to the tool (A/B arcs on the 430), and a click-to-pick green marker with coordinates.
  - Swedish via the profile dialog (`i18n.js`).
- **TNC 430 machine profile** (`MACHINE_430` in `ui.js`): the operator's parameters, with head pivots ~250 mm.
  - Cycle 19 is implemented in `core.js`.
  - Material removal with a tilted tool is still APPROXIMATE (height field stamps a vertical disc).
  - Radius compensation inside a tilted plane is approximate.
- **Programs panel:** a program appears in "<name>'s programs" when it's created, changed, uploaded or saved.

## Latest round (2026-09-27, late)
- **AI generation is live.**
  - Streaming (`ai.js`): progress every 0.5 s.
  - Live view: the program appears block by block, the path grows in 3D, the run pane shows the log.
  - Request viewer shows every round. The repair round is visible.
  - Model picker: DeepSeek V4.1 Flash / Qwen 3.8 Flash / Opus 5.5 via OpenRouter, or any id from the live list.
  - Thinking effort (default low) and max tokens (12000) guard the key budget.
  - Results auto-save to TNC-SIMULATOR/AI-GEN.
- **Downloads** go to TNC-SIMULATOR/{AI-GEN,USER-GEN,SETTINGS,TOOL-TABLES}.
  - Chrome/Edge: Downloads folder picked once (profile dialog).
  - Firefox: name prefix TNC-SIMULATOR_<KIND>_.
- **Operator's GAGNING.H fixes:**
  - decimal comma (STIGN. +1,75)
  - dotted cycle lines numbered as own blocks
  - rigid tapping 17/207/209 runs the spindle itself (no false SPINDLE STOPPED)
  - the DRO shows programmed S with M5
  - a listing's own block numbers are stripped
  - the block preview shows only the next occurrence, twice, then stops
- **Holder:** ISO 50 (DIN 69871 ER32) standard A = 100 mm, SK40 A = 70.
  - L = 0 → drawn at A + typical stick-out, holder check skipped (length unknown).
  - Uploaded unknown tools get L = 0.
- **Header:** modes 1 PRG EDIT / 2 TEST / 3 SINGLE-BLOCK / 4 FULL-RUN on the left.
  - Soft keys show their hotkeys.
  - PRG EDIT: Y CYCL DEF, W TOOL CALL, A APPR/DEP, Q.
- **Not re-run:** the full QA suite (.tools/qa/qa.mjs) was NOT re-run after this round (user asked to skip). Run it first next time; adapt tests to the new UI where needed.

## Latest round (2026-09-30)
- **Dropped by the user (don't re-list):** C rotary table, the single-block "line 19" report, new BREAK IT lessons. Two lessons that relied on the old below-blank crash were removed.
- **Thread milling 262/263/264/265/267** (`cycleThread` in core.js, from the 426/430 manual pp. 235–252; in the CYCL DEF dialogs, TAPPING group).
- **Tapping 207/209/17:** the spindle direction comes from the sign of Q239. **Cycle 18:** switches its own spindle, no retract.
- **Touch probe (user: "future proof"):**
  - `TCH PROBE` blocks parse (both forms).
  - 408–413, 417 and 419 move as in the iTNC 530 manual and write nominal results. 30–33, 480–483 and 562 are tool measuring with no motion.
  - Others report `TCH PROBE n NOT IMPLEMENTED IN SIMULATOR`.
  - Probe moves carry `mv.probe`/`mv.touch`. sim.js and ui.js skip removal and checks for them.
  - `probeList`/`probeSpec` are in dialogs.js but not wired to a key yet.
- **Corpus:** 2,767 / 2,806 clean (`AUTOTOOLS=1 node tests/corpus.js`). The 39 left are broken programs: prose in NC lines, bracket formulas, bad BEGIN PGM names. A real TNC rejects them too.
- **`stock.js`** (new): the shared material model.
  - A tilted tool (A/B, cycle 19) cuts along its real axis. Height field: no undercuts.
  - The holder check follows the tool axis, up 300 mm (`HEAD_LEN`).
- **Standard vice, ON by default** (user: "put standard one right now"). Settings are in `TNC_STOCK.VICE`:
  - 160 mm jaws on the Y faces, gripping the bottom 6 mm of the blank (a third of thin parts)
  - toggle under Effects & view → Vice
  - crashes: `TOOL INTO THE VICE` / `HOLDER HITS THE VICE`
  - the first move (from the program zero) is not vice-checked
  - about 7–10% of the internet corpus hits it; these are real cases: outside contours cut down to the jaw zone
- **fx.js** runs on three.quarks (the legacy engine is the fallback). Not visually tested.
- **QA suite** `.tools/qa/qa.mjs`, updated to the current UI: 93/93 pass on e20d0d5. Run it with `cd .tools/qa && node qa.mjs`.

## Come back to — open points (placeholders, NOT facts)
Settle these with the programming station (item 1 below) or the operator. Each is marked in a code comment.
- **Thread milling (core.js `cycleThread`)**, where neither manual gives numbers:
  1. Helix start and turns: whole turns at thread depth, starting on +X. Is there rounding, overrun, or another start angle?
  2. Approach: a semicircle from the centre rising half a pitch. Departure: a flat semicircle. The side pre-positioning for small tools (tool Ø < ¼ thread Ø) is not built.
  3. 267 start point: R + |pitch| from the stud. After the cycle the tool is left above that point, not above the centre.
  4. 263 countersink circle at the "core diameter" is not simulated (no formula for the core Ø or for Q357); only the plunge to Q356 is.
  5. 264 countersinking feed uses Q206 (264 has no Q254).
  6. Positive depths: the sign is ignored, as in the other cycles. The manual says a positive depth reverses the direction.
  7. No error is raised when 262/263/264/267 run with M4 or a stopped spindle (no documented message).
- **Touch probe (core.js)** — mostly from the iTNC 530 manual, since we don't have the 426/430 probe manual:
  1. MP 6140 clearance: assumed 2 mm.
  2. Q261: the stylus tip is placed at Q261 minus the stylus radius. Is it at Q261 instead?
  3. With Q305=0 while cycle 7 is active, the shift stays on top.
  4. Q303=0 datum tables are not simulated.
  5. Preset rows are translation only.
  6. Touch-point order and paraxial routing are read from the manual's figures.
  7. 419 and the Q381 Z touch write no results.
- **Vice:** jaw axis, grip, width and thickness are standard guesses, not the operator's vice. Probe moves skip the vice check; a stylus could really hit a jaw.
- **Head:** the tilted-tool head is a 300 mm cylinder of holder radius; the real head dimensions are unknown.

## Next, in order
1. **Programming-station oracle (maybe, user's call).** See `tnc-programstation/instruct.md`. Needs the user's Windows VM plus HEIDENHAIN's free station demo. It is the way to settle the open points above.
2. **Backend (reasoning started 2026-09-30, nothing decided).** Two layers:
   - an installed app: Tauri 2 (lean), Electron, or a local server + browser
   - an optional shared server: PocketBase (lean)

   The GitHub Pages version stays working without either. The user still has to answer: which jobs (key safety / sharing / real folders / sending programs to the machine over LSV-2), how the operator moves programs today, who uses it, and the shop PC's OS. Before building an LSV-2 link, check the licence and 426/430 support of `pyLSV2` and the JS project in `search-heidenhain`.
3. **TNC 430 multi-axis, remaining:**
   - a dexel/voxel model for undercuts
   - radius compensation in a tilted plane
   - M128/M114 (the operator doesn't use M128; he uses cycle 19)
4. Wire `probeSpec` to a TOUCH PROBE soft key; add a `TCHPROBE` node in flow.js.

## Map
- `build.py`: LIBS / MODULES / TEXTS lists plus the vendor bundle.
- `ui.js`: exposes the `window.TNC_UI` plugin bus (scene/tool/tick/crash/resize, `ui.render`).
- Research, gitignored:
  - `search-heidenhain/` (GitHub scrape + clones)
  - `research/` (manuals, 426/430 CAM posts, iTNC530 5-axis samples zip)
- `tnc-sim` (BSL 1.1) is used only as a reference, never copied. The user will handle licensing.
