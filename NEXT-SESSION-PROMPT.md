# Paste this into a new session

---

You're taking over a browser-based HEIDENHAIN TNC 426/430 simulator. It's a gift from Daniel to
his father Nebojsa, a CNC engineer. Authentic TNC behaviour is the product.

**Repo:** `/Users/danieltrifunovic/Developer/sandbox/mac_tnc426-orbital` (git, remote `origin`)
**Live:** https://gigacook.github.io/tnc426-simulator/
**HEAD as of the last docs sync (2026-09-27):** `9618cce` — this repo moves fast; run
`git log --oneline -5` before trusting any commit hash written down in these docs.

Read in this order, then start: **`TODO.md`** (the task list, authoritative), `HANDOFF.md`
(cold-start detail), `CONTINUE.md` if present (same-day pickup note, may be more current than
this file), `devlog.txt`. Don't re-plan what's in them — but do re-verify anything you're about
to act on with `git log`, not just trust the prose, since these files go stale fast.

## Verify before you trust anything, including this file

```sh
git log --oneline -15
node tests/manual.js                       # manual's worked examples — should all pass
AUTOTOOLS=1 node tests/corpus.js | head -5  # real CAM programs — should be ~2,495/2,806 clean
cd .tools/qa && cp ../../index.html under-test.html && node qa.mjs   # 51/52 Playwright checks
```

## The situation in one line, as of the last sync

Interpreter, UI, profiles, program I/O, AI (OpenRouter-only), materials/look, and the three.js
r128→r186 + three.quarks upgrade are all **shipped and in the build**. What's left is real
outstanding work, not "written but not wired in" — check `TODO.md` before assuming otherwise.

## Do it in this order — cheapest lever first

1. **`SPINDLE ?` false alarms** — ~399 real programs trip the tapping cycles' spindle check
   (`cycleTap` in `core.js`). Fix against the manual's actual M-function timing, not just against
   the corpus.
2. **Fix the stale QA check** — `.tools/qa/qa.mjs` feature 5 still expects `TOOL 27 NOT DEFINED`
   after upload; uploads auto-fix that now.
3. **Wire `fx.js` onto three.quarks** — `window.QUARKS` is bundled and unused (`grep -c QUARKS
   fx.js` → 0). Keep `fx.js`'s existing public API.
4. **Thread milling cycles 262–265, 267** — helix geometry already exists (`cycleBoreMill`).
5. **TNC 430 multi-axis** — large. Machine layout is answered (`CONTINUE.md`, 2026-09-27):
   X Y Z linear, A+B rotary swivel head, optional C rotary table (6 axes when present). Still to
   confirm before coding: pivot lengths/offsets, axis limits, which of A/B is primary. It's a
   kinematics `window.TNC_MACHINES['430']` config, never a UI fork.
6. Programming-station oracle, future-proofing — see TODO.md P10/P11; both need the user's input
   before starting.

## Build economics — where not to spend

The product is **one self-contained offline HTML file**. That constraint kills most tooling
before you evaluate it.

- **Keep `build.py`.** It's fully data-driven (`LIBS`/`MODULES`/`TEXTS`); a new module is one
  line. Don't reach for a bundler beyond what's already there (esbuild is only used for the
  three.js/three.quarks vendor bundle, via `vendor/three-entry.mjs`).
- **`.tools/node_modules` (three@0.186.1, three.quarks@0.17.1, esbuild@0.28.2, playwright-core)
  must exist for `python3 build.py` to run.** `build.py` prints the exact `npm i` command if it's
  missing — run that, don't reinvent it.
- **`ai.js` is plain `fetch`.** OpenRouter, BYOK, CORS `*`, `HTTP-Referer` + `X-Title` headers,
  key in `sessionStorage`/`localStorage` only, never a cookie. No SDK.
- **`LICENSE` still says three.js r128.** It's stale (the code is on r186 + three.quarks now).
  Fix it explicitly when you're touching build-related files, or ask first — it wasn't in scope
  for the 2026-09-27 docs-only pass that produced this file.
- **Playwright's Chromium is on disk** (`~/Library/Caches/ms-playwright`, ~1.1 GB) and is now in
  active use by `.tools/qa/qa.mjs` — that's the practical justification for keeping it, though
  the original install was never explicitly approved. **Install nothing new without asking.**

## Futureproofing — conventions to hold

- Every module: `var TNC_X = (function(){ ... })()` plus
  `if (typeof module !== 'undefined') module.exports = TNC_X;` — gives `node --check` and
  headless testing without a module system.
- Optional modules must degrade, never white-screen — guard every global (`if (window.TNC_FLOW)`).
- **The TNC 430 goes in as `window.TNC_MACHINES['430']`, a profile — never a fork of the UI.**
  If you find yourself copying `ui.js`, stop.
- Keep `TODO.md`, `devlog.txt` and `history.txt` in step with each push. Items leave `TODO.md`
  only when they ship, not when they're started. A DEV tab that lies is worse than no DEV tab.
- Authority for any Klartext behaviour question is `research/tnc426_430_280476_manual_en.txt`
  (the 426/430 manual, NC SW 280 476) — not the iTNC 530 programming station, which accepts a
  superset (e.g. `TCH PROBE 4xx`) that isn't valid 426/430 syntax.

## Rules

Authentic TNC behaviour over convenience. Keyboard-first. Plain HTML file, direct link —
never a claude.ai Artifact. If a tool is missing, name it and ask before installing.
AI = OpenRouter only, never Anthropic direct. Commits end with
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (check this session's own system
instructions for the current expected trailer before assuming this one still applies).

Two open decisions the user hasn't made: `tnc-sim`'s (BSL 1.1) licensing question now that it's
been studied as a reference, and whether/when to act on the future-proofing concept (backend +
Windows/Mac desktop) that's explicitly deferred.
