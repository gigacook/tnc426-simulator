# TODO — TNC 426 / 430 Simulator

**The task list. Nothing leaves this file because it was started — only because it shipped.**

Status tags:
- `[ ]` not started
- `[~]` written on disk, **not in the build** — the user cannot see it yet
- `[x]` in `build.py`'s `MODULES`/`LIBS`, built into `index.html`, and verified (tests and/or
  `.tools/qa/qa.mjs`)

Anything `[~]` counts as unfinished. Code that isn't wired into `build.py` and built is worth
the same to Nebojsa as code that was never written.

---

## P0 — INTERPRETER: OPEN BUGS

- [ ] **`SPINDLE ?` false alarms in the tapping cycles.** `cycleTap` (`core.js`, cycles 206/207/209)
      fails when `st.spinDir` is 0 at the cycle call. `AUTOTOOLS=1 node tests/corpus.js` shows
      ~399 real-world programs tripping this. Under investigation — check whether an `M3` on the
      same block as the cycle call (or on the `M99` positioning block) is being read after the
      cycle runs rather than before. Do not just silence the check; confirm against the manual
      what a real control does when the spindle direction is genuinely unset.
- [x] Cycle 200 `Q208 = 0` retracts at the `Q206` plunging feed, not at rapid. Covered by
      `tests/manual.js`.

## P1 — INTERPRETER: COVERAGE

Cycles implemented (`core.js` `IMPLEMENTED_CYCLES`/`PATTERN_CYCLES`/`NOMOTION_CYCLES`), all with
`tests/manual.js` coverage against the 426/430 manual's worked examples:
- [x] 1, 2, 4, 17, 18 (old-style pocket/drilling)
- [x] 7, 8, 9, 10, 11, 32, 247 (datum shift, mirror, rotation, scaling, tolerance, datum point —
      non-motion)
- [x] 200–209 (drilling, reaming, boring, back-boring, universal pecking, tapping)
- [x] 210–215 (slot roughing/finishing)
- [x] 220, 221 (bolt-hole / linear patterns)
- [x] 230, 231 (surface milling)
- [x] Q formulas (`FN 0`–`FN 19`), jumps (`FN 9`, `CALL LBL n REP`), `REP Q`
- [x] `RL`/`RR` as real offset paths (not centreline), `RND`, `CHF`, `CT`, `CP`/`LP`/`CTP`,
      `APPR`/`DEP`, `ZX`/`YZ` plane arcs

Not implemented — not started:
- [ ] Cycles 3 (slot milling), 5 (circular pocket, old-style), 12 (PGM CALL), 13 (orientation),
      14/20–25 (contour/SL cycles), 19 (working plane), 26 (surface mirroring), 27/28 (cylinder
      surface).
- [ ] Cycles 262, 263, 264, 265, 267 (thread milling). Helix geometry already exists
      (`cycleBoreMill` in `core.js`) — this is the next cheap win. Parameters are in the manual;
      add cases to `tests/manual.js`.
- [ ] `TCH PROBE` touch-probe cycles. Confirmed not in the 426/430 manual (`research/
      tnc426_430_280476_manual_en.txt`) — an iTNC 530/TNC 640 dialect extension. Corpus programs
      that call them are correctly rejected; do not implement against the iTNC dialect without
      checking the 426/430 manual first.
- [ ] FK (free contour programming).
- [ ] `F AUTO` from a real cutting-data table — currently approximated as the `TOOL CALL` block's
      `F`.

## P2 — UI, PROFILES, PROGRAM I/O  `[x]` shipped, in the build, QA-covered

- [x] Machine profiles, program manager, block editor (typed edits, undo/redo Ctrl+Z /
      Ctrl+Shift+Z), raw-text editor.
- [x] Save `.H` (`Ctrl+S`, numbered TNC listing, CRLF).
- [x] Load `.H`/`.I` (UTF-8 and Windows-1252), `.zip` of programs, drag-and-drop.
- [x] One personal profile per browser (IndexedDB via idb-keyval), autosave, name prompt on
      first visit, wipe/reset flow.
- [x] Profile export/import as `.zip`, with a Merge/Replace choice on import.
      Per-machine tool table, exportable/importable as `TOOL.T`.
- [x] Tools a program calls but the table lacks are auto-created on upload — matches import
      behaviour on a real control.
- [x] `TNC_UI` plugin bus (scene/tool/tick/crash/resize, `ui.render` hook) other modules attach to.
- [x] Boot splash, mobile layout.

All the above pass `.tools/qa/qa.mjs` (52 checks; 1 currently fails, see P3).

## P3 — QA HYGIENE

- [ ] **Stale QA check.** `.tools/qa/qa.mjs` feature 5 still expects
      `TOOL 27 NOT DEFINED` after an upload; uploads now auto-add missing tools (see P2), so
      this check fails by design, not by regression. Update the expectation.

## P4 — EFFECTS  `[x]` shipped and in the build; not yet on three.quarks

- [x] `fx.js`: metal chips that land on the part, sparks, coolant spray on M8, smoke and fire
      (toggle, off by default), crash burst. In the build, wired into `ui.js`.
- [ ] **Move chips/sparks/coolant onto three.quarks.** `window.QUARKS` is bundled into
      `index.html` (esbuild, `vendor/three-entry.mjs`, three.quarks 0.17.1) but grep confirms
      `fx.js` never references it (`grep -c QUARKS fx.js` → 0). Keep `fx.js`'s public API
      (`TNC_FX.create(THREE, scene, opts)`, `setMaterial`) while swapping the particle backend.

## P5 — AI PROGRAM GENERATION  `[x]` shipped, OpenRouter only

- [x] `ai.js` → `TNC_AI`: `DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash'` (checked against
      OpenRouter's model list 2026-09-27: $0.035/M in, $0.29/M out — re-verify pricing
      periodically, models move), `generate(...)` with one repair pass, `testKey`, BYOK key in
      `sessionStorage`/`localStorage`, never a cookie, never sent anywhere but `openrouter.ai`.
      No Anthropic endpoint anywhere in the page (QA-checked).
- [x] Prompt includes the operator's own tool table (`lessons.js`'s `aiSystemPrompt`).
- [x] `.tools/qa/qa.mjs` covers the whole flow against a **mocked** OpenRouter (key test, repair
      loop, header checks, program save).
- [ ] **Run it against the real OpenRouter API at least once.** Every check so far — QA and
      otherwise — uses a mock. `.env` + `OPENROUTER_API_KEY=` + `python3 build.py` produces
      `index.local.html` (gitignored) for this; it has not been done yet.
- [ ] Setup guide / help text for getting and pasting an OpenRouter key (check `lessons.js` /
      the AI tab's own help modal for what already exists before writing new copy).

## P6 — VISUAL QUALITY  `[x]` shipped and in the build

- [x] `materials.js`: alloy presets (aluminium, titanium, steel, stainless, brass, cast iron) and
      industry presets (turbine, aerospace, ground finish, cast) — color/metalness/roughness plus
      chip/spark color, with a picker UI and `localStorage` persistence.
- [x] `look.js`: `RoomEnvironment` via `PMREMGenerator` for the metal reflections, ACES filmic
      tone mapping, FXAA via `EffectComposer`, wired through `TNC_UI`'s `ui.render` hook.
- [x] three.js upgraded r128 → r186, bundled with three.quarks by esbuild
      (`vendor/three-entry.mjs` → `.libcache/three-vendor-0.186.1.js`). `ColorManagement` is kept
      disabled to preserve the existing look (r128-style hex colours, not sRGB-converted).
- [ ] `LICENSE`'s bundled-library note still says "three.js (r128)". Needs updating to r186 +
      three.quarks — out of scope for this docs pass (LICENSE not touched by that pass); do it
      next time a `.js`/build-affecting change is made, or explicitly ask to touch LICENSE.

## P7 — TOOLS, CALLOUTS, FLOWCHART  `[x]` shipped and in the build

- [x] `tools3d.js` — tool geometries in their holders, in the build.
- [x] `callouts.js` — leader-line labels (TOOL, TOOL HOLDER, PART), in the build.
- [x] `flow.js` — program-as-flowchart alternative view, in the build.
- [ ] `RELEASES.txt` — the DEV button's third tab. `build.py`'s `TEXTS` list already has a line
      for it (`window.TNC_RELEASES`); the file itself does not exist yet, so that slot is empty
      in the DEV modal today.

## P8 — LIVE VISUAL TRANSLATION

> Cursor on a program block → the flow/alt view draws that block's geometry, with the tool trace
> animating cut direction. Must work on both the 426 and the 430 once P9 exists.

- [ ] Wire `traceFor`/`traceTick` (`ui.js`) to `pathSVG` (`flow.js`) — both exist, never connected.

## P9 — TNC 430 MULTI-AXIS (research + machine layout done, no code yet)

**This is a kinematics CONFIGURATION, not a fork.** `window.TNC_MACHINES['430']` plugs into the
one UI. Large — expect several sessions.

- [x] Machine layout, answered by the user 2026-09-27 (see `CONTINUE.md`): X Y Z linear; A and B
      rotary in a **swivel head** (tool side); **sometimes** a C **rotary table** (workpiece
      side) is added, making 6 axes total. Still to ask when implementing: the head's pivot
      lengths/offsets, axis limits, and which of A/B is the outer (primary) head axis.
- [ ] Axis-list kinematics config: each linear/rotary axis, head/table, pivot offsets. Config
      needs head axes A+B plus an optional table axis C, toggled per machine profile/setup. A 6th
      axis should be one config line, not new code paths.
- [ ] Interpreter: A/B/C words, cycle 19 WORKING PLANE, M128/M114, M126, rotary feed — all in
      `research/tnc426_430_280476_manual_en.txt`.
- [ ] Tool visuals from real spec dimensions for the 430's toolholders.
- [ ] Same meta-program functionality as the 426: example programs, lessons, visual translation,
      loading/saving from the user's own profile.
- [ ] Material model: the height field only handles a vertical tool axis. Tilted-tool cutting
      needs a dexel/voxel model — this is the large piece, not a side task.

## P10 — PROGRAMMING-STATION ORACLE (not started)

See `tnc-programstation/instruct.md` for the full brief — using a real HEIDENHAIN programming
station as ground truth for error text, dialog order, and TEST RUN timing, since `tests/
manual.js`'s expected values are derived from the manual, not measured on a control.

- [ ] Needs the user's Windows VM plus HEIDENHAIN's free station demo — ask before setting this
      up. Deliverable: `tests/golden/*.json` + `tests/station.js`.

## P11 — DEFERRED (explicitly, per the user)

- [ ] Future-proofing (backend service + Windows/Mac desktop app). The user said not now; keep it
      as a paragraph in the DEV tab rather than starting it.
- [ ] `tnc-sim` (slavomrkva, BSL 1.1) was studied as a reference/oracle only — no code copied.
      Licensing question (can anything be reused, under what terms) is the user's to decide;
      revisit before copying anything from it.

## P12 — DOCS AND HYGIENE

- [x] `README.md`, `TODO.md`, `HANDOFF.md`, `NEXT-SESSION-PROMPT.md`, `devlog.txt`, `history.txt`
      synced to reality 2026-09-27 (this pass) — verified against `git log`, `node tests/
      manual.js`, `AUTOTOOLS=1 node tests/corpus.js`, `.tools/qa/qa.mjs`, and the source.
- [ ] Keep `devlog.txt`, `history.txt` and this file in step with each push — don't let them
      drift stale again the way the pre-2026-09-27 versions did.
- [ ] `~/.claude/CLAUDE.md` — status not reverified this pass (out of repo scope); last known
      state (2026-09-23) was empty with a backup in `~/.Trash/`.
- [ ] Decide on the `~/Library/Caches/ms-playwright` install (1.1 GB) — it's now in active use by
      `.tools/qa/qa.mjs`, so keeping it is the practical call, but the user never explicitly
      approved the original install.

---

## RULES THAT DON'T CHANGE

1. **Authentic TNC behaviour is critical.** Not "close enough". Authority: the HEIDENHAIN TNC
   426/430 manual for NC SW 280 476 (`research/tnc426_430_280476_manual_en.txt`, gitignored) plus
   the pilot and course PDFs, over any other simulator or the iTNC 530 station.
2. **Fully interactive**, keyboard first — arrows, ENTER forward, ESC back, rest on screen.
3. **Ship a direct link.** Plain HTML file, never a claude.ai Artifact.
4. **If a tool is missing, name it and ask before installing.**
5. A DEV tab that lies is worse than no DEV tab.

© 2026 Daniel and Nebojsa Trifunovic Corp.
