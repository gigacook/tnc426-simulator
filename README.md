# TNC 426 / 430 Simulator

A browser-based CNC simulator that speaks HEIDENHAIN **Klartext** (conversational programming),
with live material removal. The simulator itself is one self-contained HTML file — no build step
for the operator, no server, no install.

### ▶ [Open the simulator](https://gigacook.github.io/tnc426-simulator/)

---

## What it does

- **Real Klartext interpreter.** `L`/`C`/`CC`/`CR`/`CP`/`LP`/`CTP` moves, `RL`/`RR` radius
  compensation (actual offset paths, not centreline), `RND`/`CHF`/`CT`, `APPR`/`DEP` approach and
  departure, `ZX`/`YZ` plane arcs, Q-parameter formulas (`FN 0`–`FN 19`), jumps (`FN 9`/`FN 12`/
  `CALL LBL … REP`), a tool table, and a TNC-style error register.
- **Cycles:** 1, 2, 4, 17, 18, 200–215, 220, 221, 230, 231, and thread milling 262–265/267, plus
  the non-motion cycles 7–11, 19, 32, 247 (datum shift, mirror, rotation, scaling, tolerance,
  working plane, datum point). See "Known simplifications" below for what's not implemented yet.
- **Touch probe.** `TCH PROBE` blocks parse. Datum-setting cycles 408–413, 417 and 419 move and
  write nominal results; tool-measuring cycles 30–33, 480–483 and 562 are recognized with no
  motion. Other cycle numbers report `TCH PROBE n NOT IMPLEMENTED IN SIMULATOR` rather than
  silently doing nothing.
- **Two machines.** TNC 426 (X Y Z) and TNC 430 (X Y Z plus an A/B swivel head, tilted-tool
  cutting via cycle 19). Machine parameters live in `sim/machines.js`, shared with the server's
  interpreter so a program compiles the same way in both places.
- **Material removal you can watch.** A height field over the blank; the tool stamps its real
  radius along every feed move, including a tilted tool on the TNC 430. Scrub backwards and the
  blank is rebuilt from scratch. The removed volume in the status column is integrated from the
  height field, not estimated. A standard vice (toggle) checks the tool and holder against the
  jaws.
- **Materials and look.** Alloy and industry presets (aluminium, titanium, steel, stainless,
  brass, cast iron, turbine, aerospace, ground finish, cast) drive PBR color/metalness/roughness
  and chip/spark color. An environment map (`RoomEnvironment`), ACES filmic tone mapping and an
  FXAA pass give the render a shinier, less plastic look.
- **Four operating modes**, as on the control: PRG EDIT, TEST, SINGLE-BLOCK, FULL-RUN — each with
  its own soft-key row. PRG EDIT has one-question-per-step dialogs for `CYCL DEF`, `TOOL DEF`,
  `TOOL CALL` and the path functions, so a block can be built without typing raw Klartext.
- **Run comparison.** Store a finished run as reference A, change the program, run again, and read
  the delta on cycle time, feed path, rapid path, move count, min Z and removed volume.
- **Profiles.** One personal profile per browser (IndexedDB), autosaved, with a name prompt,
  export/import as `.zip` (Merge or Replace), and a per-machine tool table you can import/export
  as `TOOL.T`. Uploading a program that calls a tool not in the table creates it, the way a real
  control's tool table would grow on import.
- **Program I/O.** Load `.H`/`.I` files (UTF-8 or Windows-1252), `.zip` archives of programs, or
  drag-and-drop; save with `Ctrl+S` as a numbered TNC listing.
- **AI program generation.** Bring your own OpenRouter key (never sent anywhere but
  `openrouter.ai`; never Anthropic direct). Default model `deepseek/deepseek-v4.1-flash`, with a
  picker for any OpenRouter model. The model gets the tool table as **constraints** (type, Ø,
  reach before the holder touches, smallest inside corner, plunge rules, safe S/F) and the list of
  what the control does *not* have. It first **plans the part** as a spec (faces, pockets, holes,
  slots, outside profiles, engraved text — the "interim 3-D model"); lettering is expanded into the
  simulator's own single-stroke capitals so the model never has to invent letter shapes. Then it
  writes the program, the simulator runs every check, **machines it on the height field and
  measures the result against the spec** in mm (what is not cut, what is cut that should stay, per
  feature and by position), and up to 3 refinement rounds send that back. Answers cut off by the
  token limit are continued instead of dropped (default budget 32 000 tokens per request, thinking
  included; low reasoning by default), a dropped connection is retried once, and a refinement that
  fails keeps the best program so far. See "AI accuracy" below for measured numbers.
- **Swedish and English** interface language, set from the profile dialog.
- **Phones and tablets.** Under 900 px the simulator becomes three workspaces — Program,
  Graphics, Status — in the page's own vertical scroll, picked with tabs or a sideways swipe. The
  soft keys (and the block line in PRG EDIT) sit in a dock at the bottom of every workspace, eight
  at a time like the control's soft-key row, so NC START / STOP / RESET are always one tap away.
  The header keeps the four modes, the program, the run state and the check count; DEV, + New,
  Lessons, AI, Help, Focus and the profile live behind **Menu**. Dialogs become full-height sheets
  that stay above the software keyboard. The desktop layout is unchanged.

## The programs

Ship on the control, selectable from the Program header. `NAMEPLATE.H` opens first — a
300 × 200 × 20 mm garage plate engraving the family name, with a 1 × 45° edge break and four
mounting holes. `NAMEPLATE_V2.H` is the same idea on a 220 × 60 × 10 mm blank, drawn with real
`CC`+`C` and `CR` arcs, for A/B comparison. `BRACKET.H` is the teaching one — a 120 × 80 × 20 mm
blank exercising `LBL`/`REP`, `FN` formulas, arcs and `CYCL DEF 200`.

All fully editable — block by block, or as raw text.

## Keys

| Key | Action | | Key | Action |
|---|---|---|---|---|
| `↑` `↓` | Block cursor | | `E` `I` `D` `C` | Edit / insert / delete / copy block |
| `←` `→` | Scrub the run (Shift ×5) | | `TAB` | Raw text editor |
| `ENTER` | Step one block / edit in PRG EDIT | | `G` | 3D / TOP / FRONT / SIDE |
| `ESC` | Stop, cancel edit | | `1`–`4` | Operating mode |
| `SPACE` | NC START / NC STOP | | `5`–`9` | Speed 1× 4× 16× 64× MAX |
| `S` / `R` | Single block / reset | | `T` | Tool table |
| `M` | Programs | | `F` | Focus view (listing + graphics only) |
| `H` | Help, lessons, manual | | `+` `−` | Feed override |
| `Ctrl+S` / `Ctrl+O` | Save / load `.H` | | `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |

In PRG EDIT: `Y` CYCL DEF, `W` TOOL CALL, `A` APPR/DEP, `Q` Q-parameter, with soft keys for the
path functions, `TOOL DEF` and `LBL`.

## Known simplifications

These are deliberate, and they are why the disclaimer at the bottom matters.

- **Material removal is a height field**, so it models what the tool sweeps along its own axis —
  including a tilted tool on the TNC 430 — but not undercuts or side-wall engagement below an
  overhang. Radius compensation inside a tilted working plane is approximate.
- **No FK (free contour programming).**
- **Touch probe is partial.** Only the cycles listed above move or write results; the rest report
  "NOT IMPLEMENTED IN SIMULATOR". Several details (MP 6140 clearance, exact stylus placement,
  datum-table cycles, touch-point order) are read from the iTNC 530 manual, not the 426/430
  probe manual, and are marked as open points — see CONTINUE.md.
- **Thread milling** (cycles 262–265, 267) runs, but several details the 426/430 manual doesn't
  give numbers for — helix start angle, approach/departure geometry, small-tool side
  pre-positioning, the sign of a positive depth — are placeholders, not verified facts. See
  CONTINUE.md.
- **Cycles not yet implemented:** 3 (slot milling), 5 (circular pocket, old-style), 12 (PGM
  CALL), 13 (orientation), 14/20–25 (contour/SL cycles), 26 (surface mirroring), 27/28 (cylinder
  surface).
- **The standard vice** (160 mm jaws, on by default) uses guessed dimensions, not the operator's
  actual vice. Probe moves skip the vice check.
- **`F AUTO`** is approximated as the feed from the `TOOL CALL` block (the real control reads it
  from a cutting-data table the simulator doesn't have).
- **Tools are auto-created on upload/import** if a program calls a `TOOL CALL` number missing
  from the current tool table — matching what happens when you import a program on a real
  control, but meaning an undefined-tool typo won't be caught by upload alone.
- **INCH is recorded, not converted.** `BEGIN PGM … INCH` sets the unit flag, but values are used
  as programmed. Write in millimetres.
- **Cycle time excludes dwell**, tool-change time and acceleration; the estimate is
  `sum(length / feed)` over the toolpath, so it reads optimistic against a real machine.

## Fresh checkout

Everything needed is tracked or regenerable; nothing depends on a developer's machine.

```sh
npm ci                                  # build + QA tooling (three, three.quarks, esbuild, playwright, axe, tauri-cli)
python3 build.py                        # -> index.html (also fetches JSZip + idb-keyval into .libcache/ once)
node tests/manual.js && node tests/part.js && node tests/ai/loop.js
(cd server && cargo test)               # Rust server: 27 tests, temporary SQLite databases
(cd web && npm ci && npm run build)     # web app -> web/dist
node tests/ui/run.mjs                   # browser suite (Chromium; WebKit when Playwright has it)
```

Not in the repository, on purpose: `research/` and `search-heidenhain/` (the 426/430 manual and
the 2,806-program corpus — licensed / third-party; `tests/corpus.js` needs them and cannot run
without), `private/` (keys, operator notes), `.libcache/`, `node_modules/`, build output. The
server creates and migrates its own SQLite database on first start (`server/.env.example` lists
every setting). A local OpenRouter key goes in `private/.env` (`OPENROUTER_API_KEY=…`); `build.py`
then also writes `index.local.html` with it (gitignored) and refuses to build if the key ever
appears in the public `index.html`. No key is needed to build, run or test: AI tests use a mocked
OpenRouter.

## Testing

- `node tests/manual.js` — the HEIDENHAIN 426/430 manual's own worked examples (linear, circular,
  C-CC, polar, helix, ellipse with Q formulas, inside corners, mirror, every implemented cycle).
  All pass. Caveat: expected values are derived from the manual's rules, not measured on a real
  control, so a misreading of the manual could pass its own test.
- `node tests/corpus.js` (`AUTOTOOLS=1` to auto-create missing tools, as an import would) —
  2,806 real-world CAM-exported programs, 2,767 clean. The rest are broken programs (prose in NC
  lines, bracket formulas, bad `BEGIN PGM` names) that a real TNC would reject too.
- `node tests/part.js` — the AI's interim 3-D model: a correct program scores high against its
  part spec, a wrong one low, misses and gouges are located; lettering from the stroke font.
- `node tests/ai/loop.js` — the AI loop against a mocked OpenRouter: cut-off answers continued,
  plan → write → measure → refine, the best program kept. No network.
- `node tests/ui/run.mjs` — browser regression suite (tracked; replaces the old untracked
  `.tools/qa/qa.mjs`, which is not in the repository and was not restored): no page-level
  horizontal overflow at 320 / 360 / 390 / 430 / 768 / 1440 px and a 844 × 390 landscape, in
  English and Swedish; touch-target sizes; the phone drawer (modal: focus, inert background, Esc,
  focus return); workspace tabs (keyboard, ARIA); swipes (and that they never fire from the 3-D view
  or a vertical drag); state kept across workspaces (cursor, scroll, the same WebGL context);
  soft-key paging; NC START from the dock; editing a block on a phone; dialog focus traps;
  shortcuts vs typing; AI against a mocked OpenRouter; axe-core scans; and, when the Rust server is
  built, the simulator and web app under the desktop app's CSP. Screenshots in `local/ui-shots/`.
  Emulation is not a device test: Chromium phone emulation is not Android Chrome + TalkBack, and
  Playwright WebKit (CI only) is not iOS Safari + VoiceOver.
- `node tests/ai/bench.mjs` — **live** AI benchmark (needs a key, costs a few cents, never in CI):
  scores generated programs against hand-written reference geometry.

## AI accuracy

Measured with `tests/ai/bench.mjs` (DeepSeek V4.1 Flash, 2026-10-03; "match" = removed-volume
overlap of the final program's cut with a hand-written reference part, 100 % = exact):

| Part (prompt gives exact sizes) | Before (one repair round, 12k tokens) | Now (plan + measure + refine, 32k tokens, low reasoning) |
|---|---|---|
| Plate: face, 60 × 30 pocket R6, four Ø8.5 through holes | 73.8 % and 68.8 % (two runs) — pocket walls milled, the middle left standing | 99.2 % (2 rounds, 117 s, $0.04) |
| Name plate: WORKSHOP engraved, 25 mm capitals | 33.7 % — its own letter shapes, wrong blank thickness | 96.1 % (1 round, 18 s) |
| Round pocket Ø50 + 10 mm slot | 98.2 % | 99.8 % (1 round, 161 s) |
| Outside shoulder 90 × 50 R5, 3 deep | no program: the model spent the whole budget thinking | 100 % (1 round, 156 s) |

One run per cell (two for the old plate), so treat single numbers as indicative, not as a
distribution. At *medium* reasoning the plate also reached 100 % but took ~10 minutes (the model
thought through the 32k budget twice), so the default is *low*. The lettering score is measured
against the simulator's own stroke font, which the new pipeline uses and the old one could not
know. Fable and other models were not benchmarked here. Reproduce: `OPENROUTER_API_KEY=…
node tests/ai/bench.mjs` (outputs in `local/ai-bench/`).

## Build

`index.html` is generated from a data-driven module list in `build.py` — a new `.js` file under
`sim/` is one line in `MODULES`. three.js r186, its addons (OrbitControls, RoomEnvironment,
FXAA/EffectComposer) and the [three.quarks](https://github.com/Alchemist0823/three.quarks)
particle library are bundled by esbuild from `sim/vendor/three-entry.mjs` into one classic script
exposing `window.THREE` / `window.QUARKS` (versions pinned in the root `package.json` /
`package-lock.json`: `npm ci`; the older untracked `.tools/node_modules` layout still works). JSZip and idb-keyval are fetched once into `.libcache/` and inlined the same way.
`fx.js` runs its particles on `window.QUARKS` (three.quarks), falling back to its own built-in
renderer if that's missing.

```sh
python3 build.py      # -> index.html (public), index.local.html (only if .env has a key, gitignored)
```

| File | |
|---|---|
| `sim/core.js` | Klartext parser, interpreter and cycle library. No DOM, no dependencies. |
| `sim/machines.js` | Machine parameters for the 426/430, shared with the server's interpreter. |
| `sim/stock.js` | Material model: height field, tilted-tool cutting, vice. |
| `sim/sim.js` | Shared timing and arc tessellation, plus the safety analysis. |
| `sim/programs.js` | The programs that ship on the control. |
| `sim/lessons.js` | LEARN, BREAK IT, the power-user manual, and the AI system prompt. |
| `sim/tools3d.js` | Real tool geometries in their holders. |
| `sim/callouts.js` | View-aligned leader-line labels (TOOL, TOOL HOLDER, PART). |
| `sim/flow.js` | The program-as-flowchart alternative view. |
| `sim/fx.js` | Chips, sparks, coolant spray, smoke/fire, crash burst. |
| `sim/materials.js` | Alloy/industry presets and the material picker. |
| `sim/look.js` | Environment map, ACES tone mapping, FXAA. |
| `sim/profile.js` | Per-browser profile, program storage, tool table, import/export. |
| `sim/part.js` | Part spec for the AI: target height field, single-stroke lettering, program-vs-target measurement. |
| `sim/ai.js` | OpenRouter-only AI program generation, BYOK. |
| `sim/bridge.js` | Bridge to the server and web app below (inactive without a server). |
| `sim/viz.js` | Axis vectors from program zero to the tool, click-to-pick coordinates. |
| `sim/dialogs.js` | Programming dialogs: path functions, CYCL DEF, TOOL CALL. |
| `sim/i18n.js` | Interface language strings (English/Swedish). |
| `sim/ui.js` | Graphics, material removal, transport, keyboard, comparison, plugin bus (`TNC_UI`). |
| `sim/sim-shell.html` | Markup and stylesheet. |
| `docs/FEATURES.txt`, `docs/HISTORY.txt` | Feature log and version history, shown behind the DEV button. |

## Beyond the single file

- `server/` — a Rust server (axum, SQLite) that runs `sim/core.js` in embedded QuickJS, so a
  program the server checks gets the same result as the browser. Accounts, a versioned program
  library, per-machine tool tables, share links, and an AI proxy to OpenRouter.
- `web/` — a React app (Vite, TypeScript) that talks to the server: sign in, edit and check
  programs, browse and restore versions, share a program by link.
- `desktop/` — the **desktop app** (Tauri 2; macOS, Linux, Windows). It runs the server's own crate
  in-process on `127.0.0.1` with a SQLite database in the platform's app-data folder, signs the
  local operator in by a one-time link, and shows the web app with the simulator — no separate
  server, no install of anything else. See "Desktop app" below.

## Desktop app

```sh
npm ci                                   # once: installs the Tauri CLI (and the build tooling)
cd desktop && npx tauri dev              # debug window; builds web/dist + index.html first
cd desktop && npx tauri build            # release bundles in desktop/src-tauri/target/release/bundle/
```

Linux needs WebKitGTK 4.1 (`libwebkit2gtk-4.1-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
librsvg2-dev libxdo-dev libssl-dev`); macOS needs Xcode command-line tools; Windows needs the
MSVC build tools and WebView2 (preinstalled on Windows 10/11). The bundles are **unsigned**:
code signing and notarisation need certificates as CI secrets and are not set up.

How it works: the window opens a bundled splash page, the app opens the database (data folder:
`~/.local/share/io.github.gigacook.tnc426simulator` on Linux, `~/Library/Application Support/…`
on macOS, `%APPDATA%\…` on Windows), makes sure the local operator account exists, starts the
server on a remembered loopback port (8427 first; browser storage is per port, so it is kept),
waits for `/api/health`, then navigates to a one-time sign-in link. Hardening: loopback only;
requests whose `Host` is not our own `127.0.0.1:<port>` / `localhost:<port>` are refused (no DNS
rebinding); a Content-Security-Policy on every response (`connect-src` only self and
`openrouter.ai`); the page gets no Tauri IPC at all; links to anything else open in the system
browser; a second launch focuses the first window instead of starting a second server. AI in the
desktop app is BYOK (the key stays in the simulator, straight to OpenRouter) unless
`OPENROUTER_API_KEY` is set in the environment, which routes it through the in-process proxy.

Native iOS / Android (Tauri mobile) targets are not set up; on phones use the browser.

The GitHub Pages simulator above stays a self-contained single file either way — the server and
web app are an optional layer around it, not a replacement for it.

## Where the work stands

[CONTINUE.md](CONTINUE.md) is the current state and backlog. `docs/FEATURES.txt` and
`docs/HISTORY.txt` are the same picture as a feature log and a version history, both shown in the
simulator's DEV tab.

## Licence

MIT — see [LICENSE](LICENSE). Bundles [three.js](https://github.com/mrdoob/three.js) r186 and
[three.quarks](https://github.com/Alchemist0823/three.quarks), both MIT.

Not affiliated with, endorsed by, or connected to DR. JOHANNES HEIDENHAIN GmbH.
"HEIDENHAIN" and "TNC" are their trademarks. This is an independent educational simulator
and is not suitable for verifying programs intended to run on real machinery.
