# CONTINUE.md — machine-readable project state (read after CLAUDE.md)

<!-- FORMAT: every item has an ID, STATUS, SCOPE (the only files an agent may touch for it), CHECK (how "done" is proven).
     STATUS ∈ todo | doing | blocked(<reason>) | done | dropped. Update this file in the same commit as the work. -->

META
- updated: 2026-09-30
- branch: main (fullstack merged)
- entry: user says "continue" → read CLAUDE.md, then this file, then act on the top `todo` item in BACKLOG whose `blocked` is empty

## STATE (verified facts; how verified)
| key | value | check |
|---|---|---|
| interpreter manual tests | ALL PASS | `node tests/manual.js` |
| real-program corpus | 2,767 / 2,806 clean. The 39 left are malformed programs a real TNC also rejects | `AUTOTOOLS=1 node tests/corpus.js` |
| rust | 25 tests pass | `cd server && cargo test` |
| browser QA | 93/93 on e20d0d5; not re-run since the sim/ move | `cd .tools/qa && node qa.mjs` |
| AI | runs against the real OpenRouter API (user ran it manually, real model outputs). QA uses a mocked route so it spends no key | — |
| cycles | 1 2 4 7 8 9 10 11 17 18 19 32 200–215 220 221 230 231 247 262 263 264 265 267; TCH PROBE 408–413 417 419 (motion), 30–33 480–483 562 (no motion) | `tests/manual.js` |
| material model | `sim/stock.js`: height field; tilted tool cuts along its axis; no undercuts | — |
| vice | standard 160 mm vice, jaws on the Y faces, grips the bottom 6 mm; ON; toggle under Effects & view | — |
| holder | DIN 69871 ISO 50 (A=100) / SK40 (A=70), ER32 nut Ø50. The crash check uses nut R = max(25, toolR+6); L=0 → check skipped | `sim/stock.js` NUT_R |

## DECISIONS (don't re-litigate)
| id | date | decision |
|---|---|---|
| D-STACK | 09-30 | Locked: JS interpreter (one copy, browser + QuickJS in Rust), three.js, Rust server, Tauri 2 desktop. |
| D-CSHARP | 09-30 | No C#. |
| D-REACT | 09-30 | Open: reasoned, awaiting the user. See the chat of 09-30; recommendation in ASK. |
| D-GFX | 09-30 | No new engine: stay on three.js r186. Realism via colour management, tone mapping, HDRI, AO and shadows. GPU = visuals only; the CPU stays authoritative for moves and checks (B13). |
| D-PROBE | 09-30 | TCH PROBE implemented ("future proof") although the 426/430 manual doesn't cover it; iTNC 530 semantics, labelled in code. |
| D-DROPPED | 09-30 | C rotary table, the single-block "line 19" report, new BREAK IT lessons. Never re-list. |
| D-AI | 09-30 | Recommend DeepSeek V4.1 Flash. Frontier models one click away; full searchable/sortable list and free typing too (B1). |

## BACKLOG (priority order)
| id | status | goal | scope | check |
|---|---|---|---|---|
| B1 | todo | **AI model picker**: recommended (DeepSeek V4.1 Flash) + frontier quick picks computed from the live OpenRouter list (newest per major provider) + a sleek sortable, filterable table (name, provider, context, $/M in, $/M out) + free-text id. One source of truth for model lists; delete the stale `MODELS`/`AI_REC` lists. | `sim/ai.js`, the AI section of `sim/ui.js`, AI styles in `sim/sim-shell.html` | QA AI section passes; picks persist per profile |
| B2 | todo | **Graphics realism** ("no flat plastic"): colour management ON + AgX/ACES tone mapping, a real studio/workshop environment (procedural or small embedded HDR), soft shadows, SSAO/GTAO, machined-aluminium cut-surface material with tool-mark banding, blank/vice/table materials. Retune every colour after colour management. | `sim/look.js`, `sim/materials.js`, `sim/tools3d.js`, the renderer/light setup block of `sim/ui.js` | before/after screenshots; no page errors; fps ≥ 30 at default size on the swiftshader QA run |
| B3 | blocked(B4) | **Programs to the machine: all obvious paths.** (a) USB stick: export .H / TOOL.T with TNC-safe names and CRLF, Latin-1. (b) Ethernet LSV-2 (TNCremo protocol; 426/430 manual §12.5; check `pyLSV2` licence and 426/430 support before writing our own). (c) RS-232 serial (V.24; FE1 / FE2 / EXT blockwise per manual ch. 12). Both directions. | new `desktop/` (Tauri, Rust side), `server/crates/tnc-formats` | round-trip on the programming station (B5); later on the real machine |
| B4 | todo | **Tauri 2 desktop** shell (mac/Linux/Windows) hosting web + sim; local mode = the same server crates in-process with a local SQLite. | new `desktop/` | builds on macOS; CI builds all three |
| B5 | blocked(user: Windows VM + HEIDENHAIN station demo) | **Programming-station oracle**: golden set 15–25 programs, capture moves/errors/timing, `tests/golden/*.json` + `tests/station.js`. Settles every OPEN item. | `tests/`, `docs/PROGRAMMING-STATION.md` | golden diff report |
| B6 | todo | Interpreter coverage: SL contour cycles 14/20–25 (common on real 426 programs), 3, 5, 12 PGM CALL, 13, 26, 27/28, FK, F AUTO. Manual-first; tests per cycle. | `sim/core.js`, `sim/dialogs.js`, `tests/` | manual.js pass; corpus not worse |
| B7 | todo | CI: GitHub Action = `node tests/manual.js` + `cargo test` + web type-check/build + `python3 build.py`; deploy Pages from CI instead of committing index.html. | `.github/` | green run |
| B8 | todo | Docs to reality: README (layout moved to sim/, fullstack), `docs/FEATURES.txt` (DEV tab; still says TCH PROBE/thread milling missing), `docs/HISTORY.txt`. Sonnet job. | `README.md`, `docs/` | no statement contradicts STATE |
| B9 | todo | Wire `probeSpec` to a TOUCH PROBE soft key; `TCHPROBE` node in flow.js. | `sim/ui.js` soft keys, `sim/flow.js` | manual click-through |
| B10 | todo | Live visual translation: `traceFor`/`traceTick` (ui.js) → `pathSVG` (flow.js). | `sim/ui.js`, `sim/flow.js` | — |
| B11 | todo | TNC 430 remainder: dexel/voxel stock for undercuts (GPU candidate, B13), radius comp in a tilted plane. | `sim/stock.js`, `sim/core.js` | — |
| B12 | todo | Re-run the QA suite after the sim/ move and B1/B2; adapt selectors. | `.tools/qa/` | all pass |
| B13 | todo | GPU offload design: material removal and previews on the GPU (three.js WebGPURenderer + compute, WebGL2 fallback), thumbnails in an OffscreenCanvas worker. Checks stay CPU (must match the server's QuickJS run). No custom drivers. | design note first, then `sim/stock.js` render side | — |

## OPEN — placeholders, NOT facts (settle via B5 or the operator; each is marked in code)
| id | where | placeholder |
|---|---|---|
| T1 | core.js cycleThread | helix = whole turns at thread depth, start on +X |
| T2 | core.js cycleThread | approach: semicircle from the centre, +½ pitch in Z; departure: flat semicircle; no small-tool side pre-positioning |
| T3 | core.js cycleThread | 267 start = R + pitch from the stud; ends above that point |
| T4 | core.js cycleThread | 263 countersink circle at the core Ø not simulated (plunge to Q356 only) |
| T5 | core.js cycleThread | 264 countersink feed = Q206 |
| T6 | core.js cycles | positive depths: sign ignored (the manual says a positive depth reverses direction) |
| T7 | core.js cycleThread | no error for M4 / spindle off on 262/263/264/267 |
| P1–P7 | core.js TCH PROBE | MP 6140 = 2 mm; Q261 tip = Q261 − stylus R; Q305=0 keeps cycle 7 on top; Q303=0 tables not simulated; presets translation-only; touch order from the figures; 419/Q381 write no results |
| V1 | stock.js VICE | jaw axis Y, grip 6, jaw 160×25 — standard guess, not the operator's vice |
| V2 | stock.js HEAD_LEN | tilted head = 300 mm cylinder of holder radius |

## ASK — waiting on the user
- A1: React for the web app: keep as a thin shell, or replace? (D-REACT)
- A2: How does the operator move programs today, and does his 430 have the Ethernet card? (B3; user: "probably from a PC at his company, USB stick; Ethernet card should also be supported")
