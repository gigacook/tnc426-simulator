# TNC 426 Simulator

A browser-based CNC simulator that speaks HEIDENHAIN **Klartext** (conversational programming),
with live material removal. One self-contained HTML file — no build step, no server, no install.

### ▶ [Open the simulator](https://gigacook.github.io/tnc426-simulator/)

---

## What it does

- **Real Klartext interpreter.** `L` with modal feed and incremental `IX/IY/IZ`, `CC`+`C` and `CR`
  arcs with `DR+`/`DR-`, drilling cycles `200` / `201` / `203`, pocket cycle `4`, `LBL` as both
  subprogram call and program-section repeat (`CALL LBL n REP r/r`), Q parameters with `FN 0`–`FN 4`,
  modal M-functions, a tool table, and a TNC-style error register.
- **Material removal you can watch.** A height field over the blank; the tool stamps its real radius
  along every feed move. Scrub backwards and the blank is rebuilt from scratch. The removed volume
  in the status column is integrated from the height field, not estimated.
- **Four operating modes**, as on the control: PROGRAMMING AND EDITING, TEST RUN,
  PGM RUN SINGLE BLOCK, PGM RUN FULL SEQ — each with its own soft-key row.
- **Run comparison.** Store a finished run as reference A, change the program, run again, and read
  the delta on cycle time, feed path, rapid path, move count, min Z and removed volume.

## The programs

Three ship on the control, chosen from the selector in the Program header.
`TRIFUNOVIC.H` opens first — a 300 × 200 × 20 mm garage plate engraving the family name,
with a 1 × 45° edge break and four mounting holes. `TRIFUNOVIC_V2.H` is the same idea on a
220 × 60 × 10 mm blank, drawn with real `CC`+`C` and `CR` arcs, for A/B comparison.

`BRACKET.H` is the teaching one — a 120 × 80 × 20 mm blank:

| Step | What it exercises |
|---|---|
| Face the top with T6 | modal feed, rapid positioning |
| Rectangular pocket, 4 passes | `LBL 1` / `CALL LBL 1 REP 3/3`, `FN 0` + `FN 1` as a depth counter |
| Circular slot | `CC` + two `C … DR+` half-circles |
| 4 holes | `CYCL DEF 200 DRILLING` called blockwise with `M99` |

Fully editable — block by block, or as raw text.

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

- **Radius compensation** `RL` / `RR` is parsed and displayed, but the path is drawn on the tool
  centreline rather than offset. Contours sit one tool radius off compared to a real TNC.
- **INCH is recorded, not converted.** `BEGIN PGM … INCH` sets the unit flag, but values are used
  as programmed. Write in millimetres.
- **Cycle time excludes dwell.** `Q210` / `Q211` are honoured as cycle structure but add no
  seconds; the estimate is `sum(length / feed)` over the toolpath and ignores acceleration,
  tool changes and dwell, so it reads optimistic against a real machine.
- **Chip breaking** in cycle 203 (`Q213`) is a short in-place retract rather than the exact
  HEIDENHAIN distribution, which the manual leaves ambiguous.
- **Narrow pockets in cycle 4** collapse their innermost passes to a slot traversed out and back.
  Geometrically correct for a closed contour, but it emits one redundant return pass.
- **Material removal** is a height field, so it models what the tool tip sweeps from above.
  Undercuts and side-wall engagement below an overhang are not represented.

## Build

`index.html` is generated — it inlines three.js, the interpreter and the UI into one file.

```sh
python3 build.py      # sim-shell.html + core.js + sim.js + programs.js + ui.js  ->  index.html
```

| File | |
|---|---|
| `core.js` | Klartext parser, interpreter and cycle library. No DOM, no dependencies. |
| `sim.js` | Shared timing and arc tessellation, plus the safety analysis. |
| `programs.js` | The programs that ship on the control. |
| `ui.js` | Graphics, material removal, transport, keyboard, comparison. |
| `sim-shell.html` | Markup and stylesheet. |
| `devlog.txt`, `history.txt` | Feature log and version history, shown behind the DEV button. |
| `orbital.html` | An earlier, unrelated toy: the control unit as an explodable 3-D model. |

## Where the work stands

The task list is [TODO.md](TODO.md) — every outstanding item, whether started or not.
See [HANDOFF.md](HANDOFF.md) for what is built, what is written but not yet wired into the
build, and what has not been started. `devlog.txt` is the same picture as a feature list.

## Licence

MIT — see [LICENSE](LICENSE). Bundles [three.js](https://github.com/mrdoob/three.js) r128, also MIT.

Not affiliated with, endorsed by, or connected to DR. JOHANNES HEIDENHAIN GmbH.
"HEIDENHAIN" and "TNC" are their trademarks. This is an independent educational simulator
and is not suitable for verifying programs intended to run on real machinery.
