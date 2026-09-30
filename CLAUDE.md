# CLAUDE.md — TNC 426/430 Simulator (rules; state lives in CONTINUE.md)

## North star
A program written here must run **the same** on a real HEIDENHAIN TNC 426/430: same moves, same errors, same timing.
Authority order:
1. `research/tnc426_430_280476_manual_en.txt` (426/430, NC SW 280 476; gitignored)
2. the programming-station oracle (`docs/PROGRAMMING-STATION.md`)
3. the operator's answers (`private/`)
4. nothing else

The iTNC 530 manual/station counts only where the 426/430 sources are silent, and it is then labelled as such in code comments.
Where parity isn't verified, say so. Never present a guess as a fact. Placeholders are marked in code and listed in CONTINUE.md → OPEN.

## Stack — LOCKED (user decision 2026-09-30)
| Layer | What | Where |
|---|---|---|
| Interpreter + checks | plain JS: core.js, stock.js, sim.js, machines.js. **One implementation**, run in the browser AND in the server (QuickJS, `include_str!`) | `sim/` |
| Simulator UI + 3D | classic-script modules + three.js r186 (bundled by esbuild), one offline HTML via `python3 build.py` → `index.html` (GitHub Pages) | `sim/`, `build.py` |
| Server | Rust: axum, sqlx/SQLite, argon2, reqwest (OpenRouter proxy) | `server/` |
| Web app | React + Vite + CodeMirror; hosts the simulator in an iframe (`sim/bridge.js`). The React choice is still being reasoned about — see CONTINUE.md D-REACT | `web/` |
| Desktop | Tauri 2 (mac, Linux, Windows) — not started | — |

Not C#. Never port the interpreter out of JS: the server runs the same file.

## Rules that don't change
1. Authentic TNC behaviour. Not "close enough".
2. Keyboard-first and fully interactive.
3. The simulator always also ships as one plain HTML file that works offline without the server.
4. AI = OpenRouter only. Never Anthropic direct. Keys only in `private/.env` (gitignored) or on the server, never in tracked files.
5. Name any install and ask before running it. Never rebuild what exists: search GitHub, brew and npm first.
6. A DEV tab that lies is worse than none: keep `docs/FEATURES.txt` true.
7. No personal names or data in tracked files; personal material goes in `private/`.
8. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## How the user works
- Opus (main thread): priority work (interpreter, I/O, profiles, AI, server).
- Subagents:
  - Sonnet for cheap docs and content.
  - Opus for anything the user will judge by eye or by parity.
  - Worktree isolation and non-overlapping file scopes.
- Reason back and forth. Do not build further on an unconfirmed interpretation. Explain plainly: no riddles, no jargon walls.
- Test priority features (Playwright suite `.tools/qa/qa.mjs`, `tests/manual.js`, `cargo test`). Don't test low-priority visuals beyond a look.

## Layout
- `sim/`: simulator sources
- `server/`, `web/`: fullstack
- `tests/`:
  - `manual.js`: 426/430 manual examples
  - `corpus.js`: 2,806 real programs, `AUTOTOOLS=1`
- `docs/`: FEATURES (DEV tab), HISTORY, PROGRAMMING-STATION
- Gitignored:
  - `research/`, `search-heidenhain/`: manuals, GitHub clones
  - `.tools/`: node_modules, QA suite
  - `.libcache/`
  - `private/`
  - `local/`: scratch, logs

## End-of-run report (every agent, every run)
```
SOLVED   - <what> — <why it mattered>
RISK     - <not verified against manual/oracle, or "none">
NEXT     - <one item, cite its CONTINUE.md id>
```
