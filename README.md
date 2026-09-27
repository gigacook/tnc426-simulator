# TNC 426 / 430 Simulator

A browser-based CNC simulator that speaks HEIDENHAIN **Klartext** (conversational programming),
with live material removal. One self-contained HTML file — no build step for the user, no
server, no install.

### ▶ [Open the simulator](https://gigacook.github.io/tnc426-simulator/)

---

## What it does

- **Real Klartext interpreter.** `L`/`C`/`CC`/`CR`/`CP`/`LP` moves, `RL`/`RR` radius compensation
  (actual offset paths, not centreline), `RND`/`CHF`, `APPR`/`DEP` approach and departure, `ZX`/`YZ`
  plane arcs, Q-parameter formulas (`FN 0`–`FN 19`), jumps (`FN 9`/`FN 12`/`CALL LBL … REP`),
  a tool table, and a TNC-style error register.
- **Cycles:** 1, 2, 4, 17, 18, 200–215, 220, 221, 230, 231, plus the non-motion cycles 7–11, 32,
  247 (datum shift, mirror, rotation, scaling, datum point). See "Known simplifications" below
  for what's not implemented yet.
- **Material removal you can watch.** A height field over the blank; the tool stamps its real
  radius along every feed move. Scrub backwards and the blank is rebuilt from scratch. The
  removed volume in the status column is integrated from the height field, not estimated.
- **Materials and look.** Alloy and industry presets (aluminium, titanium, steel, stainless,
  brass, cast iron, turbine, aerospace, ground finish, cast) drive PBR color/metalness/roughness
  and chip/spark color. An environment map (`RoomEnvironment`), ACES filmic tone mapping and an
  FXAA pass give the render a shinier, less plastic look.
- **Four operating modes**, as on the control: PROGRAMMING AND EDITING, TEST RUN,
  PGM RUN SINGLE BLOCK, PGM RUN FULL SEQ — each with its own soft-key row.
- **Run comparison.** Store a finished run as reference A, change the program, run again, and read
  the delta on cycle time, feed path, rapid path, move count, min Z and removed volume.
- **Profiles.** One personal profile per browser (IndexedDB), autosaved, with a name prompt,
  export/import as `.zip` (Merge or Replace), and a per-machine tool table you can import/export
  as `TOOL.T`. Uploading a program that calls a tool not in the table creates it, the way a real
  control's tool table would grow on import.
- **Program I/O.** Load `.H`/`.I` files (UTF-8 or Windows-1252), `.zip` archives of programs, or
  drag-and-drop; save with `Ctrl+S` as a numbered TNC listing.
- **AI program generation.** Bring your own OpenRouter key (never sent anywhere but
  `openrouter.ai`; never Anthropic direct). Default model `deepseek/deepseek-v4.1-flash`. The
  prompt includes your own tool table, and a failed compile is fed back for one repair pass.
  Only exercised so far against a mocked OpenRouter in the QA suite — not yet run against the
  live API end to end in this repo's own testing.

## The programs

Ship on the control, selectable from the Program header. `TRIFUNOVIC.H` opens first — a
300 × 200 × 20 mm garage plate engraving the family name, with a 1 × 45° edge break and four
mounting holes. `TRIFUNOVIC_V2.H` is the same idea on a 220 × 60 × 10 mm blank, drawn with real
`CC`+`C` and `CR` arcs, for A/B comparison. `BRACKET.H` is the teaching one — a 120 × 80 × 20 mm
blank exercising `LBL`/`REP`, `FN` formulas, arcs and `CYCL DEF 200`.

All fully editable — block by block, or as raw text.

## Keys

| Key | Action | | Key | Action |
|---|---|---|---|---|
| `↑` `↓` | Block cursor | | `E` `I` `D` `C` | Edit / insert / delete / copy block |
| `←` `→` | Scrub the run | | `TAB` | Raw text editor |
| `ENTER` | Step one block | | `G` | 3D / TOP / FRONT / SIDE |
| `ESC` | Stop, cancel edit | | `1`–`5` | Speed 1× 4× 16× 64× MAX |
| `SPACE` | NC START / NC STOP | | `F1`–`F4` | Operating mode |
| `S` / `R` | Single block / reset | | `+` `−` | Feed override |

## Known simplifications

These are deliberate, and they are why the disclaimer at the bottom matters.

- **Material removal is a height field**, so it models what the tool sweeps from directly above
  (vertical tool axis only). Undercuts and side-wall engagement below an overhang are not
  represented, and there is no 5-axis / tilted-tool machining.
- **No FK (free contour programming).**
- **No `TCH PROBE`** touch-probe cycles. Real CAM output that calls them is correctly rejected —
  they're an iTNC 530/TNC 640 dialect extension, not in the 426/430 manual used as the authority
  here.
- **Cycles not yet implemented:** 3 (slot milling), 5 (circular pocket, old-style), 12 (PGM CALL),
  13 (orientation), 14/20–25 (contour/SL cycles), 19 (working plane), 26 (surface mirroring),
  27/28 (cylinder surface), 262–267 (thread milling).
- **`F AUTO`** is approximated as the feed from the `TOOL CALL` block (the real control reads it
  from a cutting-data table the simulator doesn't have).
- **Tools are auto-created on upload/import** if a program calls a `TOOL CALL` number missing
  from the current tool table — matching what happens when you import a program on a real
  control, but meaning an undefined-tool typo won't be caught by upload alone.
- **INCH is recorded, not converted.** `BEGIN PGM … INCH` sets the unit flag, but values are used
  as programmed. Write in millimetres.
- **Cycle time excludes dwell**, tool-change time and acceleration; the estimate is
  `sum(length / feed)` over the toolpath, so it reads optimistic against a real machine.

## Testing

- `node tests/manual.js` — the HEIDENHAIN 426/430 manual's own worked examples (linear, circular,
  C-CC, polar, helix, ellipse with Q formulas, inside corners, mirror, every implemented cycle).
  All pass. Caveat: expected values are derived from the manual's rules, not measured on a real
  control, so a misreading of the manual could pass its own test.
- `node tests/corpus.js` (`AUTOTOOLS=1` to auto-create missing tools, as an import would) —
  thousands of real-world CAM-exported programs. Most run clean; remaining failures are almost
  entirely `TCH PROBE 4xx` (correctly rejected iTNC dialect) and a spindle-state check in the
  tapping cycles that some real programs trip — open issue, see TODO.md.

## Build

`index.html` is generated from a data-driven module list — a new `.js` file is one line in
`build.py`'s `MODULES`. three.js r186, its addons (OrbitControls, RoomEnvironment,
FXAA/EffectComposer) and the [three.quarks](https://github.com/Alchemist0823/three.quarks)
particle library are bundled by esbuild from `vendor/three-entry.mjs` into one classic script
exposing `window.THREE` / `window.QUARKS` (needs `.tools/node_modules` — `cd .tools && npm i
three@0.186.1 three.quarks@0.17.1 esbuild@0.28.2`; `build.py` prints the exact command if it's
missing). JSZip and idb-keyval are fetched once into `.libcache/` and inlined the same way.
`window.QUARKS` is loaded but not yet used by any module — `fx.js` still does chips/sparks/coolant
without it.

```sh
python3 build.py      # -> index.html (public), index.local.html (only if .env has a key, gitignored)
```

| File | |
|---|---|
| `core.js` | Klartext parser, interpreter and cycle library. No DOM, no dependencies. |
| `sim.js` | Shared timing and arc tessellation, plus the safety analysis. |
| `programs.js` | The programs that ship on the control. |
| `lessons.js` | LEARN, BREAK IT, the power-user manual, and the AI system prompt. |
| `tools3d.js` | Real tool geometries in their holders. |
| `callouts.js` | View-aligned leader-line labels (TOOL, TOOL HOLDER, PART). |
| `flow.js` | The program-as-flowchart alternative view. |
| `fx.js` | Chips, sparks, coolant spray, smoke/fire, crash burst. |
| `materials.js` | Alloy/industry presets and the material picker. |
| `look.js` | Environment map, ACES tone mapping, FXAA. |
| `profile.js` | Per-browser profile, program storage, tool table, import/export. |
| `ai.js` | OpenRouter-only AI program generation, BYOK. |
| `ui.js` | Graphics, material removal, transport, keyboard, comparison, plugin bus (`TNC_UI`). |
| `sim-shell.html` | Markup and stylesheet. |
| `devlog.txt`, `history.txt` | Feature log and version history, shown behind the DEV button. |
| `orbital.html` | An earlier, unrelated toy: the control unit as an explodable 3-D model. |

`.tools/qa/qa.mjs` is a Playwright QA pass (profile, program I/O, tool table, AI) run against a
built `index.html`, separate from `tests/`.

## Where the work stands

The task list is [TODO.md](TODO.md) — every outstanding item, whether started or not.
See [HANDOFF.md](HANDOFF.md) for a cold-start brief. `devlog.txt` and `history.txt` are the
same picture as a feature log and a version history.

## Licence

MIT — see [LICENSE](LICENSE). Bundles [three.js](https://github.com/mrdoob/three.js) r186 and
[three.quarks](https://github.com/Alchemist0823/three.quarks), both MIT. (`LICENSE`'s own bundled-library
note still says r128 — see TODO.md.)

Not affiliated with, endorsed by, or connected to DR. JOHANNES HEIDENHAIN GmbH.
"HEIDENHAIN" and "TNC" are their trademarks. This is an independent educational simulator
and is not suitable for verifying programs intended to run on real machinery.
