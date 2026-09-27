/* Worked examples from the HEIDENHAIN TNC 426/430 user's manual (NC software 280 476),
   chapter 6 "Programming contours". Expected tool-centre geometry is derived from the
   manual's rules: RL/RR offset by R, transitional arcs at outside corners, APPR/DEP on
   the tool-centre path.   Run:  node tests/manual.js                                  */
const TNC = require('../core.js');
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('  FAIL ' + msg); } };
const near = (a, b, e = 1e-3) => Math.abs(a - b) <= e;
const P = { LINEAR: `BEGIN PGM LINEAR MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+10
TOOL CALL 1 Z S4000
L Z+250 R0 F MAX
L X-10 Y-10 R0 F MAX
L Z-5 R0 F1000 M3
APPR LT X+5 Y+5 LEN10 RL F300
L Y+95
L X+95
CHF 10
L Y+5
CHF 20
L X+5
DEP LT LEN10 F1000
L Z+250 R0 F MAX M2
END PGM LINEAR MM`,
CIRCULAR: `BEGIN PGM CIRCULAR MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+10
TOOL CALL 1 Z S4000
L Z+250 R0 F MAX
L X-10 Y-10 R0 F MAX
L Z-5 R0 F1000 M3
APPR LCT X+5 Y+5 R5 RL F300
L X+5 Y+85
RND R10 F150
L X+30 Y+85
CR X+70 Y+95 R+30 DR-
L X+95
L X+95 Y+40
CT X+40 Y+5
L X+5
DEP LCT X-20 Y-20 R5 F1000
L Z+250 R0 F MAX M2
END PGM CIRCULAR MM`,
CCC: `BEGIN PGM C-CC MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+12.5
TOOL CALL 1 Z S3150
CC X+50 Y+50
L Z+250 R0 F MAX
L X-40 Y+50 R0 F MAX
L Z-5 R0 F1000 M3
APPR LCT X+0 Y+50 R5 RL F300
C X+0 DR-
DEP LCT X-40 Y+50 R5 F1000
L Z+250 R0 F MAX M2
END PGM C-CC MM`,
LINEARPO: `BEGIN PGM LINEARPO MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+7.5
TOOL CALL 1 Z S4000
CC X+50 Y+50
L Z+250 R0 F MAX
LP PR+60 PA+180 R0 F MAX
L Z-5 R0 F1000 M3
APPR PLCT PR+45 PA+180 R5 RL F250
LP PA+120
LP PA+60
LP PA+0
LP PA-60
LP PA-120
LP PA+180
DEP PLCT PR+60 PA+180 R5 F1000
L Z+250 R0 F MAX M2
END PGM LINEARPO MM`,
HELIX: `BEGIN PGM HELIX MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+5
TOOL CALL 1 Z S1400
L Z+250 R0 F MAX
L X+50 Y+50 R0 F MAX
CC
L Z-12.75 R0 F1000 M3
APPR PCT PR+32 PA-180 CCA180 R+2 RL F100
CP IPA+3240 IZ+13.5 DR+ F200
DEP CT CCA180 R+2
L Z+250 R0 F MAX M2
END PGM HELIX MM`,
HELIXREP: `BEGIN PGM HELIX MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+5
TOOL CALL 1 Z S1400
L Z+250 R0 F MAX
L X+50 Y+50 R0 F MAX
CC
L Z-12.75 R0 F1000 M3
APPR PCT PR+32 PA-180 CCA180 R+2 RL F100
LBL 1
CP IPA+360 IZ+1.5 DR+ F200
CALL LBL 1 REP 8
DEP CT CCA180 R+2
L Z+250 R0 F MAX M2
END PGM HELIX MM` };

function run(name) {
  const r = TNC.run(P[name]);
  const errs = r.errors.map(e => `block ${e.block}: ${e.msg}`);
  ok(!errs.length, name + ' errors: ' + errs.join('; '));
  for (let i = 1; i < r.moves.length; i++) {                 // the tool path must be continuous
    const a = r.moves[i - 1].to, b = r.moves[i].from;
    if (Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) > 1e-6) { ok(false, `${name} gap before move ${i} (block ${r.moves[i].block}) ${JSON.stringify(a)} -> ${JSON.stringify(b)}`); break; }
  }
  return r;
}
const pts = r => { const out = []; r.moves.forEach(m => { if (m.kind === 'arc') { const n = Math.ceil(Math.abs(m.sweep) / 0.05) + 1, R = Math.hypot(m.from.x - m.cx, m.from.y - m.cy), a0 = Math.atan2(m.from.y - m.cy, m.from.x - m.cx);
  for (let i = 0; i <= n; i++) out.push({ x: m.cx + R * Math.cos(a0 + m.sweep * i / n), y: m.cy + R * Math.sin(a0 + m.sweep * i / n), z: m.from.z + (m.to.z - m.from.z) * i / n, m }); }
  else for (let i = 0; i <= 20; i++) out.push({ x: m.from.x + (m.to.x - m.from.x) * i / 20, y: m.from.y + (m.to.y - m.from.y) * i / 20, z: m.from.z + (m.to.z - m.from.z) * i / 20, m }); }); return out; };
const atDepth = (r, z) => pts(r).filter(p => near(p.z, z) && p.m.kind !== 'rapid');

console.log('LINEAR — APPR LT, CHF, DEP LT, RL outside a square, R10');
{ const r = run('LINEAR'), c = atDepth(r, -5).filter(p => p.m.block >= 9 && p.m.block <= 14);
  const xs = c.map(p => p.x), ys = c.map(p => p.y);
  ok(near(Math.min(...xs), -5) && near(Math.max(...xs), 105) && near(Math.min(...ys), -5) && near(Math.max(...ys), 105), 'offset square spans -5..105, got ' + [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(v => v.toFixed(3)));
  const appr = r.moves.filter(m => m.block === 8);
  ok(appr.length >= 2 && near(appr[0].to.x, -5) && near(appr[0].to.y, -5), 'APPR LT: PH at (-5,-5) = offset start minus LEN along the tangent, got ' + (appr[0] && JSON.stringify(appr[0].to)));
  ok(appr[0] && appr[0].feed === 1000, 'PS->PH runs at the last programmed feed F1000, got ' + (appr[0] && appr[0].feed));
  ok(appr[1] && appr[1].feed === 300 && near(appr[1].to.x, -5) && near(appr[1].to.y, 5), 'PH->PA at F300 ends at (-5,5)');
  const tr = r.moves.find(m => m.kind === 'arc' && near(m.cx, 5) && near(m.cy, 95));
  ok(tr && near(Math.hypot(tr.from.x - 5, tr.from.y - 95), 10) && tr.sweep < 0, 'outside corner (5,95): transitional arc R10 clockwise');
  const chf = r.moves.find(m => m.block === 11 && m.kind !== 'arc');
  ok(chf && near(Math.abs(chf.to.x - chf.from.x), 10) && near(Math.abs(chf.to.y - chf.from.y), 10), 'CHF 10: chamfer leg 10 x 10 (offset parallel), got ' + (chf && JSON.stringify([chf.from, chf.to])));
  const dep = r.moves.filter(m => m.block === 15);
  ok(dep.length === 1 && near(dep[0].from.x, 5) && near(dep[0].from.y, -5) && near(dep[0].to.x, -5) && near(dep[0].to.y, -5), 'DEP LT LEN10: (5,-5) -> (-5,-5), got ' + (dep[0] && JSON.stringify([dep[0].from, dep[0].to])));
  const last = r.moves[r.moves.length - 1];
  ok(near(last.to.x, -5) && near(last.to.y, -5) && near(last.to.z, 250), 'retract Z+250 stays at the DEP end XY');
}
console.log('CIRCULAR — APPR LCT, RND, CR, CT, DEP LCT, R10');
{ const r = run('CIRCULAR');
  const rnd = r.moves.filter(m => m.block === 10);
  ok(rnd.length >= 1 && rnd.some(m => m.kind === 'arc'), 'RND produced an arc');
  const cr = r.moves.find(m => m.block === 12 && m.kind === 'arc');
  ok(cr && near(Math.hypot(cr.from.x - cr.cx, cr.from.y - cr.cy), 40), 'CR R30 DR- with RL is convex (manual) -> tool outside, radius 30+10 = 40, got ' + (cr && Math.hypot(cr.from.x - cr.cx, cr.from.y - cr.cy)));
  const ct = r.moves.find(m => m.block === 15 && m.kind === 'arc');
  ok(!!ct, 'CT produced an arc');
  const d = r.moves.filter(m => m.block === 17);
  ok(d.length >= 2 && d[0].kind === 'arc' && near(d[d.length - 1].to.x, -20) && near(d[d.length - 1].to.y, -20), 'DEP LCT: arc then line to PN (-20,-20)');
}
console.log('C-CC — full circle C DR-, RL, R12.5');
{ const r = run('CCC');
  const c = r.moves.find(m => m.block === 10 && m.kind === 'arc');
  ok(c && near(c.cx, 50) && near(c.cy, 50) && near(Math.hypot(c.from.x - 50, c.from.y - 50), 62.5) && near(Math.abs(c.sweep), 2 * Math.PI, 1e-6) && c.sweep < 0,
     'full circle: centre (50,50), tool radius 50+12.5, sweep -360deg; got ' + (c && [c.cx, c.cy, Math.hypot(c.from.x - 50, c.from.y - 50), c.sweep].map(v => (+v).toFixed(4))));
}
console.log('LINEARPO — polar LP hexagon, APPR/DEP PLCT, R7.5');
{ const r = run('LINEARPO'), c = atDepth(r, -5).filter(p => p.m.block >= 10 && p.m.block <= 15);
  const minR = Math.min(...c.map(p => Math.hypot(p.x - 50, p.y - 50)));
  ok(near(minR, 45 * Math.cos(Math.PI / 6) + 7.5, 1e-3), 'tool stays 7.5 outside the hexagon flats (min radius ' + minR.toFixed(4) + ')');
  ok(r.moves.some(m => m.block === 9 && m.kind === 'arc'), 'APPR PLCT arc');
}
for (const H of ['HELIX', 'HELIXREP']) {
  console.log(H + ' — CP IPA helix with RL inside, APPR PCT / DEP CT, R5');
  const r = run(H), h = r.moves.filter(m => m.kind === 'arc' && near(m.cx, 50) && near(m.cy, 50) && (H === 'HELIX' ? m.block === 10 : m.block === 11));
  const turns = h.reduce((s, m) => s + m.sweep, 0) / (2 * Math.PI);
  ok(h.length && h.every(m => near(Math.hypot(m.from.x - 50, m.from.y - 50), 27)), 'helix tool radius 32-5 = 27 (RL inside a CCW circle)');
  ok(near(turns, 9, 1e-6), '9 turns (IPA+3240), got ' + turns.toFixed(4));
  const hz = h[h.length - 1]; ok(hz && near(hz.to.z, 0.75), 'helix ends at Z-12.75+13.5 = +0.75');
}

console.log('INSIDE — RL inside a CCW pocket contour: corners are intersections, no arcs');
{ const r = TNC.run(`BEGIN PGM IN MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+5
TOOL CALL 1 Z S3000
L X+50 Y+50 R0 FMAX
L Z-5 F500 M3
L X+10 Y+10 RL F300
L X+90
L Y+90
L X+10
L Y+10
L X+50 Y+50 R0
END PGM IN MM`);
  ok(!r.errors.length, 'no errors ' + JSON.stringify(r.errors));
  const c = r.moves.filter(m => m.block >= 8 && m.block <= 11);
  ok(c.every(m => m.kind !== 'arc'), 'no transitional arcs on inside corners');
  const corners = c.map(m => m.to);
  ok(near(corners[0].x, 85) && near(corners[0].y, 15) && near(corners[1].x, 85) && near(corners[1].y, 85) && near(corners[2].x, 15) && near(corners[2].y, 85),
     'offset corners at 15/85, got ' + JSON.stringify(corners.map(p => [+p.x.toFixed(3), +p.y.toFixed(3)])));
  const act = r.moves.find(m => m.block === 7);
  ok(act && near(act.to.x, 10) && near(act.to.y, 15), 'activation ends perpendicular to the first element: (10,15), got ' + (act && JSON.stringify(act.to)));
}
console.log('ERRORS — radius too large, RL straight to RR');
{ const r = TNC.run(`BEGIN PGM E MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+8
TOOL CALL 1 Z S3000
L X+50 Y+45 R0 FMAX
L Z-5 F500 M3
CC X+50 Y+50
L X+50 Y+45 RL F300
C X+50 Y+45 DR+
L X+50 Y+50 R0
END PGM E MM`);
  ok(r.errors.some(e => /TOOL RADIUS TOO LARGE/.test(e.msg)), 'R8 inside an R5 circle -> TOOL RADIUS TOO LARGE, got ' + JSON.stringify(r.errors));
  const r2 = TNC.run('BEGIN PGM E MM\nTOOL CALL 4 Z S1000\nL X+0 Y+0 RL F100\nL X+10 RR\nEND PGM E MM');
  ok(r2.errors.some(e => /RADIUS COMP/.test(e.msg)), 'RL -> RR without R0 is refused');
}
console.log('CYCLE 203 — Q208=0 retracts at the plunging feed Q206');
{ const r = TNC.run(`BEGIN PGM D MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL CALL 2 Z S2000
L X+50 Y+50 Z+10 R0 FMAX M3
CYCL DEF 203 UNIVERSAL DRILLING
  Q200=2 ;SET-UP CLEARANCE
  Q201=-10 ;DEPTH
  Q206=150 ;FEED RATE FOR PLUNGING
  Q202=10 ;PLUNGING DEPTH
  Q210=0 ;DWELL TIME AT TOP
  Q203=+0 ;SURFACE COORDINATE
  Q204=20 ;2ND SET-UP CLEARANCE
  Q212=0 ;DECREMENT
  Q213=0 ;BREAKS
  Q205=0 ;MIN. PLUNGING DEPTH
  Q211=0 ;DWELL TIME AT DEPTH
  Q208=0 ;RETRACTION FEED RATE
CYCL CALL
END PGM D MM`);
  const up = r.moves.find(m => m.cycle && m.to.z > m.from.z && m.kind === 'feed');
  ok(up && up.feed === 150, 'retract feed = Q206 150, got ' + (up && up.feed));
}
console.log(fails ? `\n${fails} FAILED` : '\nALL MANUAL EXAMPLES PASS');
process.exit(fails ? 1 : 0);
