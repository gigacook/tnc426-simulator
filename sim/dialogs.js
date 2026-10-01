/* ============================================================
   TNC_DIALOGS — the programming dialogs of the TNC 426/430 keyboard:
   path functions, TOOL DEF / TOOL CALL, CYCL DEF (grouped soft keys, one
   question per parameter), CYCL CALL, labels, STOP, Q parameters.
   Pure data + block builders; the dialog engine lives in ui.js.

   A spec: { id, key, title, steps:[step], build(values) -> text }
   A step: { k, ask, type, opts?, dflt?, opt? }
     type 'coords'  "X+10 Y-5": the coordinate keypad of the 426/430 keyboard (manual inside front cover):
                    axis keys X Y Z IV V, 0-9 . -/+, I (incremental), P (polar: the spec's .polar
                    dialog), Q (parameter), actual-position capture, CE; bare numbers go to X Y Z in turn
          pol:true  on a 'num' step: a polar coordinate (PR / PA) — the same keypad without axes/P/capture
          'num'     one number (Q allowed); dflt used on ENT
          'choice'  soft keys opts; ENT = dflt
          'feed'    number, FMAX / F AUTO soft keys; ENT = keep modal feed
          'm'       M function; ENT = none
          'text'    free text (formula)
   Parameter names and defaults follow the TNC 426/430 user manual, NC SW 280 476.
   ============================================================ */
var TNC_DIALOGS = (function () {
  'use strict';
  var sg = function (v) { v = String(v).trim(); if (/^Q/i.test(v)) return '+' + v.toUpperCase(); var n = parseFloat(v); return (n < 0 || /^-/.test(v) ? '-' : '+') + String(Math.abs(n)); };
  var join = function (a) { return a.filter(function (x) { return x !== '' && x != null; }).join(' '); };
  var RC = { k: 'rc', ask: 'RADIUS COMP.: RL/RR/NO COMP. ?', type: 'choice', opts: ['RL', 'RR', 'R0'], dflt: 'R0' };
  var F = { k: 'f', ask: 'FEED RATE F=?', type: 'feed' };
  var M = { k: 'm', ask: 'MISCELLANEOUS FUNCTION M ?', type: 'm', opt: true };
  var XY = { k: 'xyz', ask: 'COORDINATES ?', type: 'coords' };
  var DR = { k: 'dr', ask: 'DIRECTION OF ROTATION DR ?', type: 'choice', opts: ['DR+', 'DR-'], dflt: 'DR+' };
  var feedTxt = function (v) { return !v ? '' : (v === 'FMAX' || v === 'FAUTO' ? v : 'F' + String(v).replace(/^\+/, '')); };
  /* a polar coordinate word: "30" -> PR+30, "I-60" -> IPA-60, "Q5" -> PR+Q5 (I = incremental, manual 4.1 / 6.5) */
  var pw = function (name, v) { v = String(v).trim().toUpperCase().replace(/\s+/g, ''); var inc = /^I/.test(v); v = v.replace(/^I?(P[RA])?/, '');
    var s = /^-/.test(v) ? '-' : '+'; v = v.replace(/^[+-]/, ''); return (inc ? 'I' : '') + name + s + (/^Q/.test(v) ? v : String(Math.abs(parseFloat(v)))); };
  var PR = { k: 'pr', ask: 'POLAR COORDINATES RADIUS PR ?', type: 'num', pol: true }, PA = { k: 'pa', ask: 'POLAR COORDINATES ANGLE PA ?', type: 'num', pol: true };
  var mTxt = function (v) { return v ? String(v).split(/[\s,]+/).filter(Boolean).map(function (m) { return 'M' + m.replace(/^M/i, ''); }).join(' ') : ''; };

  var PATH = {
    /* .polar: the P key during COORDINATES ? turns the block into its polar form (manual 6.5: L+P = LP, C+P = CP, CT+P = CTP; CC is Cartesian only) */
    L:   { key: 'L', title: 'STRAIGHT LINE L', polar: 'LP', steps: [XY, RC, F, M], build: function (v) { return join(['L', v.xyz, v.rc, feedTxt(v.f), mTxt(v.m)]); } },
    CC:  { key: 'CC', title: 'CIRCLE CENTER CC', steps: [{ k: 'xyz', ask: 'COORDINATES ? (ENT = LAST POSITION)', type: 'coords', opt: true }], build: function (v) { return join(['CC', v.xyz]); } },
    C:   { key: 'C', title: 'CIRCULAR ARC C', polar: 'CP', steps: [XY, DR, RC, F, M], build: function (v) { return join(['C', v.xyz, v.dr, v.rc, feedTxt(v.f), mTxt(v.m)]); } },
    CR:  { key: 'CR', title: 'CIRCULAR ARC CR', steps: [XY, { k: 'r', ask: 'CIRCLE RADIUS R ? (- = MORE THAN 180°)', type: 'num' }, DR, RC, F, M],
           build: function (v) { return join(['CR', v.xyz, 'R' + sg(v.r), v.dr, v.rc, feedTxt(v.f), mTxt(v.m)]); } },
    CT:  { key: 'CT', title: 'TANGENTIAL ARC CT', polar: 'CTP', steps: [XY, RC, F, M], build: function (v) { return join(['CT', v.xyz, v.rc, feedTxt(v.f), mTxt(v.m)]); } },
    RND: { key: 'RND', title: 'CORNER ROUNDING RND', steps: [{ k: 'r', ask: 'ROUNDING-OFF RADIUS ?', type: 'num' }, { k: 'f', ask: 'FEED RATE F=? (THIS BLOCK ONLY)', type: 'feed' }],
           build: function (v) { return join(['RND', 'R' + String(v.r).replace(/^\+/, ''), feedTxt(v.f)]); } },
    CHF: { key: 'CHF', title: 'CHAMFER CHF', steps: [{ k: 'l', ask: 'CHAMFER SIDE LENGTH ?', type: 'num' }, { k: 'f', ask: 'FEED RATE F=? (THIS BLOCK ONLY)', type: 'feed' }],
           build: function (v) { return join(['CHF', String(v.l).replace(/^\+/, ''), feedTxt(v.f)]); } },
    LP:  { key: 'LP', title: 'POLAR LINE LP', steps: [{ k: 'pr', ask: PR.ask, type: 'num', pol: true, opt: true }, { k: 'pa', ask: PA.ask, type: 'num', pol: true, opt: true }, RC, F, M],
           build: function (v) { return join(['LP', v.pr ? pw('PR', v.pr) : '', v.pa ? pw('PA', v.pa) : '', v.rc, feedTxt(v.f), mTxt(v.m)]); } },
    CP:  { key: 'CP', title: 'POLAR ARC CP', steps: [PA, { k: 'iz', ask: 'HELIX: INCREMENTAL Z ? (ENT = NONE)', type: 'num', opt: true }, DR, RC, F, M],
           build: function (v) { return join(['CP', pw('PA', v.pa), v.iz ? 'IZ' + sg(v.iz) : '', v.dr, v.rc, feedTxt(v.f), mTxt(v.m)]); } },
    /* CTP: polar radius + polar angle of the arc end point (manual 6.5, p. 153); RC/F/M as in CT */
    CTP: { key: 'CTP', title: 'TANGENTIAL ARC CTP', steps: [PR, PA, RC, F, M],
           build: function (v) { return join(['CTP', pw('PR', v.pr), pw('PA', v.pa), v.rc, feedTxt(v.f), mTxt(v.m)]); } },
    APPR: { key: 'APPR\nDEP', title: 'CONTOUR APPROACH APPR', steps: [
             { k: 'form', ask: 'APPROACH: LT / LN / CT / LCT ?', type: 'choice', opts: ['LT', 'LN', 'CT', 'LCT'], dflt: 'LCT' },
             { k: 'xyz', ask: 'COORDINATES OF THE FIRST CONTOUR POINT ?', type: 'coords' },
             { k: 'len', ask: 'LEN (LT/LN) ? ENT = NONE', type: 'num', opt: true },
             { k: 'r', ask: 'RADIUS R (CT/LCT) ? ENT = NONE', type: 'num', opt: true },
             { k: 'cca', ask: 'CENTER ANGLE CCA (CT) ? ENT = NONE', type: 'num', opt: true },
             { k: 'rc', ask: 'RADIUS COMP.: RL/RR ?', type: 'choice', opts: ['RL', 'RR', 'R0'], dflt: 'RL' }, F, M],
           build: function (v) { return join(['APPR ' + v.form, v.xyz, v.len ? 'LEN' + String(v.len).replace(/^\+/, '') : '', v.cca ? 'CCA' + String(v.cca).replace(/^\+/, '') : '', v.r ? 'R' + sg(v.r) : '', v.rc, feedTxt(v.f), mTxt(v.m)]); } },
    DEP: { key: 'DEP', title: 'CONTOUR DEPARTURE DEP', steps: [
             { k: 'form', ask: 'DEPARTURE: LT / LN / CT / LCT ?', type: 'choice', opts: ['LT', 'LN', 'CT', 'LCT'], dflt: 'LCT' },
             { k: 'xyz', ask: 'END POINT (LCT) ? ENT = NONE', type: 'coords', opt: true },
             { k: 'len', ask: 'LEN (LT/LN) ? ENT = NONE', type: 'num', opt: true },
             { k: 'r', ask: 'RADIUS R (CT/LCT) ? ENT = NONE', type: 'num', opt: true },
             { k: 'cca', ask: 'CENTER ANGLE CCA (CT) ? ENT = NONE', type: 'num', opt: true }, F, M],
           build: function (v) { return join(['DEP ' + v.form, v.xyz, v.len ? 'LEN' + String(v.len).replace(/^\+/, '') : '', v.cca ? 'CCA' + String(v.cca).replace(/^\+/, '') : '', v.r ? 'R' + sg(v.r) : '', feedTxt(v.f), mTxt(v.m)]); } },
    TOOLDEF: { key: 'TOOL\nDEF', title: 'TOOL DEF', steps: [{ k: 't', ask: 'TOOL NUMBER ?', type: 'num' }, { k: 'l', ask: 'TOOL LENGTH L ?', type: 'num', dflt: '0' }, { k: 'r', ask: 'TOOL RADIUS R ?', type: 'num' }],
           build: function (v) { return 'TOOL DEF ' + String(v.t).replace(/^\+/, '') + ' L' + sg(v.l || 0) + ' R' + sg(v.r); } },
    TOOLCALL: { key: 'TOOL\nCALL', title: 'TOOL CALL', steps: [
             { k: 't', ask: 'TOOL NUMBER ? (SOFT KEYS: THE TOOL TABLE)', type: 'tool' },
             { k: 'ax', ask: 'WORKING SPINDLE AXIS X/Y/Z ?', type: 'choice', opts: ['Z', 'X', 'Y'], dflt: 'Z' },
             { k: 's', ask: 'SPINDLE SPEED S RPM ?', type: 'num', opt: true },
             { k: 'dl', ask: 'TOOL LENGTH OVERSIZE DL ? ENT = NONE', type: 'num', opt: true },
             { k: 'dr', ask: 'TOOL RADIUS OVERSIZE DR ? ENT = NONE', type: 'num', opt: true }],
           build: function (v) { return join(['TOOL CALL', String(v.t).replace(/^\+/, ''), v.ax, v.s ? 'S' + String(v.s).replace(/^\+/, '') : '', v.dl ? 'DL' + sg(v.dl) : '', v.dr ? 'DR' + sg(v.dr) : '']); } },
    CYCLCALL: { key: 'CYCL\nCALL', title: 'CYCL CALL', steps: [M], build: function (v) { return join(['CYCL CALL', mTxt(v.m)]); } },
    LBLSET: { key: 'LBL\nSET', title: 'LABEL SET', steps: [{ k: 'n', ask: 'LABEL NUMBER ? (0 = END OF SUBPROGRAM)', type: 'num' }], build: function (v) { return 'LBL ' + String(v.n).replace(/^\+/, ''); } },
    LBLCALL: { key: 'LBL\nCALL', title: 'LABEL CALL', steps: [{ k: 'n', ask: 'LABEL NUMBER ?', type: 'num' }, { k: 'rep', ask: 'REPEAT REP ? ENT = SUBPROGRAM CALL', type: 'num', opt: true }],
           build: function (v) { return 'CALL LBL ' + String(v.n).replace(/^\+/, '') + (v.rep ? ' REP ' + String(v.rep).replace(/^\+/, '') + '/' + String(v.rep).replace(/^\+/, '') : ''); } },
    Q: { key: 'Q', title: 'Q PARAMETER', steps: [{ k: 'q', ask: 'PARAMETER NUMBER FOR RESULT ?', type: 'num' }, { k: 'e', ask: 'FORMULA ? e.g. Q1 * COS Q2 + 5', type: 'text' }],
           build: function (v) { return 'Q' + String(v.q).replace(/^\+/, '') + ' = ' + v.e; } },
    STOP: { key: 'STOP', title: 'PROGRAM STOP', steps: [M], build: function (v) { return join(['STOP', mTxt(v.m)]); } }
  };

  /* ---- cycles: [num, name, group, [[Q, text, default], ...]] ---- */
  var C200 = [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -20], [206, 'FEED RATE FOR PLNGNG', 150], [202, 'PLUNGING DEPTH', 5],
              [210, 'DWELL TIME AT TOP', 0], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [211, 'DWELL TIME AT DEPTH', 0]];
  var FIN = function (round) { return [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -20], [206, 'FEED RATE FOR PLNGNG', 150], [202, 'PLUNGING DEPTH', 5],
    [207, 'FEED RATE FOR MILLNG', 500], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [216, 'CENTER IN 1ST AXIS', 50], [217, 'CENTER IN 2ND AXIS', 50]]
    .concat(round ? [[222, 'WORKPIECE BLANK DIA.', 79], [223, 'FINISHED PART DIA.', 80]] : [[218, 'FIRST SIDE LENGTH', 80], [219, 'SECOND SIDE LENGTH', 60], [220, 'CORNER RADIUS', 5], [221, 'ALLOWANCE IN 1ST AXS', 0]]); };
  var CYCLES = [
    [200, 'DRILLING', 'DRILL', C200],
    [201, 'REAMING', 'DRILL', [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -15], [206, 'FEED RATE FOR PLNGNG', 100], [211, 'DWELL TIME AT DEPTH', 0.5], [208, 'RETRACTION FEED RATE', 250], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50]]],
    [202, 'BORING', 'DRILL', [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -15], [206, 'FEED RATE FOR PLNGNG', 100], [211, 'DWELL TIME AT DEPTH', 0.5], [208, 'RETRACTION FEED RATE', 250], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [214, 'DISENGAGING DIRECTN', 1], [336, 'ANGLE OF SPINDLE', 0]]],
    [203, 'UNIVERSAL DRILLING', 'DRILL', [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -20], [206, 'FEED RATE FOR PLNGNG', 150], [202, 'PLUNGING DEPTH', 5], [210, 'DWELL TIME AT TOP', 0], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [212, 'DECREMENT', 0.2], [213, 'BREAKS', 3], [205, 'MIN. PLUNGING DEPTH', 3], [211, 'DWELL TIME AT DEPTH', 0.25], [208, 'RETRACTION FEED RATE', 500], [256, 'DIST. FOR CHIP BRKNG', 0.2]]],
    [204, 'BACK BORING', 'DRILL', [[200, 'SET-UP CLEARANCE', 2], [249, 'DEPTH OF COUNTERBORE', 5], [250, 'MATERIAL THICKNESS', 20], [251, 'OFF-CENTER DISTANCE', 3.5], [252, 'TOOL EDGE HEIGHT', 15], [253, 'F PRE-POSITIONING', 750], [254, 'F COUNTERBORING', 200], [255, 'DWELL TIME', 0], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [214, 'DISENGAGING DIRECTN', 1]]],
    [205, 'UNIVERSAL PECKING', 'DRILL', [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -80], [206, 'FEED RATE FOR PLNGNG', 150], [202, 'PLUNGING DEPTH', 15], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [212, 'DECREMENT', 0.5], [205, 'MIN. PLUNGING DEPTH', 3], [258, 'UPPER ADV STOP DIST', 0.5], [259, 'LOWER ADV STOP DIST', 1], [257, 'DEPTH FOR CHIP BRKNG', 5], [256, 'DIST FOR CHIP BRKNG', 0.2], [211, 'DWELL TIME AT DEPTH', 0.25]]],
    [208, 'BORE MILLING', 'DRILL', [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -80], [206, 'FEED RATE FOR PLNGNG', 150], [334, 'PLUNGING DEPTH', 1.5], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [335, 'NOMINAL DIAMETER', 25], [342, 'ROUGHING DIAMETER', 0]]],
    [206, 'TAPPING NEW', 'TAP', [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -20], [206, 'FEED RATE FOR PLNGNG', 150], [211, 'DWELL TIME AT DEPTH', 0.25], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50]]],
    [207, 'RIGID TAPPING NEW', 'TAP', [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -20], [239, 'PITCH', 1], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50]]],
    [209, 'TAPPING W/ CHIP BRKG', 'TAP', [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -20], [239, 'PITCH', 1], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [257, 'DEPTH FOR CHIP BRKNG', 5], [256, 'DIST FOR CHIP BRKNG', 0.2], [336, 'ANGLE OF SPINDLE', 0]]],
    [262, 'THREAD MILLING', 'TAP', [[335, 'NOMINAL DIAMETER', 10], [239, 'PITCH', 1.5], [201, 'THREAD DEPTH', -20], [355, 'THREADS PER STEP', 0], [253, 'F PRE-POSITIONING', 750], [351, 'CLIMB OR UP-CUT', 1], [200, 'SET-UP CLEARANCE', 2], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [207, 'FEED RATE FOR MILLING', 500]]],
    [263, 'THREAD MLLNG/CNTSNKG', 'TAP', [[335, 'NOMINAL DIAMETER', 10], [239, 'PITCH', 1.5], [201, 'THREAD DEPTH', -16], [356, 'COUNTERSINKING DEPTH', -20], [253, 'F PRE-POSITIONING', 750], [351, 'CLIMB OR UP-CUT', 1], [200, 'SET-UP CLEARANCE', 2], [357, 'CLEARANCE TO SIDE', 0.2], [358, 'DEPTH AT FRONT', 0], [359, 'OFFSET AT FRONT', 0], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [254, 'F COUNTERSINKING', 150], [207, 'FEED RATE FOR MILLING', 500]]],
    [264, 'THREAD DRILLNG/MLLNG', 'TAP', [[335, 'NOMINAL DIAMETER', 10], [239, 'PITCH', 1.5], [201, 'THREAD DEPTH', -16], [356, 'TOTAL HOLE DEPTH', -20], [253, 'F PRE-POSITIONING', 750], [351, 'CLIMB OR UP-CUT', 1], [202, 'PLUNGING DEPTH', 5], [258, 'ADVANCED STOP DISTANCE', 0.2], [257, 'DEPTH FOR CHIP BRKNG', 5], [256, 'DIST FOR CHIP BRKNG', 0.2], [358, 'DEPTH AT FRONT', 0], [359, 'OFFSET AT FRONT', 0], [200, 'SET-UP CLEARANCE', 2], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [206, 'FEED RATE FOR PLUNGING', 150], [207, 'FEED RATE FOR MILLING', 500]]],
    [265, 'HEL.THREAD DRLG/MLG', 'TAP', [[335, 'NOMINAL DIAMETER', 10], [239, 'PITCH', 1.5], [201, 'THREAD DEPTH', -16], [253, 'F PRE-POSITIONING', 750], [358, 'DEPTH AT FRONT', 0], [359, 'OFFSET AT FRONT', 0], [360, 'COUNTERSINKING', 0], [200, 'SET-UP CLEARANCE', 2], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [254, 'F COUNTERSINKING', 150], [207, 'FEED RATE FOR MILLING', 500]]],
    [267, 'OUTSIDE THREAD MLLNG', 'TAP', [[335, 'NOMINAL DIAMETER', 10], [239, 'PITCH', 1.5], [201, 'THREAD DEPTH', -20], [355, 'THREADS PER STEP', 0], [253, 'F PRE-POSITIONING', 750], [351, 'CLIMB OR UP-CUT', 1], [200, 'SET-UP CLEARANCE', 2], [358, 'DEPTH AT FRONT', 0], [359, 'OFFSET AT FRONT', 0], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [254, 'F COUNTERSINKING', 150], [207, 'FEED RATE FOR MILLING', 500]]],
    [212, 'POCKET FINISHING', 'POCKET', FIN(false)],
    [213, 'STUD FINISHING', 'POCKET', FIN(false)],
    [214, 'C. POCKET FINISHING', 'POCKET', FIN(true)],
    [215, 'C. STUD FINISHING', 'POCKET', FIN(true)],
    [210, 'SLOT RECIP. PLNG', 'POCKET', [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -20], [207, 'FEED RATE FOR MILLNG', 500], [202, 'PLUNGING DEPTH', 5], [215, 'MACHINING OPERATION', 0], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [216, 'CENTER IN 1ST AXIS', 50], [217, 'CENTER IN 2ND AXIS', 50], [218, 'FIRST SIDE LENGTH', 80], [219, 'SECOND SIDE LENGTH', 12], [224, 'ANGLE OF ROTATION', 0], [338, 'INFEED FOR FINISHING', 5]]],
    [211, 'CIRCULAR SLOT', 'POCKET', [[200, 'SET-UP CLEARANCE', 2], [201, 'DEPTH', -20], [207, 'FEED RATE FOR MILLNG', 500], [202, 'PLUNGING DEPTH', 5], [215, 'MACHINING OPERATION', 0], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [216, 'CENTER IN 1ST AXIS', 50], [217, 'CENTER IN 2ND AXIS', 50], [244, 'PITCH CIRCLE DIAMETR', 80], [219, 'SECOND SIDE LENGTH', 12], [245, 'STARTING ANGLE', 45], [248, 'ANGULAR LENGTH', 90], [338, 'INFEED FOR FINISHING', 5]]],
    [220, 'POLAR PATTERN', 'PATTERN', [[216, 'CENTER IN 1ST AXIS', 50], [217, 'CENTER IN 2ND AXIS', 50], [244, 'PITCH CIRCLE DIAMETR', 80], [245, 'STARTING ANGLE', 0], [246, 'STOPPING ANGLE', 360], [247, 'STEPPING ANGLE', 0], [241, 'NR OF REPETITIONS', 8], [200, 'SET-UP CLEARANCE', 2], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [301, 'MOVE TO CLEARANCE', 1]]],
    [221, 'CARTESIAN PATTERN', 'PATTERN', [[225, 'STARTNG PNT 1ST AXIS', 15], [226, 'STARTNG PNT 2ND AXIS', 15], [237, 'SPACING IN 1ST AXIS', 10], [238, 'SPACING IN 2ND AXIS', 8], [242, 'NUMBER OF COLUMNS', 6], [243, 'NUMBER OF LINES', 4], [224, 'ANGLE OF ROTATION', 0], [200, 'SET-UP CLEARANCE', 2], [203, 'SURFACE COORDINATE', 0], [204, '2ND SET-UP CLEARANCE', 50], [301, 'MOVE TO CLEARANCE', 1]]],
    [230, 'MULTIPASS MILLING', 'SURFACE', [[225, 'STARTNG PNT 1ST AXIS', 0], [226, 'STARTNG PNT 2ND AXIS', 0], [227, 'STARTNG PNT 3RD AXIS', 0], [218, 'FIRST SIDE LENGTH', 100], [219, 'SECOND SIDE LENGTH', 80], [240, 'NUMBER OF CUTS', 10], [206, 'FEED RATE FOR PLNGNG', 150], [207, 'FEED RATE FOR MILLNG', 500], [209, 'STEPOVER FEED RATE', 200], [200, 'SET-UP CLEARANCE', 2]]],
    [231, 'RULED SURFACE', 'SURFACE', [[225, 'STARTNG PNT 1ST AXIS', 0], [226, 'STARTNG PNT 2ND AXIS', 0], [227, 'STARTNG PNT 3RD AXIS', 0], [228, '2ND POINT 1ST AXIS', 100], [229, '2ND POINT 2ND AXIS', 0], [230, '2ND POINT 3RD AXIS', 0], [231, '3RD POINT 1ST AXIS', 100], [232, '3RD POINT 2ND AXIS', 80], [233, '3RD POINT 3RD AXIS', 0], [234, '4TH POINT 1ST AXIS', 0], [235, '4TH POINT 2ND AXIS', 80], [236, '4TH POINT 3RD AXIS', 0], [240, 'NUMBER OF CUTS', 20], [207, 'FEED RATE FOR MILLNG', 500]]],
    [247, 'DATUM SETTING', 'TRANSF', [[339, 'DATUM NUMBER', 1]]]
  ];
  /* dotted (old-style) cycles: sub-blocks [text, default, kind] */
  var DOTTED = [
    [1, 'PECKING', 'DRILL', [['SET UP', 2], ['DEPTH', -20], ['PECKG', 5], ['DWELL', 0], ['F', 100]]],
    [2, 'TAPPING', 'TAP', [['SET UP', 2], ['DEPTH', -20], ['DWELL', 0], ['F', 100]]],
    [17, 'RIGID TAPPING', 'TAP', [['SET UP', 2], ['DEPTH', -20], ['PITCH', 1]]],
    [18, 'THREAD CUTTING', 'TAP', [['DEPTH', -20], ['PITCH', 1]]],
    [4, 'POCKET MILLING', 'POCKET', [['SET UP', 2], ['DEPTH', -10], ['PECKG', 4, 'F', 80], ['X', 80], ['Y', 60], ['F', 275, 'DR', '+', 'RADIUS', 0]]],
    [7, 'DATUM SHIFT', 'TRANSF', [['X', 0, 'axis'], ['Y', 0, 'axis'], ['Z', 0, 'axis']]],
    [8, 'MIRROR IMAGE', 'TRANSF', [['AXES (X Y Z, ENT = CANCEL)', '', 'axes']]],
    [10, 'ROTATION', 'TRANSF', [['ROT', 0]]],
    [11, 'SCALING', 'TRANSF', [['SCL', 1]]],
    [19, 'WORKING PLANE', 'TRANSF', [['A', 0, 'rot'], ['B', 0, 'rot'], ['C', 0, 'rot']]],
    [9, 'DWELL TIME', 'SPECIAL', [['DWELL', 1]]],
    [32, 'TOLERANCE', 'SPECIAL', [['T', 0.05]]]
  ];
  /* TCH PROBE cycles (TOUCH PROBE key), Q style; example values from the iTNC 530 manual ch. 15/19 (the 426/430 probe manual is not at hand) */
  var TS = [[381, 'PROBE IN TS AXIS', 0], [382, '1ST CO. FOR TS AXIS', 85], [383, '2ND CO. FOR TS AXIS', 50], [384, '3RD CO. FOR TS AXIS', 0], [333, 'DATUM', 1]];
  var PCIRC = [[321, 'CENTER IN 1ST AXIS', 50], [322, 'CENTER IN 2ND AXIS', 50], [262, 'NOMINAL DIAMETER', 75], [325, 'STARTING ANGLE', 0], [247, 'STEPPING ANGLE', 60],
    [261, 'MEASURING HEIGHT', -5], [320, 'SET-UP CLEARANCE', 0], [260, 'CLEARANCE HEIGHT', 20], [301, 'MOVE TO CLEARANCE', 0], [305, 'NUMBER IN TABLE', 0],
    [331, 'DATUM', 0], [332, 'DATUM', 0], [303, 'MEAS. VALUE TRANSFER', 1]].concat(TS, [[423, 'NO. OF MEAS. POINTS', 4], [365, 'TYPE OF TRAVERSE', 1]]);
  var PRECT = [[321, 'CENTER IN 1ST AXIS', 50], [322, 'CENTER IN 2ND AXIS', 50], [323, 'FIRST SIDE LENGTH', 60], [324, '2ND SIDE LENGTH', 20], [261, 'MEASURING HEIGHT', -5],
    [320, 'SET-UP CLEARANCE', 0], [260, 'CLEARANCE HEIGHT', 20], [301, 'MOVE TO CLEARANCE', 0], [305, 'NUMBER IN TABLE', 0], [331, 'DATUM', 0], [332, 'DATUM', 0], [303, 'MEAS. VALUE TRANSFER', 1]].concat(TS);
  var PSLOT = function (w) { return [[321, 'CENTER IN 1ST AXIS', 50], [322, 'CENTER IN 2ND AXIS', 50], [311, w + ' WIDTH', 25], [272, 'MEASURING AXIS', 1], [261, 'MEASURING HEIGHT', -5],
    [320, 'SET-UP CLEARANCE', 0], [260, 'CLEARANCE HEIGHT', 20]].concat(w === 'SLOT' ? [[301, 'MOVE TO CLEARANCE', 0]] : [], [[305, 'NUMBER IN TABLE', 0], [405, 'DATUM', 0], [303, 'MEAS. VALUE TRANSFER', 1]], TS); };
  var PROBES = [
    [408, 'SLOT CENTER REF PT', PSLOT('SLOT')],
    [409, 'RIDGE CENTER REF PT', PSLOT('RIDGE')],
    [410, 'DATUM INSIDE RECTAN.', PRECT],
    [411, 'DATUM OUTS. RECTAN.', PRECT.map(function (p) { return p[0] === 323 ? [323, 'FIRST SIDE LENGTH', 60] : p; })],
    [412, 'DATUM INSIDE CIRCLE', PCIRC],
    [413, 'DATUM OUTSIDE CIRCLE', PCIRC.map(function (p) { return p[0] === 262 ? [262, 'NOMINAL DIAMETER', 30] : p; })],
    [417, 'DATUM IN TS AXIS', [[263, '1ST POINT 1ST AXIS', 25], [264, '1ST POINT 2ND AXIS', 25], [294, '1ST POINT 3RD AXIS', 25], [320, 'SET-UP CLEARANCE', 0], [260, 'CLEARANCE HEIGHT', 50], [305, 'NUMBER IN TABLE', 0], [333, 'DATUM', 0], [303, 'MEAS. VALUE TRANSFER', 1]]],
    [419, 'DATUM IN ONE AXIS', [[263, '1ST POINT 1ST AXIS', 25], [264, '1ST POINT 2ND AXIS', 25], [261, 'MEASURING HEIGHT', 25], [320, 'SET-UP CLEARANCE', 0], [260, 'CLEARANCE HEIGHT', 50], [272, 'MEASURING AXIS', 1], [267, 'TRAVERSE DIRECTION', 1], [305, 'NUMBER IN TABLE', 0], [333, 'DATUM', 0], [303, 'MEAS. VALUE TRANSFER', 1]]],
    [481, 'TOOL LENGTH', [[340, 'CHECK', 1], [260, 'CLEARANCE HEIGHT', 100], [341, 'PROBING THE TEETH', 1]]]
  ];
  var GROUPS = [['DRILL', 'DRILLING/\nTHREAD'], ['TAP', 'TAPPING'], ['POCKET', 'POCKETS/\nSTUDS/SLOTS'], ['PATTERN', 'POINT\nPATTERNS'],
                ['SURFACE', 'MULTIPASS\nMILLING'], ['TRANSF', 'COORD.\nTRANSF.'], ['SPECIAL', 'SPECIAL\nCYCLES']];

  function cycleList(group) {
    return CYCLES.filter(function (c) { return c[2] === group; }).map(function (c) { return { num: c[0], name: c[1] }; })
      .concat(DOTTED.filter(function (c) { return c[2] === group; }).map(function (c) { return { num: c[0], name: c[1] }; }));
  }
  function fmtQ(v) { v = String(v).trim(); if (/^[+-]?Q/i.test(v)) return v.toUpperCase(); var n = parseFloat(v); return isNaN(n) ? v : (n < 0 ? '-' : '+') + Math.abs(n); }

  /* Q style: head line + one question per Q parameter; params [[Q, text, default], ...] */
  function qSpec(head, num, params) {
    return { title: head, cycle: num,
      steps: params.map(function (p) { return { k: 'q' + p[0], ask: 'Q' + p[0] + '  ' + p[1] + ' ?', type: 'num', dflt: String(p[2]) }; }),
      build: function (v) {
        var w = 0; params.forEach(function (p) { w = Math.max(w, ('Q' + p[0] + '=' + fmtQ(v['q' + p[0]])).length); });
        return [head].concat(params.map(function (p) {
          var s = 'Q' + p[0] + '=' + fmtQ(v['q' + p[0]]); return '  ' + s + new Array(Math.max(1, w - s.length + 2)).join(' ') + ';' + p[1]; })).join('\n'); } };
  }
  function probeList() { return PROBES.map(function (c) { return { num: c[0], name: c[1] }; }); }
  function probeSpec(num) { var c = PROBES.filter(function (x) { return x[0] === num; })[0]; return c ? qSpec('TCH PROBE ' + c[0] + ' ' + c[1], c[0], c[2]) : null; }
  /* a spec for one cycle: one question per Q parameter (Q style) or per sub-block (dotted) */
  function cycleSpec(num) {
    var q = CYCLES.filter(function (c) { return c[0] === num; })[0];
    if (q) return qSpec('CYCL DEF ' + q[0] + ' ' + q[1], q[0], q[3]);
    var d = DOTTED.filter(function (c) { return c[0] === num; })[0];
    if (!d) return null;
    return { title: 'CYCL DEF ' + d[0] + ' ' + d[1], cycle: d[0],
      steps: d[3].map(function (s, i) {
        if (s[2] === 'axes') return { k: 's' + i, ask: 'MIRROR IMAGE AXES ? (ENT = CANCEL MIRRORING)', type: 'text', opt: true };
        if (s[2] === 'axis') return { k: 's' + i, ask: 'DATUM SHIFT ' + s[0] + ' ? (I = INCREMENTAL)', type: 'text', dflt: String(s[1]) };
        if (s[2] === 'rot') return { k: 's' + i, ask: 'ROT. ANGLE ' + s[0] + ' ? (0 = NONE; ALL 0 = RESET)', type: 'num', dflt: String(s[1]) };
        return { k: 's' + i, ask: s[0] + ' ?', type: 'num', dflt: String(s[1]) }; })
        .concat(num === 4 ? [{ k: 'p2', ask: 'PLUNGING FEED F ?', type: 'num', dflt: '80' }, { k: 'dr', ask: 'DIRECTION DR ?', type: 'choice', opts: ['DR+', 'DR-'], dflt: 'DR+' }] : []),
      build: function (v) {
        var out = ['CYCL DEF ' + d[0] + '.0 ' + d[1]], sub = 1;
        if (num === 19) { out.push('CYCL DEF 19.1 ' + ['A', 'B', 'C'].map(function (a, i) { return a + fmtQ(v['s' + i] || 0); }).join(' ')); return out.join('\n'); }
        d[3].forEach(function (s, i) {
          var val = v['s' + i];
          if (s[2] === 'axes') { out.push('CYCL DEF ' + d[0] + '.' + (sub++) + ' ' + (String(val || '').toUpperCase().replace(/[^XYZ]/g, '').split('').join(' ') || 'NO ENT')); return; }
          if (s[2] === 'axis') { var t = String(val == null ? s[1] : val).toUpperCase().replace(/\s+/g, ''), inc = /^I/.test(t); out.push('CYCL DEF ' + d[0] + '.' + (sub++) + ' ' + (inc ? 'I' : '') + s[0] + fmtQ(t.replace(/^I?[XYZ]?/, '') || 0)); return; }
          if (num === 4 && s[0] === 'PECKG') { out.push('CYCL DEF 4.' + (sub++) + ' PECKG ' + String(val).replace(/^\+/, '') + ' F' + String(v.p2 || 80).replace(/^\+/, '')); return; }
          if (num === 4 && s[0] === 'F') { out.push('CYCL DEF 4.' + (sub++) + ' F' + String(val).replace(/^\+/, '') + ' ' + (v.dr || 'DR+') + ' RADIUS 0'); return; }
          var n = String(val).replace(/^\+/, '');
          out.push('CYCL DEF ' + d[0] + '.' + (sub++) + ' ' + s[0] + (s[0] === 'F' || s[0] === 'X' || s[0] === 'Y' || s[0] === 'T' ? '' : ' ') + (/^(ROT|DEPTH|PITCH)$/.test(s[0]) ? fmtQ(n) : n));
        });
        return out.join('\n'); } };
  }

  return { PATH: PATH, GROUPS: GROUPS, cycleList: cycleList, cycleSpec: cycleSpec, probeList: probeList, probeSpec: probeSpec };
})();
if (typeof module !== 'undefined') module.exports = TNC_DIALOGS;
