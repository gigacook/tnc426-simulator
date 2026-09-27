# TODO — TNC 426 / 430 Simulator

**The task list. Nothing leaves this file because it was started — only because it shipped.**

Status tags:
- `[ ]` not started
- `[~]` written on disk, **not in the build** — the user cannot see it yet
- `[x]` live at https://gigacook.github.io/tnc426-simulator/ and verified

Anything `[~]` counts as unfinished. Code that isn't wired into `build.py` and pushed is
worth the same to Nebojsa as code that was never written.

---

## P0 — SHIP WHAT ALREADY EXISTS

The single biggest lever. Six modules are written and invisible.

- [ ] **Commit the untracked work.** ~220 KB across 9 files, unversioned since 2026-09-21.
- [ ] **Extend `build.py`** to inline: `lessons.js`, `fx.js`, `tools3d.js`, `callouts.js`,
      `flow.js`, `ai.js`, JSZip (copy at `/private/tmp/claude-501/jszip.min.js`),
      `history.txt` → `window.TNC_HISTORY`, `RELEASES.txt` → `window.TNC_RELEASES`.
- [ ] **Swap `ui.new.js` → `ui.js`**, build, boot-check, push as v0.5.
- [ ] **Fix the scanline bleed on the live site.** Already fixed in `sim-shell.html` (`.scan`
      on `.plist`/`.mgt` only); live `index.html:53` still has `.crt:after{position:fixed}`
      painting over the 3D view. Ships automatically with any rebuild.
- [ ] **Open a build in a real browser.** Zero builds have ever been. Chrome is not installed;
      Playwright's Chromium is already on disk at `~/Library/Caches/ms-playwright` (1.1 GB,
      installed without asking — delete it or use it, but decide).

## P1 — UI AND PERSISTENCE  `[~]` written in `ui.new.js`, never executed

- [~] PGM MGT program manager (arrow keys, ENT, ESC).
- [~] NEW PGM from scratch, with the MM and BLK FORM dialog.
- [~] Save as `.H` with Ctrl+S in numbered TNC listing format.
- [~] Load `.H` from disk and by drag-and-drop.
- [~] Undo/redo per program — Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y.
- [~] Programs and projects persisted in browser storage (stores only diffs from built-ins).
- [~] User settings in a cookie.
- [~] Projects panel: create a project, append programs, download as `.zip`.
- [~] Mobile layout — bottom tab bar (Program / Graphics / Status), touch-sized controls.
- [~] Boot splash with the copyright block.
- [~] Machine profiles (`window.TNC_MACHINES`) so a second control reuses one UI.

## P2 — SIMULATOR BEHAVIOUR

- [~] Safety checks shown live during the run (`sim.js` analysis exists; runs in tests only today).
- [~] Crash alarm that stops the run — camera shake, WebAudio beep.
- [~] Chamfer and spot tools stamped as 45° cones.
- [~] Live tool-trace comet showing cut direction.
- [ ] **Cycle 200 bug:** `Q208 = 0` must retract at the `Q206` plunging feed, not at rapid.

## P3 — TEACHING  `[~]` written in `lessons.js`, passes its own tests

- [~] LEARN — 6 lessons.
- [~] BREAK IT — 8 famous ways to wreck a machine, each with the fix.
- [~] Power-user MANUAL — 16 sections.
- [~] Lesson coach wired into the run.

## P4 — EFFECTS  `[~]` written in `fx.js`, has `fx-demo.html`

- [~] Metal chips that land on the part.
- [~] Sparks.
- [~] Coolant spray on M8.
- [~] Smoke and fire (toggle, off by default).
- [~] Crash burst.
- [ ] Make chips and sparks material-aware once the alloy picker exists (P6).

## P5 — AI PROGRAM GENERATION (the third way to make a program)

**`ai.js` does not exist. `ui.new.js:870` already calls it, with no fallback.**

- [ ] Write `ai.js` → `TNC_AI`:
      `DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash'` (checked against OpenRouter's live
      list, not guessed), `generate({key, model, prompt, system, verify, onStep, signal,
      maxRepairs})`, `testKey(key)` via `GET /api/v1/key`, `extract(text)`, `FALLBACK_SYSTEM`.
- [ ] BYOK in the browser: OpenRouter, CORS `*`, send `HTTP-Referer` + `X-Title`.
      Key in `sessionStorage` only — never the cookie, never localStorage.
- [ ] One repair pass: compile the AI's program, feed the errors back.
      `lessons.js` already carries a 1020-word `aiSystemPrompt` for the system message.
- [ ] Setup guide for getting and pasting an OpenRouter key.

## P6 — VISUAL QUALITY (user's screenshot, marked IMMEDIATELY, not started)

> "WE NEED 'FAKE ANTIALIASING' TO MAKE NICER LOOK - WE ALSO NEED A SHINY SURFACE TEXTURE,
> ABLE TO CHOOSE ALUMINIUM TITATINIUM, DEFAULT OPTIONS FOR TURBINES, AEROSPACE, GROUND
> SHIT, CAST STUFF"

- [ ] `hfield.js` → `TNC_HF`: smoothed height-field mesh. Kill the staircase on diagonal
      walls at the **geometry** level — edge AA alone won't do it.
- [ ] `look.js`: FXAA post-process, environment map, metal shading.
- [ ] `materials.js`: alloy picker (aluminium, titanium) + presets — turbines, aerospace,
      ground, cast.
- [ ] Keep it to new files. Do not touch `ui.js`, `ui.new.js`, `sim-shell.html`, `core.js`,
      `sim.js`, `programs.js`, `build.py`, `flow.js`, `tools3d.js`, `callouts.js`.

## P7 — TOOLS, CALLOUTS, FLOWCHART  `[~]` written, syntax check only, no demo, no run

- [~] `tools3d.js` — real tool geometries in their holders, from actual spec dimensions.
- [~] `callouts.js` — thin leader lines with view-aligned rotating labels: TOOL, TOOL
      HOLDER, PART.
- [~] `flow.js` — alternative program view: code read row by row, drawn as a top-to-bottom
      flowchart, so students can go code → reality.
- [ ] Verify all three. Write their demo pages.
- [ ] Write `RELEASES.txt` — the DEV button's third tab.

## P8 — LIVE VISUAL TRANSLATION (called "LAST CRITICAL FUNCTION")

> "IF USER STANDS AT A ROW AND IT IS VISUALIZAZIBLE - IT THEN PRINTS THE VISUAL WITH THE
> TOOL TRACE LIVE (DIRECTION LITTLE SNOW THING BEAMING)"

- [ ] Cursor on a block → the alt view draws that block's geometry.
- [ ] Animate the tool trace along it, showing direction of cut.
- [ ] Must work on **both** the 426 and the 430.
- [ ] Both halves exist and have never been connected: `traceFor`/`traceTick` in
      `ui.new.js`, `pathSVG` in `flow.js`.

## P9 — TNC 430 FIVE-AXIS (research done, no code)

Manuals at `/private/tmp/claude-501/tnc430/research/` — `322_938-24.pdf`, `331_644-22.pdf`,
`de476.pdf` plus extracted text. **Session-scoped tmp. Copy into the project or lose it.**

- [ ] Copy the research into the project before it's wiped.
- [ ] `m430/` — the 430 as `window.TNC_MACHINES['430']`; `ui.new.js:70` already merges it.
- [ ] Five-axis kinematics and Klartext differences from the 426.
- [ ] Tool visuals from real spec and dimensions.
- [ ] Same meta-program functionality as the 426: user programs, example runs, good and bad
      lessons, visual translation, loading programs from the user's own space, save/download.

## P10 — DOCS AND HYGIENE

- [x] `devlog.txt` — DEV tab feature log, corrected 2026-09-23 to stop claiming unbuilt
      work was live.
- [x] `history.txt` — version history with highs and lows, brought current 2026-09-23.
- [x] `HANDOFF.md` — cold-start brief.
- [x] Big copyright block: © 2026 Daniel and Nebojsa Trifunovic Corp.
- [ ] Keep `devlog.txt`, `history.txt` and this file in step with each push.
- [ ] `~/.claude/CLAUDE.md` is 0 bytes since 2026-09-23 09:41 (backup in
      `~/.Trash/CLAUDE.md.bak-20260920`). Restore it or the standing rules keep getting lost.
- [ ] Decide on the 1.1 GB `~/Library/Caches/ms-playwright` — installed without asking.

---

## RULES THAT DON'T CHANGE

1. **Authentic TNC behaviour is critical.** Not "close enough".
2. **Fully interactive**, keyboard first — arrows, ENTER forward, ESC back, rest on screen.
3. **Ship a direct link.** Plain HTML file, never a claude.ai Artifact.
4. **If a tool is missing, name it and ask before installing.**
5. A DEV tab that lies on day one is worse than no DEV tab.

© 2026 Daniel and Nebojsa Trifunovic Corp.
