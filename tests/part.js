/* TNC_PART: the AI's interim 3-D model. A spec is rasterised, a program is machined on the same height field,
   and the comparison must reward the right program and catch the wrong one. Offline, no AI.  node tests/part.js */
const T = require('../sim/core.js'), SIM = require('../sim/sim.js'), P = require('../sim/part.js');
let fails = 0;
const ok = (c, m, d) => { console.log((c ? '  ok    ' : '  FAIL  ') + m + (c ? '' : '  (' + d + ')')); if (!c) fails++; };
const measure = (spec, src) => { const r = T.run(src, {}); if (r.errors.length) throw new Error(r.errors.map((e) => e.msg).join('; '));
  const ex = SIM.expand(r); return P.compare(spec, r, ex); };

const spec = { blank: { x: [0, 100], y: [0, 80], z: [-20, 0] }, features: [
  { id: 'P1', type: 'pocket', shape: 'rect', x: [30, 70], y: [20, 60], r: 6, z: -5 },
  { id: 'H1', type: 'hole', x: 10, y: 10, d: 8.5, z: -25 } ] };
// the pocket by hand: T5 Ø12 end mill, two Z levels, centre slot + offset loop at the wall; then T2 drills the hole
const good = `BEGIN PGM GOOD MM
BLK FORM 0.1 Z X+0 Y+0 Z-20
BLK FORM 0.2 X+100 Y+80 Z+0
TOOL CALL 5 Z S3000
L Z+50 R0 FMAX M3
L X+50 Y+40 R0 FMAX
L Z+2 R0 FMAX
FN 0: Q1 = -2.5
LBL 1
L Z+Q1 R0 F150
L X+36 Y+26 R0 F800
L X+64
L Y+54
L X+36
L Y+26
L X+50 Y+40
FN 2: Q1 = +Q1 - +2.5
FN 11: IF +Q1 GT -5.01 GOTO LBL 1
L Z+2 R0 FMAX
TOOL CALL 2 Z S1800
L Z+50 R0 FMAX M3
CYCL DEF 200 DRILLING
  Q200=+2 ;SET-UP CLEARANCE
  Q201=-25 ;DEPTH
  Q206=+150 ;FEED RATE FOR PLNGNG
  Q202=+5 ;PLUNGING DEPTH
  Q210=+0 ;DWELL TIME AT TOP
  Q203=+0 ;SURFACE COORDINATE
  Q204=+50 ;2ND SET-UP CLEARANCE
L X+10 Y+10 R0 FMAX M99
L Z+50 R0 FMAX M30
END PGM GOOD MM`;
const g = measure(spec, good);
console.log(g.text.split('\n').map((l) => '        ' + l).join('\n'));
ok(g.score > 90, 'a correct program matches the spec (> 90 %)', g.score);
ok(g.features[0].coverage > 90 && g.features[1].coverage > 85, 'pocket and hole both at depth', JSON.stringify(g.features.map((f) => f.coverage.toFixed(1))));

const wrong = good.replace('L X+10 Y+10 R0 FMAX M99', 'L X+20 Y+10 R0 FMAX M99').replace('IF +Q1 GE -5', 'IF +Q1 GT -2.51');
const w = measure(spec, wrong);
ok(w.score < g.score - 10, 'hole in the wrong place + pocket half deep scores clearly lower', w.score + ' vs ' + g.score);
ok(/NOT CUT/.test(w.text) && /CUT WHERE IT SHOULD NOT/.test(w.text), 'misses and gouges are located in the report');
ok(w.features[1].coverage < 30, 'the misplaced hole is reported as missing', w.features[1].coverage);

// lettering: expand gives exact strokes; a program that follows them with the right cutter matches
const tspec = { blank: { x: [0, 160], y: [0, 50], z: [-10, 0] }, features: [{ id: 'T1', type: 'text', text: 'TNC 426', x: 10, y: 15, h: 20, w: 3, z: -1 }] };
const tools = T.TOOLS;
const e = P.expand(tspec, tools);
ok(e.notes.length === 0, 'text spec is feasible with T9 Ø3', e.notes.join('; '));
ok(/T1\.1: \(/.test(e.sheet), 'the sheet lists stroke 1 in absolute mm');
const st = e.spec.features[0].paths;
let prog = ['BEGIN PGM TXT MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-10', 'BLK FORM 0.2 X+160 Y+50 Z+0', 'TOOL CALL 9 Z S8000', 'L Z+50 R0 FMAX M3'];
const f3 = (v) => (v >= 0 ? '+' : '') + (+v.toFixed(3));
st.forEach((pl) => { prog.push(`L X${f3(pl[0][0])} Y${f3(pl[0][1])} R0 FMAX`, 'L Z+2 R0 FMAX', 'L Z-1 R0 F200');
  pl.slice(1).forEach((p) => prog.push(`L X${f3(p[0])} Y${f3(p[1])} R0 F600`)); prog.push('L Z+2 R0 FMAX'); });
prog.push('L Z+50 R0 FMAX M30', 'END PGM TXT MM');
const t = measure(e.spec, prog.join('\n'));
ok(t.score > 85, 'engraving written from the expanded strokes matches the text (> 85 %)', t.score);
const shifted = measure(e.spec, prog.join('\n').replace(/X([+-][\d.]+)/g, (m, v) => 'X' + f3(+v + 2)));
ok(shifted.score < t.score - 25, 'the same lettering 2 mm off scores far lower', shifted.score + ' vs ' + t.score);
ok(P.strokes('ÅÄÖ', { h: 6 }).missing.length === 0, 'Swedish capitals have glyphs');
const bad = P.parse('```partspec\n{"blank":{"x":[0,1]},"features":[]}\n```');
ok(!!bad.error, 'an incomplete spec is refused with a reason', bad.error);
console.log(fails ? `\n${fails} FAILED` : '\nALL PART-SPEC CHECKS PASS');
process.exit(fails ? 1 : 0);
