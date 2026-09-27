# Paste this into a new session

---

You're taking over a browser-based HEIDENHAIN CNC simulator. It's a gift from Daniel to his
father Nebojsa, a CNC engineer. Authentic TNC behaviour is the product.

**Repo:** `/Users/danieltrifunovic/Developer/sandbox/mac_tnc426-orbital` (git, remote `origin`)
**Live:** https://gigacook.github.io/tnc426-simulator/ — currently v0.4 (`d3aa945`)

Read in this order, then start: **`TODO.md`** (the task list, authoritative), `HANDOFF.md`
(cold-start detail), `devlog.txt`. Don't re-plan what's in them.

## The situation in one line

Six modules — `ui.new.js`, `lessons.js`, `fx.js`, `tools3d.js`, `callouts.js`, `flow.js`
(~220 KB) — are written, syntax-clean, **uncommitted and not in the build**. `build.py` still
bundles the old `ui.js`. The live site has seen none of it. **Wiring, not writing, is the
bottleneck.** They're staged; commit them before anything else.

## Do it in this order — cheapest lever first

1. **Commit the staged work.** Free, protects 220 KB that's been unversioned for days.
2. **Extend `build.py`, swap `ui.new.js` → `ui.js`, build, push.** One change ships six
   modules and fixes the scanline bleed in the user's screenshot (live `index.html:53`
   has `.crt:after{position:fixed}`; the rewritten shell already fixes it). Highest
   value/effort ratio in the project by a wide margin.
3. **Screenshot a real build.** No build has *ever* been opened in a browser.
4. `ai.js` — the only hard dependency `ui.new.js` has no fallback for.
5. P6 visuals, P8 live trace, P9 the 430.

## Build economics — where not to spend

The product is **one self-contained offline HTML file**. That constraint kills most tooling
before you evaluate it. Specifics, so you don't re-derive them:

- **Keep `build.py`.** String concatenation into one file *is* the correct build system here.
  No npm, no bundler, no framework, no ES modules — three.js r128's classic global build is
  inlined deliberately. Make the inline list data-driven so a new module is a one-line change.
- **Don't install anything for the visual work.** Everything needed ships in three r128's
  `examples/js/`, MIT, classic globals — inline them with the existing `lib()` helper exactly
  like `OrbitControls`. Cost: tens of KB, zero new dependencies.
- **P6: the brief is wrong about the cause, and the cheap fix is the real one.**
  `antialias:true` and `setPixelRatio` are already set (`ui.new.js:163`), and surfaces are
  already `MeshStandardMaterial` at `metalness:.9` (`ui.new.js:238`). A metal PBR material
  with **no environment map has nothing to reflect** — that is why it looks like plastic. So:
  - `PMREMGenerator` + `RoomEnvironment.js` → `scene.environment`. ~10 lines, procedural, no
    HDR or cubemap asset to embed. Do this first; it likely solves "shiny surface" outright.
  - Alloy/industry presets are **data, not code** — one object of
    `{color, metalness, roughness, chipColor}`. ~60 lines for aluminium, titanium, turbine,
    aerospace, ground, cast.
  - The staircase on diagonal walls is **geometry**, not edge aliasing — MSAA is already on,
    so an FXAA pass will barely move it. Try `computeVertexNormals()` and a finer grid
    (~10 lines) *before* reaching for `EffectComposer`, and before any re-meshing.
  - Add the FXAA composer (`EffectComposer` + `RenderPass` + `ShaderPass` + `CopyShader` +
    `FXAAShader`) only if steps above leave visible artefacts. Measure, then spend.
- **`ai.js` is plain `fetch`.** OpenRouter, BYOK, CORS `*`, `HTTP-Referer` + `X-Title` headers,
  key in `sessionStorage` only. ~150 lines. No SDK — an SDK buys nothing and can't be inlined.
- **Flowchart: keep the hand-rolled SVG in `flow.js`.** D2 and Graphviz were considered; both
  need a server or a ~2 MB WASM blob, which breaks the single-file offline product. Settled —
  don't reopen it.
- **JSZip** is already downloaded at `/private/tmp/claude-501/jszip.min.js`.
- **Playwright's Chromium is already on disk** (`~/Library/Caches/ms-playwright`, 1.1 GB,
  installed without permission — sunk cost, and the user hasn't decided its fate). Use it to
  screenshot the build. Chrome is not installed. **Install nothing new without asking.**

## Futureproofing — conventions to hold

- Every module: `var TNC_X = (function(){ ... })()` plus
  `if (typeof module !== 'undefined') module.exports = TNC_X;`. Gives `node --check` and
  headless testing without a module system.
- Optional modules must degrade, never white-screen — guard every global
  (`if (window.TNC_FLOW)`). `ui.new.js` already does this; keep it.
- **The TNC 430 goes in as `window.TNC_MACHINES['430']`, a profile — never a fork of the UI.**
  `ui.new.js:70` already merges it. If you find yourself copying `ui.js`, stop.
- Keep `TODO.md`, `devlog.txt` and `history.txt` in step with each push. Items leave `TODO.md`
  only when they ship, not when they're started. A DEV tab that lies is worse than no DEV tab.

## Rules

Authentic TNC behaviour over convenience. Keyboard-first. Plain HTML file, direct link —
never a claude.ai Artifact. If a tool is missing, name it and ask before installing.
Commits end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

Two open decisions the user hasn't made: whether to delete the 1.1 GB Playwright cache, and
whether `~/.claude/CLAUDE.md` (0 bytes since 2026-09-23, backup in `~/.Trash/`) gets restored.
