#!/usr/bin/env node
/* AI generation benchmark against a LIVE OpenRouter model. Opt-in, costs money, never part of CI.
 *
 *   OPENROUTER_API_KEY=… node tests/ai/bench.mjs [--model deepseek/deepseek-v4.1-flash] [--mode old|new|both]
 *                                               [--cases plate,letters,round,shoulder] [--rounds 3] [--tokens 32000] [--reasoning medium]
 *
 * Each case has a prompt and a REFERENCE part spec written by hand (what a machinist would expect from the prompt).
 * The final program is machined on the simulator's height field and scored against that reference with TNC_PART.compare:
 * "ref %" = removed-volume overlap with the reference. "own %" = against the model's own plan (new mode only).
 * old = sim/ai.js as committed before the plan/measure loop (git show <rev>:sim/ai.js), one repair round, 12k tokens, low reasoning.
 * new = the working-tree sim/ai.js: tool sheet, part spec, measured refinement.
 * Outputs (programs, specs, reports) go to local/ai-bench/ (gitignored).
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const T = require(join(ROOT, 'sim/core.js')), SIM = require(join(ROOT, 'sim/sim.js')), PART = require(join(ROOT, 'sim/part.js'));
const NEW = require(join(ROOT, 'sim/ai.js'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const KEY = process.env.OPENROUTER_API_KEY || process.env.API_KEY;
if (!KEY || !/^sk-or-/.test(KEY)) { console.error('needs OPENROUTER_API_KEY (an OpenRouter key). This benchmark calls the live API.'); process.exit(2); }
const MODEL = arg('model', 'deepseek/deepseek-v4.1-flash'), MODE = arg('mode', 'both'), ROUNDS = +arg('rounds', 3);
const TOKENS = +arg('tokens', 32000), REASONING = arg('reasoning', 'medium');
const OLD_REV = arg('old-rev', '5a1ed8a');

function oldAI() {
  const src = execSync(`git show ${OLD_REV}:sim/ai.js`, { cwd: ROOT }).toString();
  const m = { exports: {} }; new Function('module', 'require', src)(m, require); return m.exports;
}
const tools = T.TOOLS;
function verify(src) {
  let r, ex, ev = [];
  try { r = T.run(src, { tools }); ex = SIM.expand(r); ev = SIM.analyse(r, ex, SIM.grid(r.stock, ex.segs)) || []; }
  catch (e) { return { ok: false, text: 'INTERNAL ERROR: ' + e.message, errs: [e.message], crashes: [], warns: [] }; }
  const nb = (i) => (r.blocks[i] && r.blocks[i].n != null ? r.blocks[i].n : '?');
  const errs = r.errors.map((e) => `BLOCK ${nb(e.block)}: ${e.msg}`);
  const crashes = ev.filter((e) => e.sev === 'crash').map((e) => `BLOCK ${nb(e.block)}: ${e.msg}`);
  const warns = ev.filter((e) => e.sev === 'warn').map((e) => `BLOCK ${nb(e.block)}: ${e.msg}`);
  if (!r.moves.length) errs.push('THE PROGRAM MAKES NO MOVES');
  return { ok: !errs.length && !crashes.length, errs, crashes, warns, moves: r.moves.length, text: [...errs, ...crashes, ...warns].join('\n') };
}
function measure(spec, src) { const r = T.run(src, { tools }); if (r.errors.length) return null; return PART.compare(spec, r, SIM.expand(r)); }

const CASES = {
  plate: { prompt: 'Aluminium plate 120 x 80 x 15 (BLK FORM X0..120 Y0..80 Z-15..0). Face the top down to Z-0.5. A rectangular pocket in the middle, 60 x 30 (X30..90, Y25..55), corner radius 6, floor at Z-6. Four 8.5 mm holes through the plate, centres 10 mm in from each corner.',
    ref: { blank: { x: [0, 120], y: [0, 80], z: [-15, 0] }, features: [{ id: 'F', type: 'face', z: -0.5 }, { id: 'P', type: 'pocket', shape: 'rect', x: [30, 90], y: [25, 55], r: 6, z: -6 },
      ...[[10, 10], [110, 10], [10, 70], [110, 70]].map(([x, y], i) => ({ id: 'H' + i, type: 'hole', x, y, d: 8.5, z: -15 }))] } },
  letters: { prompt: 'Aluminium name plate 200 x 60 x 10 (X0..200 Y0..60 Z-10..0). Engrave the word WORKSHOP in capital letters, 25 mm high, centred on the plate (baseline at Y17.5), 1 mm deep, with the 3 mm end mill.',
    ref: { blank: { x: [0, 200], y: [0, 60], z: [-10, 0] }, features: [{ id: 'T', type: 'text', text: 'WORKSHOP', x: 100, y: 17.5, h: 25, w: 3, z: -1, align: 'center' }] } },
  round: { prompt: 'Block 100 x 100 x 20 (X0..100 Y0..100 Z-20..0). A circular pocket of diameter 50 centred at X50 Y50, floor Z-8. A straight slot 10 mm wide from X10 Y12 to X90 Y12, floor Z-4.',
    ref: { blank: { x: [0, 100], y: [0, 100], z: [-20, 0] }, features: [{ id: 'C', type: 'pocket', shape: 'circle', x: 50, y: 50, d: 50, z: -8 }, { id: 'S', type: 'slot', from: [10, 12], to: [90, 12], w: 10, z: -4 }] } },
  shoulder: { prompt: 'Blank 100 x 60 x 12 (X0..100 Y0..60 Z-12..0). Mill a 3 mm deep shoulder all around: the top 3 mm becomes a 90 x 50 rectangle with corner radius 5, centred on the blank (X5..95, Y5..55); everything outside it is cut down to Z-3.',
    ref: { blank: { x: [0, 100], y: [0, 60], z: [-12, 0] }, features: [{ id: 'O', type: 'profile', points: rr(5, 95, 5, 55, 5), z: -3 }] } },
};
function rr(x0, x1, y0, y1, r) { const P = []; const c = [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]];
  c.forEach(([cx, cy, a0]) => { for (let k = 0; k <= 6; k++) { const a = (a0 + 15 * k) * Math.PI / 180; P.push([+(cx + r * Math.cos(a)).toFixed(3), +(cy + r * Math.sin(a)).toFixed(3)]); } }); return P; }

const out = join(ROOT, 'local', 'ai-bench', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(out, { recursive: true });
const rows = [];
async function one(name, mode) {
  const c = CASES[name], AI = mode === 'old' ? oldAI() : NEW, t0 = Date.now(), log = [];
  const o = mode === 'old'
    ? { key: KEY, model: MODEL, prompt: c.prompt, system: AI.system(tools), verify, maxRepairs: 1, reasoning: 'low', maxTokens: 12000 }
    : { key: KEY, model: MODEL, prompt: c.prompt, system: AI.system(tools, { plan: true, sMax: 6000 }), tools, verify, measure, plan: true, rounds: ROUNDS, reasoning: REASONING, maxTokens: TOKENS };
  o.onStep = (s) => {
    if (s.phase === 'request') log.push(`request ${s.attempt}${s.stage ? ' ' + s.stage : ''}`);
    if (s.phase === 'continued') log.push(`continued ${s.n}${s.retry ? ' retry ' + s.maxTokens : ''}`);
    if (s.phase === 'checked') log.push(`checked ${s.attempt}: ${s.report.ok ? 'ok' : s.report.errs.length + ' err ' + s.report.crashes.length + ' crash'}`);
    if (s.phase === 'measured') log.push(`measured ${s.attempt}: ${s.measure.score && s.measure.score.toFixed(1)} %`);
    if (s.phase === 'planned') log.push(`planned${s.revised ? ' (revised)' : ''}: ${s.error || (s.spec.features.length + ' features' + (s.notes.length ? ', notes: ' + s.notes.join(' | ') : ''))}`);
  };
  let res = null, err = null;
  try { res = await AI.generate(o); } catch (e) { err = e.message; }
  const secs = (Date.now() - t0) / 1000;
  let ref = null, own = null;
  if (res) { const m = measure(c.ref, res.src); ref = m && m.score; own = res.measure && res.measure.score;
    writeFileSync(join(out, `${name}-${mode}.H`), res.src); writeFileSync(join(out, `${name}-${mode}.ref.txt`), m ? m.text : 'did not compile');
    if (res.spec) writeFileSync(join(out, `${name}-${mode}.spec.json`), JSON.stringify(res.spec, null, 1)); }
  writeFileSync(join(out, `${name}-${mode}.log.txt`), log.join('\n') + (err ? '\nERROR ' + err : ''));
  const row = { case: name, mode, ok: res ? res.report.ok : false, ref: ref == null ? '—' : ref.toFixed(1), own: own == null ? '—' : own.toFixed(1),
    rounds: res ? res.attempts : '—', cost: res ? '$' + res.cost.toFixed(4) : '—', secs: secs.toFixed(0), err: err || '' };
  rows.push(row); console.log(JSON.stringify(row)); console.log('   ' + log.join('\n   '));
}
const names = arg('cases', Object.keys(CASES).join(',')).split(',');
for (const n of names) for (const m of MODE === 'both' ? ['old', 'new'] : [MODE]) await one(n, m);
console.log(`\nmodel ${MODEL} · rounds ${ROUNDS} · tokens ${TOKENS} · reasoning ${REASONING}   (outputs: ${out})`);
console.table(rows);
