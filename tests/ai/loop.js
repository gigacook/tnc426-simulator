/* The AI loop against a MOCKED OpenRouter (no network, no key): a cut-off answer is continued, the part spec is
   planned and expanded, the first program is measured short, the measurement goes back, the refined program wins.
   node tests/ai/loop.js */
const T = require('../../sim/core.js'), SIM = require('../../sim/sim.js'), PART = require('../../sim/part.js'), AI = require('../../sim/ai.js');
let fails = 0;
const ok = (c, m, d) => { console.log((c ? '  ok    ' : '  FAIL  ') + m + (c ? '' : '  (' + d + ')')); if (!c) fails++; };

const SPEC = { blank: { x: [0, 100], y: [0, 60], z: [-10, 0] }, features: [{ id: 'S1', type: 'slot', from: [20, 30], to: [80, 30], w: 6, z: -2 }] };
const prog = (x1) => ['BEGIN PGM SLOT MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-10', 'BLK FORM 0.2 X+100 Y+60 Z+0', 'TOOL CALL 4 Z S3000', 'L Z+50 R0 FMAX M3',
  'L X+20 Y+30 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z-1 R0 F150', `L X+${x1} R0 F500`, 'L Z-2 R0 F150', 'L X+20 R0 F500', 'L Z+50 R0 FMAX M5', 'M30', 'END PGM SLOT MM'].join('\n');
const answers = [
  { text: '```partspec\n' + JSON.stringify(SPEC) + '\n```' },                       // plan
  { text: '```klartext\n' + prog(50).slice(0, 120), finish: 'length' },                // write, cut off at max_tokens …
  { text: prog(50).slice(120) + '\n```' },                                           // … continued
  { text: '```klartext\n' + prog(80) + '\n```' },                                    // refine after the measurement
];
const sent = [];
global.fetch = async (url, init) => {
  const body = JSON.parse(init.body); sent.push(body);
  const a = answers.shift();
  const chunks = ['data: ' + JSON.stringify({ choices: [{ delta: { content: a.text }, finish_reason: a.finish || 'stop' }] }), 'data: ' + JSON.stringify({ choices: [], usage: { cost: 0.001 } }), 'data: [DONE]', ''];
  const enc = new TextEncoder().encode(chunks.join('\n\n'));
  let done = false;
  return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (done ? { done: true } : (done = true, { done: false, value: enc })) }) } };
};
const tools = T.TOOLS;
const verify = (src) => { const r = T.run(src, { tools }); const ex = SIM.expand(r); const ev = SIM.analyse(r, ex, SIM.grid(r.stock, ex.segs));
  const errs = r.errors.map((e) => e.msg), crashes = ev.filter((e) => e.sev === 'crash').map((e) => e.msg);
  return { ok: !errs.length && !crashes.length, errs, crashes, warns: [], text: errs.concat(crashes).join('\n') }; };
const measure = (spec, src) => { const r = T.run(src, { tools }); return r.errors.length ? null : PART.compare(spec, r, SIM.expand(r)); };
const steps = [];
(async () => {
  const res = await AI.generate({ key: 'k', model: 'm', prompt: 'a slot', tools, verify, measure, plan: true, rounds: 2, maxTokens: 32000, onStep: (s) => steps.push(s) });
  ok(sent.length === 4, 'plan + write + continuation + refine = 4 requests', sent.length);
  ok(sent[0].max_tokens === 32000, 'the requested token budget is sent', sent[0].max_tokens);
  ok(/STEP 1 of 2/.test(sent[0].messages[1].content), 'the first request asks for the part spec');
  ok(/S1 SLOT/.test(sent[1].messages[3].content), 'the write request carries the expanded spec sheet');
  ok(/cut off by the length limit/.test(sent[2].messages[sent[2].messages.length - 1].content), 'a cut-off answer is continued');
  ok(steps.some((s) => s.phase === 'continued'), 'the UI hears about the continuation');
  const m1 = steps.filter((s) => s.phase === 'measured');
  ok(m1.length === 2 && m1[0].measure.score < 70, 'the half-length slot is measured short', m1[0] && m1[0].measure.score);
  ok(/NOT CUT/.test(sent[3].messages[sent[3].messages.length - 1].content), 'the measurement goes back to the model');
  ok(res.measure.score > 95 && /X\+80/.test(res.src), 'the refined, full-length slot is the result', res.measure.score);
  ok(Math.abs(res.cost - 0.004) < 1e-9, 'cost adds up over all requests', res.cost);
  // a refinement round that fails keeps the best program so far
  answers.push({ text: '```partspec\n' + JSON.stringify(SPEC) + '\n```' }, { text: '```klartext\n' + prog(50) + '\n```' });
  const realFetch = global.fetch; let n = 0;
  global.fetch = async (u, i) => { if (++n === 3) throw new Error('TIMED OUT'); return realFetch(u, i); };
  const steps2 = [];
  const res2 = await AI.generate({ key: 'k', model: 'm', prompt: 'a slot', tools, verify, measure, plan: true, rounds: 2, onStep: (s) => steps2.push(s) });
  ok(res2 && /X\+50/.test(res2.src) && steps2.some((s) => s.phase === 'failed'), 'a failed refinement returns the best program so far');
  console.log(fails ? `\n${fails} FAILED` : '\nALL AI LOOP CHECKS PASS (mocked, no network)');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
