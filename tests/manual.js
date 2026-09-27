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

const ELLIPSE = rot => `BEGIN PGM ELLIPSE MM
FN 0: Q1 = +50
FN 0: Q2 = +50
FN 0: Q3 = +50
FN 0: Q4 = +30
FN 0: Q5 = +0
FN 0: Q6 = +360
FN 0: Q7 = +40
FN 0: Q8 = ${rot}
FN 0: Q9 = +5
FN 0: Q10 = +100
FN 0: Q11 = +350
FN 0: Q12 = +2
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL DEF 1 L+0 R+2.5
TOOL CALL 1 Z S4000
L Z+250 R0 F MAX
CALL LBL 10
L Z+100 R0 F MAX M2
LBL 10
CYCL DEF 7.0 DATUM SHIFT
CYCL DEF 7.1 X+Q1
CYCL DEF 7.2 Y+Q2
CYCL DEF 10.0 DREHUNG
CYCL DEF 10.1 ROT+Q8
Q35 = (Q6 - Q5) / Q7
Q36 = Q5
Q37 = 0
Q21 = Q3 * COS Q36
Q22 = Q4 * SIN Q36
L X+Q21 Y+Q22 R0 F MAX M3
L Z+Q12 R0 F MAX
L Z-Q9 R0 FQ10
LBL 1
Q36 = Q36 + Q35
Q37 = Q37 + 1
Q21 = Q3 * COS Q36
Q22 = Q4 * SIN Q36
L X+Q21 Y+Q22 R0 FQ11
FN 12: IF +Q37 LT +Q7 GOTO LBL 1
CYCL DEF 10.0 DREHUNG
CYCL DEF 10.1 ROT+0
CYCL DEF 7.0 DATUM SHIFT
CYCL DEF 7.1 X+0
CYCL DEF 7.2 Y+0
L Z+Q12 R0 F MAX
LBL 0
END PGM ELLIPSE MM`;
for (const rot of [0, 30]) {
  console.log(`ELLIPSE (manual 10.11) — Q formulas, FN 12 loop, cycle 7 shift, cycle 10 ROT+${rot}`);
  const r = TNC.run(ELLIPSE(rot));
  ok(!r.errors.length, 'no errors ' + JSON.stringify(r.errors.slice(0, 3)));
  const cut = r.moves.filter(m => m.feed === 350);
  ok(cut.length === 40, '40 segments (Q7), got ' + cut.length);
  const c = Math.cos(-rot * Math.PI / 180), s = Math.sin(-rot * Math.PI / 180);
  const onE = p => { const x = p.x - 50, y = p.y - 50, u = x * c - y * s, v = x * s + y * c; return Math.abs((u / 50) ** 2 + (v / 30) ** 2 - 1) < 1e-6; };
  ok(cut.every(m => onE(m.to) && near(m.to.z, -5)), 'every point on the ellipse a=50 b=30 about (50,50), rotated ' + rot + ' deg, at Z-5');
  const last = r.moves[r.moves.length - 1];
  ok(near(last.to.z, 100), 'ends at Z+100 after the datum reset');
}
console.log('FORMULAS — precedence, functions, FN 4 DIV, FN 8 LEN, FN 13 ANG, REP Q');
{ const r = TNC.run(`BEGIN PGM F MM
Q1 = 5 * 3 + 2 * 10
Q2 = SQ 10 - 3^3
Q3 = SQRT 25 + ABS -2
FN 4: Q4 = +8 DIV +2
FN 8: Q5 = +5 LEN +4
FN 13: Q6 = +25 ANG +25
Q7 = 2
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+100 Z+0
TOOL CALL 4 Z S3000
L X+Q1 Y+Q2 Z+10 R0 FMAX
LBL 1
L IX+1 R0 F100
CALL LBL 1 REP Q7
END PGM F MM`);
  ok(!r.errors.length, 'no errors ' + JSON.stringify(r.errors));
  const p = r.moves[0].to; ok(near(p.x, 35) && near(p.y, 73), 'Q1 = 35 and Q2 = 73 (manual 10.9), got ' + p.x + ',' + p.y);
  ok(near(r.moves[r.moves.length - 1].to.x, 38), 'REP Q7 (=2): section runs 3 times, X 35 -> 38');
}
console.log('MIRROR — cycle 8 X mirrors the part and swaps RL to RR, arcs change direction');
{ const base = `TOOL DEF 1 L+0 R+5
TOOL CALL 1 Z S3000
L X+10 Y-10 Z-5 R0 FMAX M3
L X+10 Y+10 RL F300
L X+40
CC X+40 Y+30
C X+40 Y+50 DR+
L X+10
L X+10 Y+10
L X+0 Y+0 R0`;
  const a = TNC.run('BEGIN PGM A MM\n' + base + '\nEND PGM A MM'), b = TNC.run('BEGIN PGM B MM\nCYCL DEF 8.0 MIRROR IMAGE\nCYCL DEF 8.1 X\n' + base + '\nEND PGM B MM');
  ok(!a.errors.length && !b.errors.length, 'no errors ' + JSON.stringify(b.errors));
  const A = pts(a).filter(q => q.m.rc), B = pts(b).filter(q => q.m.rc);
  const key = q => Math.round(q.x * 1000) / 1000 + ',' + Math.round(q.y * 1000) / 1000;
  const setA = new Set(A.map(q => key({ x: -q.x, y: q.y })));
  ok(B.length > 10 && B.every(q => setA.has(key(q)) || A.some(z => Math.hypot(-z.x - q.x, z.y - q.y) < 0.05)), 'mirrored tool path is the exact mirror of the original');
}

console.log('CYCLES — 202 205 206 207 208 209 and old 1 / 2 / 17 against the manual\'s parameter rules');
{ const hdr = 'BEGIN PGM C MM\nBLK FORM 0.1 Z X+0 Y+0 Z-40\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+3\nTOOL CALL 1 Z S500\nL Z+50 R0 FMAX M3\n';
  const cyc = (def, call = 'L X+50 Y+50 R0 FMAX M99') => TNC.run(hdr + def + '\n' + call + '\nEND PGM C MM');
  const zmin = r => Math.min(...r.moves.map(m => m.to.z));
  let r = cyc('CYCL DEF 207 RIGID TAPPING NEW\n Q200=2\n Q201=-20\n Q239=+1.5\n Q203=+0\n Q204=50');
  ok(!r.errors.length, '207 no errors ' + JSON.stringify(r.errors));
  const tap = r.moves.filter(m => m.cycle && m.kind === 'feed');
  ok(tap.length === 2 && tap.every(m => m.feed === 750), '207: in and out at F = S x pitch = 500 x 1.5 = 750, got ' + tap.map(m => m.feed));
  ok(tap[1] && tap[1].spindle < 0, '207: spindle reversed for the way out');
  ok(near(zmin(r), -20), '207: thread depth Z-20');
  ok(r.moves[r.moves.length - 1].spindle === 0, '207: spindle stopped at the end (manual)');
  r = cyc('CYCL DEF 209 TAPPING W/ CHIP BRKG\n Q200=2\n Q201=-20\n Q239=+1\n Q203=+0\n Q204=50\n Q257=5\n Q256=0.5\n Q336=0');
  ok(!r.errors.length && near(zmin(r), -20), '209 reaches Z-20');
  ok(r.moves.filter(m => m.cycle && m.spindle < 0).length >= 4, '209: reverses at every Q257 infeed (4 infeeds of 5)');
  r = cyc('CYCL DEF 208 BORE MILLING\n Q200=2\n Q201=-10\n Q206=150\n Q334=2\n Q203=+0\n Q204=50\n Q335=20\n Q342=0');
  const h = r.moves.find(m => m.kind === 'arc');
  ok(!r.errors.length && h && near(Math.hypot(h.from.x - 50, h.from.y - 50), 7), '208: helix radius = D/2 - R = 10 - 3 = 7');
  ok(h && near(Math.abs(h.sweep) / (2 * Math.PI), 6), '208: (10 depth + 2 clearance) / 2 per turn = 6 turns, got ' + (h && (Math.abs(h.sweep) / (2 * Math.PI)).toFixed(3)));
  r = cyc('CYCL DEF 205 UNIVERSAL PECKING\n Q200=2\n Q201=-30\n Q206=150\n Q202=10\n Q203=+0\n Q204=50\n Q212=2\n Q205=4\n Q258=0.5\n Q259=1\n Q257=0\n Q256=0.2\n Q211=0');
  ok(!r.errors.length && near(zmin(r), -30), '205 reaches Z-30');
  const pecks = r.moves.filter(m => m.cycle && m.kind === 'feed' && m.to.z < m.from.z).map(m => +(-m.to.z).toFixed(3));
  ok(pecks.includes(10) && pecks.includes(18) && pecks.includes(24), '205: pecks 10, 8, 6 ... (Q212 decrement), depths ' + pecks.join(','));
  r = cyc('CYCL DEF 202 BORING\n Q200=2\n Q201=-15\n Q206=100\n Q211=0.5\n Q208=250\n Q203=+0\n Q204=100\n Q214=1\n Q336=0');
  const out = r.moves.find(m => m.cycle && m.kind === 'feed' && m.to.z > m.from.z);
  ok(!r.errors.length && out && out.feed === 250 && near(out.from.x, 49.8), '202: disengage 0.2 in -X (Q214=1), retract at Q208 250');
  r = TNC.run(hdr + 'L X+50 Y+50 R0 FMAX\nL Z+2 R0 FMAX\nCYCL DEF 1.0 PECKING\nCYCL DEF 1.1 SET UP 2\nCYCL DEF 1.2 DEPTH -15\nCYCL DEF 1.3 PECKG 5\nCYCL DEF 1.4 DWELL 0\nCYCL DEF 1.5 F80\nCYCL CALL\nEND PGM C MM');
  ok(!r.errors.length && near(zmin(r), -15) && r.moves.filter(m => m.cycle && m.feed === 80).length === 3, 'cycle 1: 3 pecks of 5 to Z-15 at F80');
  r = TNC.run(hdr + 'L X+50 Y+50 R0 FMAX\nL Z+2 R0 FMAX\nCYCL DEF 17.0 RIGID TAPPING\nCYCL DEF 17.1 SET UP 2\nCYCL DEF 17.2 DEPTH -12\nCYCL DEF 17.3 PITCH +1\nCYCL CALL\nEND PGM C MM');
  ok(!r.errors.length && near(zmin(r), -12) && r.moves.some(m => m.cycle && m.feed === 500), 'cycle 17: F = S x pitch = 500');
}

console.log('CYCLES — 212/213/214/215 finishing, 210/211 slots, 220/221 patterns, 230/231 surfaces');
{ const hdr = 'BEGIN PGM C MM\nBLK FORM 0.1 Z X+0 Y+0 Z-40\nBLK FORM 0.2 X+100 Y+100 Z+0\nTOOL DEF 1 L+0 R+3\nTOOL CALL 1 Z S3000\nL Z+50 R0 FMAX M3\n';
  const R = s => TNC.run(hdr + s + '\nEND PGM C MM');
  const P = r => pts(r).filter(q => q.m.cycle && q.m.kind !== 'rapid');
  let r = R('CYCL DEF 212 POCKET FINISHING\n Q200=2\n Q201=-20\n Q206=150\n Q202=5\n Q207=500\n Q203=+0\n Q204=50\n Q216=+50\n Q217=+50\n Q218=80\n Q219=60\n Q220=5\n Q221=0\nCYCL CALL');
  let q = P(r).filter(p => near(p.z, -20));
  ok(!r.errors.length, '212 no errors ' + JSON.stringify(r.errors));
  ok(near(Math.max(...q.map(p => p.x)), 87) && near(Math.min(...q.map(p => p.x)), 13) && near(Math.max(...q.map(p => p.y)), 77) && near(Math.min(...q.map(p => p.y)), 23),
     '212: wall at 80x60 about (50,50) -> tool centre 13..87 / 23..77');
  ok(new Set(P(r).map(p => +p.z.toFixed(3))).size >= 4, '212: 4 levels of Q202=5 down to 20');
  r = R('CYCL DEF 213 STUD FINISHING\n Q200=2\n Q201=-10\n Q206=150\n Q202=10\n Q207=500\n Q203=+0\n Q204=50\n Q216=+50\n Q217=+50\n Q218=40\n Q219=30\n Q220=2\n Q221=0\nCYCL CALL');
  q = P(r).filter(p => near(p.z, -10) && p.m.kind === 'feed' && Math.abs(p.y - 50) < 12);
  ok(!r.errors.length && q.some(p => near(p.x, 73)), '213: stud side X+70 -> tool centre X73 (outside)');
  r = R('CYCL DEF 214 C. POCKET FINISHING\n Q200=2\n Q201=-10\n Q206=150\n Q202=10\n Q207=500\n Q203=+0\n Q204=50\n Q216=+50\n Q217=+50\n Q222=79\n Q223=80\nCYCL CALL');
  const circ = r.moves.find(m => m.kind === 'arc' && near(Math.abs(m.sweep), 2 * Math.PI));
  ok(!r.errors.length && circ && near(Math.hypot(circ.from.x - 50, circ.from.y - 50), 37) && circ.sweep > 0, '214: full circle radius 40-3, counter-clockwise (climb)');
  r = R('CYCL DEF 215 C. STUD FINISHING\n Q200=2\n Q201=-10\n Q206=150\n Q202=10\n Q207=500\n Q203=+0\n Q204=50\n Q216=+50\n Q217=+50\n Q222=81\n Q223=80\nCYCL CALL');
  const c2 = r.moves.find(m => m.kind === 'arc' && near(Math.abs(m.sweep), 2 * Math.PI));
  ok(!r.errors.length && c2 && near(Math.hypot(c2.from.x - 50, c2.from.y - 50), 43) && c2.sweep < 0, '215: full circle radius 40+3, clockwise (climb outside)');
  r = R('CYCL DEF 200 DRILLING\n Q200=2\n Q201=-15\n Q206=250\n Q202=5\n Q210=0\n Q203=+0\n Q204=20\n Q211=0\nCYCL DEF 220 POLAR PATTERN\n Q216=+50\n Q217=+50\n Q244=80\n Q245=+0\n Q246=+360\n Q247=+0\n Q241=8\n Q200=2\n Q203=+0\n Q204=50\n Q301=1');
  const holes = r.moves.filter(m => m.cycle && m.kind === 'feed' && near(m.to.z, -15));
  ok(!r.errors.length && holes.length === 8 && holes.every(m => near(Math.hypot(m.to.x - 50, m.to.y - 50), 40)), '220: 8 holes on a D80 circle, got ' + holes.length);
  ok(holes.length === 8 && near(holes[1].to.x, 50 + 40 * Math.cos(Math.PI / 4)), '220: 45 deg steps (Q247=0, full circle / 8)');
  r = R('CYCL DEF 200 DRILLING\n Q200=2\n Q201=-5\n Q206=250\n Q202=5\n Q210=0\n Q203=+0\n Q204=20\n Q211=0\nCYCL DEF 221 CARTESIAN PATTERN\n Q225=+15\n Q226=+15\n Q237=+10\n Q238=+8\n Q242=6\n Q243=4\n Q224=+0\n Q200=2\n Q203=+0\n Q204=50\n Q301=1');
  const g = r.moves.filter(m => m.cycle && m.kind === 'feed' && near(m.to.z, -5));
  ok(!r.errors.length && g.length === 24 && near(Math.max(...g.map(m => m.to.x)), 65) && near(Math.max(...g.map(m => m.to.y)), 39), '221: 6 x 4 grid from (15,15) step 10/8, got ' + g.length);
  r = R('CYCL DEF 210 SLOT RECIP. PLNG\n Q200=2\n Q201=-10\n Q207=500\n Q202=5\n Q215=0\n Q203=+0\n Q204=50\n Q216=+50\n Q217=+50\n Q218=80\n Q219=12\n Q224=+0\n Q338=5\nCYCL CALL');
  q = P(r).filter(p => near(p.z, -10));
  ok(!r.errors.length && near(Math.max(...q.map(p => p.x)), 50 + 40 - 3) && near(Math.max(...q.map(p => p.y)), 53), '210: slot 80 x 12 finished to X87 / Y53');
  r = R('CYCL DEF 230 MULTIPASS MILLING\n Q225=+10\n Q226=+12\n Q227=+2.5\n Q218=80\n Q219=60\n Q240=7\n Q206=150\n Q207=500\n Q209=200\n Q200=2\nCYCL CALL');
  const passes = r.moves.filter(m => m.cycle && m.feed === 500);
  ok(!r.errors.length && passes.length === 7 && near(Math.max(...passes.map(m => m.to.y)), 72), '230: 7 passes from Y12 to Y72');
  r = R('CYCL DEF 231 RULED SURFACE\n Q225=+0\n Q226=+5\n Q227=-2\n Q228=+100\n Q229=+15\n Q230=+5\n Q231=+15\n Q232=+125\n Q233=+25\n Q234=+15\n Q235=+125\n Q236=+25\n Q240=40\n Q207=500\nCYCL CALL');
  ok(!r.errors.length && r.moves.some(m => m.cycle && near(m.to.z, 25)), '231: reaches the 3rd/4th point height Z+25');
}
console.log(fails ? `\n${fails} FAILED` : '\nALL MANUAL EXAMPLES PASS');
process.exit(fails ? 1 : 0);
