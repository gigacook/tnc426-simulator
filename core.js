/* ==========================================================================
 * TNC 426 Klartext interpreter  --  core.js
 * Plain browser JS (ES2018), no modules, no DOM, no libraries.
 * Exposes a single global: TNC  { parse, compile, run, TOOLS }
 * ========================================================================== */

var TNC = (function () {
  'use strict';

  /* ---------------------------------------------------------------- 1. constants */

  var RAPID_RATE   = 18000;   // mm/min used for FMAX / cycle positioning moves
  var DEFAULT_FEED = 500;     // modal feed before the first F word
  var MAX_MOVES    = 10000;   // runaway guard
  var MAX_DEPTH    = 30;      // subprogram nesting guard
  var EPS          = 1e-9;
  var ARC_TOL      = 0.05;    // mm, radius mismatch tolerance for C / CR

  // Built-in tool table:  t, name, l (length), r (radius)
  var TOOLS = [
    { t: 1,  name: 'SPOT_DRILL_90', l: 72.400,  r: 3.000  },
    { t: 2,  name: 'DRILL_8.5',     l: 118.20,  r: 4.250  },
    { t: 3,  name: 'TAP_M10',       l: 96.000,  r: 5.000  },
    { t: 4,  name: 'ENDMILL_6',     l: 64.100,  r: 3.000  },
    { t: 5,  name: 'ENDMILL_12',    l: 88.750,  r: 6.000  },
    { t: 6,  name: 'FACEMILL_50',   l: 52.300,  r: 25.00  },
    { t: 7,  name: 'BORE_HEAD',     l: 142.00,  r: 16.00  },
    { t: 8,  name: 'CHAMFER_45',    l: 58.900,  r: 5.000  },
    { t: 9,  name: 'ENDMILL_3',     l: 58.000,  r: 1.500  },
    { t: 11, name: 'PROBE_TS640',   l: 155.00,  r: 3.000  },
    { t: 42, name: 'REAMER_H7',     l: 101.30,  r: 5.000  }
  ];

  var IMPLEMENTED_CYCLES = { 4: 1, 200: 1, 201: 1, 203: 1 };

  /* ---------------------------------------------------------------- 2. helpers */

  function words(s) { return s.split(/\s+/).filter(function (w) { return w.length > 0; }); }

  // A programmed value is either a plain number or a reference {q:n, neg:bool}.
  function numOrQ(s) {
    if (s === null || s === undefined) return null;
    s = String(s).trim().replace(/\s+/g, '');
    if (s === '') return null;
    var m = /^([+-])?Q(\d+)$/.exec(s);
    if (m) return { q: parseInt(m[2], 10), neg: m[1] === '-' };
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    var v = parseFloat(s);
    return isNaN(v) ? null : v;
  }

  function resolve(v, Q) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    var x = Q[v.q];
    x = (typeof x === 'number' && isFinite(x)) ? x : 0;
    return v.neg ? -x : x;
  }

  function markParseError(block, msg) {
    block.error = msg;
    Object.defineProperty(block, '__perr',
      { value: msg, enumerable: false, writable: true, configurable: true });
  }

  function toolByNumber(t) {
    for (var i = 0; i < TOOLS.length; i++) if (TOOLS[i].t === t) return TOOLS[i];
    return null;
  }

  /* ---------------------------------------------------------------- 3. parser */

  // Shared word scanner for motion-ish blocks (L, C, CR, CC).
  function scanWords(toks, args) {
    var unknown = [], m;
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (/^R0$/.test(t))            { args.rc = 'R0';  continue; }
      if (/^RL$/.test(t))            { args.rc = 'RL';  continue; }
      if (/^RR$/.test(t))            { args.rc = 'RR';  continue; }
      if (/^F\s*MAX$/.test(t))       { args.fmax = true; continue; }
      if ((m = /^DR([+-])$/.exec(t))) { args.dr = m[1]; continue; }
      if ((m = /^(I)?([XYZ])([+-]?\S+)$/.exec(t))) {
        var v = numOrQ(m[3]);
        if (v !== null) { args[(m[1] ? 'i' : '') + m[2].toLowerCase()] = v; continue; }
        unknown.push(t); continue;
      }
      if ((m = /^M(\d+)$/.exec(t)))  { (args.m = args.m || []).push(parseInt(m[1], 10)); continue; }
      if ((m = /^F(\S+)$/.exec(t)))  {
        var fv = numOrQ(m[1]);
        if (fv !== null) { args.f = fv; continue; }
        unknown.push(t); continue;
      }
      if ((m = /^R(\S+)$/.exec(t)))  {
        var rv = numOrQ(m[1]);
        if (rv !== null) { args.r = rv; continue; }
        unknown.push(t); continue;
      }
      unknown.push(t);
    }
    return unknown;
  }

  function blkAxis(rest, letter) {
    var re = new RegExp('(?:^|\\s)' + letter + '\\s*([+-]?(?:\\d+\\.?\\d*|\\.\\d+)|[+-]?Q\\d+)');
    var m = re.exec(rest);
    return m ? numOrQ(m[1]) : null;
  }

  function parseLine(raw, idx) {
    var block = { n: idx, raw: String(raw).trim(), kind: 'UNKNOWN', args: {}, indent: false, error: null };

    var line = String(raw).replace(/\t/g, ' ').trim();
    line = line.replace(/^\d+\s+/, '');          // the simulator renumbers

    var comment = null, ci = line.indexOf(';');
    if (ci >= 0) { comment = line.slice(ci + 1).trim(); line = line.slice(0, ci).trim(); }

    var U = line.toUpperCase().replace(/\s+/g, ' ').trim();
    if (comment !== null) block.args.comment = comment;

    if (U === '') { block.kind = (comment !== null) ? 'COMMENT' : 'BLANK'; return block; }

    var m, toks, bad;

    /* ---- program head / foot ---- */
    if ((m = /^BEGIN\s+PGM\s+(\S+)\s*(MM|INCH)?$/.exec(U))) {
      block.kind = 'BEGIN'; block.args.name = m[1]; block.args.unit = m[2] || 'MM';
      if (!m[2]) markParseError(block, 'UNIT OF MEASURE MISSING');
      return block;
    }
    if ((m = /^END\s+PGM\s+(\S+)\s*(MM|INCH)?$/.exec(U))) {
      block.kind = 'END'; block.args.name = m[1]; block.args.unit = m[2] || 'MM';
      return block;
    }

    /* ---- blank form (stock) ---- */
    if ((m = /^BLK\s+FORM\s+0\.([12])\s*(.*)$/.exec(U))) {
      var rest = ' ' + m[2].replace(/^Z\b/, ' ');    // drop the tool-axis letter of 0.1
      block.kind = (m[1] === '1') ? 'BLK1' : 'BLK2';
      block.args.x = blkAxis(rest, 'X');
      block.args.y = blkAxis(rest, 'Y');
      block.args.z = blkAxis(rest, 'Z');
      if (block.args.x === null || block.args.y === null || block.args.z === null)
        markParseError(block, 'BLK FORM DEFINITION INCORRECT');
      return block;
    }

    /* ---- tool call ---- */
    if ((m = /^TOOL\s+CALL\s+(.*)$/.exec(U))) {
      block.kind = 'TOOLCALL';
      toks = words(m[1]);
      if (!toks.length) { markParseError(block, 'TOOL NUMBER MISSING'); return block; }
      var tn = numOrQ(toks[0]);
      if (tn === null) { markParseError(block, 'TOOL NUMBER MISSING'); return block; }
      block.args.t = tn;
      block.args.axis = null; block.args.s = null;
      for (var i = 1; i < toks.length; i++) {
        if (/^[XYZ]$/.test(toks[i]))      block.args.axis = toks[i];
        else if (/^S/.test(toks[i]))      block.args.s = numOrQ(toks[i].slice(1));
        else if (/^D[LR]/.test(toks[i]))  { /* oversize, ignored by this simulator */ }
      }
      return block;
    }

    /* ---- cycle definition, old dotted style:  CYCL DEF 4.2 DEPTH -10 ---- */
    if ((m = /^CYCL\s+DEF\s+(\d+)\.(\d+)\s*(.*)$/.exec(U))) {
      var cnum = parseInt(m[1], 10), sub = parseInt(m[2], 10), body = m[3];
      if (sub === 0) {
        block.kind = 'CYCLDEF'; block.args.num = cnum; block.args.name = body.trim();
      } else {
        block.kind = 'CYCLPARM'; block.indent = true;
        block.args.q = sub; block.args.dot = true;
        var nums = body.match(/[+-]?(?:\d+\.?\d*|\.\d+)/g) || [];
        block.args.values = nums.map(function (s) { return parseFloat(s); });
        block.args.value = block.args.values.length ? block.args.values[0] : null;
        var dm = /DR([+-])/.exec(body);
        if (dm) block.args.dr = dm[1];
        if (block.args.comment === undefined)
          block.args.comment = body.replace(/[+-]?(?:\d+\.?\d*|\.\d+)/g, '').trim();
      }
      return block;
    }

    /* ---- cycle definition, Q style ---- */
    if ((m = /^CYCL\s+DEF\s+(\d+)\s*(.*)$/.exec(U))) {
      block.kind = 'CYCLDEF';
      block.args.num = parseInt(m[1], 10);
      block.args.name = (m[2] || '').trim();
      return block;
    }

    /* ---- cycle call ---- */
    if ((m = /^CYCL\s+CALL(?:\s+M(\d+))?$/.exec(U))) {
      block.kind = 'CYCLCALL';
      if (m[1]) block.args.m = [parseInt(m[1], 10)];
      return block;
    }
    if (/^M99$/.test(U)) { block.kind = 'CYCLCALL'; return block; }

    /* ---- labels ---- */
    if ((m = /^CALL\s+LBL\s+(\d+)\s*(?:REP\s*(\d+)(?:\s*\/\s*(\d+))?)?$/.exec(U))) {
      block.kind = 'CALLLBL';
      block.args.lbl = parseInt(m[1], 10);
      block.args.rep = m[2] ? parseInt(m[2], 10) : 1;
      if (block.args.rep < 1) block.args.rep = 1;
      block.args.repProg = !!m[2];   // REP word present => program section repeat
      return block;
    }
    if ((m = /^LBL\s+(\d+)$/.exec(U))) {
      var ln = parseInt(m[1], 10);
      block.kind = (ln === 0) ? 'LBLEND' : 'LBL';
      block.args.lbl = ln;
      return block;
    }

    /* ---- Q parameter arithmetic ---- */
    if ((m = /^FN\s*(\d+)\s*:\s*Q(\d+)\s*=\s*(.*)$/.exec(U))) {
      block.kind = 'FN';
      block.args.fn = parseInt(m[1], 10);
      block.args.target = parseInt(m[2], 10);
      var expr = m[3].trim();
      if (block.args.fn === 0) {
        block.args.a = numOrQ(expr);
        if (block.args.a === null) markParseError(block, 'ARITHMETICAL ERROR');
      } else {
        var em = /^([+-]?(?:Q\d+|\d+\.?\d*|\.\d+))\s*([-+*\/])\s*([+-]?(?:Q\d+|\d+\.?\d*|\.\d+))$/.exec(expr);
        if (em) { block.args.a = numOrQ(em[1]); block.args.b = numOrQ(em[3]); block.args.op = em[2]; }
        else {
          var tk = words(expr);
          if (tk.length >= 3) { block.args.a = numOrQ(tk[0]); block.args.op = tk[1]; block.args.b = numOrQ(tk[2]); }
          else if (tk.length === 2) { block.args.a = numOrQ(tk[0]); block.args.b = numOrQ(tk[1]); }
        }
        if (block.args.a === null || block.args.a === undefined ||
            block.args.b === null || block.args.b === undefined)
          markParseError(block, 'ARITHMETICAL ERROR');
      }
      return block;
    }

    /* ---- stop ---- */
    if (/^STOP(\s|$)/.test(U)) {
      block.kind = 'STOP';
      toks = words(U);
      for (var s = 1; s < toks.length; s++) {
        var mm = /^M(\d+)$/.exec(toks[s]);
        if (mm) (block.args.m = block.args.m || []).push(parseInt(mm[1], 10));
      }
      return block;
    }

    /* ---- circle centre / arcs / lines ---- */
    if ((m = /^CC\s+(.*)$/.exec(U))) {
      block.kind = 'CC';
      bad = scanWords(words(m[1]), block.args);
      if (bad.length) markParseError(block, 'CIRCLE CENTER UNDEFINED');
      return block;
    }
    if ((m = /^CR\s+(.*)$/.exec(U))) {
      block.kind = 'CR';
      bad = scanWords(words(m[1]), block.args);
      if (block.args.r === undefined) markParseError(block, 'CIRCLE RADIUS MISSING');
      else if (bad.length) markParseError(block, 'BLOCK FORMAT INCORRECT');
      return block;
    }
    if ((m = /^C\s+(.*)$/.exec(U))) {
      block.kind = 'C';
      bad = scanWords(words(m[1]), block.args);
      if (bad.length) markParseError(block, 'BLOCK FORMAT INCORRECT');
      return block;
    }
    if ((m = /^L\s+(.*)$/.exec(U))) {
      block.kind = 'L';
      bad = scanWords(words(m[1]), block.args);
      if (bad.length) markParseError(block, 'BLOCK FORMAT INCORRECT');
      return block;
    }

    /* ---- bare M word block (M30, M5 ...) ---- */
    if (/^(M\d+\s*)+$/.test(U)) {
      block.kind = 'L';
      scanWords(words(U), block.args);
      return block;
    }

    /* ---- cycle parameter Qnnn=value ---- */
    if ((m = /^Q(\d+)\s*=\s*(\S+)$/.exec(U))) {
      block.kind = 'CYCLPARM'; block.indent = true;
      block.args.q = parseInt(m[1], 10);
      block.args.value = numOrQ(m[2]);
      if (block.args.value === null) markParseError(block, 'ARITHMETICAL ERROR');
      return block;
    }

    markParseError(block, 'BLOCK FORMAT INCORRECT');
    return block;
  }

  function parse(text) {
    var blocks = [], errors = [];
    var lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/);
    var nc = 0, owner = 0;
    for (var i = 0; i < lines.length; i++) {
      var b = parseLine(lines[i], blocks.length);
      /* HEIDENHAIN numbering: a CYCL DEF and its Q-parameter lines are ONE NC
         block, so parameter lines carry their CYCL DEF's number and do not
         advance the count. Blank lines are not NC blocks and carry none. */
      if (b.kind === 'CYCLPARM') b.n = owner;
      else if (b.kind === 'BLANK') b.n = null;
      else { b.n = nc++; owner = b.n; }
      blocks.push(b);
      // errors always reference the index into blocks[], like compile() does
      if (b.error) errors.push({ block: blocks.length - 1, msg: b.error });
    }
    return { blocks: blocks, errors: errors };
  }

  /* ---------------------------------------------------------------- 4. geometry */

  function dist3(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Signed sweep for an arc from p1 to p2 around (cx,cy) in the given direction.
  function sweepAngle(p1, p2, cx, cy, ccw) {
    var a1 = Math.atan2(p1.y - cy, p1.x - cx);
    var a2 = Math.atan2(p2.y - cy, p2.x - cx);
    var d = a2 - a1;
    if (ccw) { while (d <= EPS) d += 2 * Math.PI; }
    else     { while (d >= -EPS) d -= 2 * Math.PI; }
    return d;
  }

  function arcLength(p1, p2, cx, cy, ccw) {
    var r = Math.sqrt((p1.x - cx) * (p1.x - cx) + (p1.y - cy) * (p1.y - cy));
    var sw = Math.abs(sweepAngle(p1, p2, cx, cy, ccw));
    var dz = p2.z - p1.z;
    return Math.sqrt((r * sw) * (r * sw) + dz * dz);
  }

  /* ---------------------------------------------------------------- 5. machine state */

  function newState(blocks) {
    return {
      blocks: blocks,
      pos: { x: 0, y: 0, z: 0 },
      feed: DEFAULT_FEED,
      tool: { t: 0, name: '', r: 3, l: 0 },
      spindle: 0,          // effective: sRpm * spinDir
      sRpm: 0, spinDir: 0,
      coolant: false,
      cc: null,
      Q: {},
      cycle: null,
      moves: [],
      errors: [],
      stock: { x0: 0, y0: 0, z0: 0, x1: 0, y1: 0, z1: 0 },
      abort: false,
      done: false,
      toolOrder: [],
      toolStat: {}
    };
  }

  function fail(st, bi, msg) {
    for (var i = 0; i < st.errors.length; i++)
      if (st.errors[i].block === bi && st.errors[i].msg === msg) return;
    st.errors.push({ block: bi, msg: msg });
    if (st.blocks[bi] && !st.blocks[bi].error) st.blocks[bi].error = msg;
  }

  function emit(st, kind, to, feed, bi, cycleName, arc) {
    if (st.abort) return;
    var from = { x: st.pos.x, y: st.pos.y, z: st.pos.z };
    var len = (kind === 'arc') ? arcLength(from, to, arc.cx, arc.cy, arc.ccw) : dist3(from, to);
    if (!(len > EPS)) { st.pos = { x: to.x, y: to.y, z: to.z }; return; }
    st.moves.push({
      kind: kind,
      from: from,
      to: { x: to.x, y: to.y, z: to.z },
      cx: arc ? arc.cx : null,
      cy: arc ? arc.cy : null,
      ccw: arc ? !!arc.ccw : false,
      feed: (kind === 'rapid') ? RAPID_RATE : feed,
      tool: st.tool.t,
      toolR: st.tool.r,
      toolName: st.tool.name,
      spindle: st.spindle,
      coolant: st.coolant,
      block: bi,
      cycle: cycleName || null,
      len: len
    });
    st.pos = { x: to.x, y: to.y, z: to.z };
    if (st.moves.length >= MAX_MOVES) { st.abort = true; fail(st, bi, 'EXCESSIVE SUBPROGRAM NESTING'); }
  }

  /* M-functions take effect either at block start (M3 M4 M8 M13 M14) or at
     block end (M5 M9 M2 M30), as on the TNC. `phase` is 'start' or 'end'. */
  function applyM(st, list, phase) {
    if (list) for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (phase === 'start') {
        if (m === 3 || m === 13) st.spinDir = 1;
        else if (m === 4 || m === 14) st.spinDir = -1;
        if (m === 8 || m === 13 || m === 14) st.coolant = true;
      } else {
        if (m === 5 || m === 2 || m === 30) st.spinDir = 0;
        if (m === 9 || m === 2 || m === 30) st.coolant = false;
      }
    }
    st.spindle = st.sRpm * st.spinDir;
  }

  function hasM99(list) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (list[i] === 99) return true;
    return false;
  }

  function hasEndM(list) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) if (list[i] === 2 || list[i] === 30) return true;
    return false;
  }

  /* ---------------------------------------------------------------- 6. cycles */

  // Collect the parameter lines that belong to a CYCL DEF block.
  function gatherCycle(st, defIdx) {
    var b = st.blocks[defIdx];
    var cy = { num: b.args.num, name: b.args.name || '', params: {}, order: [],
               subs: {}, dot: false, dr: '+', block: defIdx };
    for (var j = defIdx + 1; j < st.blocks.length; j++) {
      var p = st.blocks[j];
      if (!p) break;
      if (p.kind === 'BLANK' || p.kind === 'COMMENT') continue;
      if (p.kind !== 'CYCLPARM') break;
      if (p.args.dot) {
        cy.dot = true;
        cy.subs[p.args.q] = (p.args.values || []).slice();
        if (p.args.dr) cy.dr = p.args.dr;
        if (p.args.values && p.args.values.length) cy.order.push(p.args.values[0]);
      } else {
        var v = resolve(p.args.value, st.Q);
        cy.params[p.args.q] = v;
        cy.order.push(v);
      }
    }
    cy.label = (cy.name ? cy.name + ' ' : '') + cy.num;
    return cy;
  }

  function qp(cy, n, dflt) {
    var v = cy.params[n];
    return (typeof v === 'number' && isFinite(v)) ? v : dflt;
  }

  function sub(cy, s, i, dflt) {
    var a = cy.subs[s];
    return (a && typeof a[i] === 'number' && isFinite(a[i])) ? a[i] : dflt;
  }

  /* --- CYCL DEF 200 DRILLING / 203 UNIVERSAL DRILLING (shared peck engine) --- */
  function cycleDrill(st, cy, bi, universal) {
    var clr   = qp(cy, 200, 2);
    var dep   = -Math.abs(qp(cy, 201, 0));
    var fpl   = qp(cy, 206, st.feed) || st.feed;
    var peck  = Math.abs(qp(cy, 202, 0));
    var dwT   = qp(cy, 210, 0);
    var surf  = qp(cy, 203, 0);
    var clr2  = qp(cy, 204, clr);
    var decr  = universal ? Math.abs(qp(cy, 212, 0)) : 0;
    var brks  = universal ? Math.max(0, Math.round(qp(cy, 213, 0))) : 0;
    var minp  = universal ? Math.abs(qp(cy, 205, 0)) : 0;
    var fret  = universal ? (qp(cy, 208, RAPID_RATE) || RAPID_RATE) : RAPID_RATE;
    var chipD = universal ? Math.abs(qp(cy, 256, 0.2)) : 0.2;

    var total = Math.abs(dep);
    var safe  = surf + clr;
    var x = st.pos.x, y = st.pos.y;
    var lab = cy.label;

    if (total <= EPS) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    if (fpl <= 0) { fail(st, bi, 'FEED RATE MISSING'); return; }

    emit(st, 'rapid', { x: x, y: y, z: safe }, RAPID_RATE, bi, lab);

    var step = (peck > EPS) ? peck : total;
    if (universal && minp > EPS && step < minp) step = minp;
    var d = 0, guard = 0, breaksLeft = brks;

    while (d < total - 1e-6 && guard++ < 2000 && !st.abort) {
      d = Math.min(d + step, total);
      var zt = surf - d;
      emit(st, 'feed', { x: x, y: y, z: zt }, fpl, bi, lab);

      if (d >= total - 1e-6) break;

      if (universal && breaksLeft > 0) {          // chip breaking: short retract in place
        breaksLeft--;
        emit(st, 'rapid', { x: x, y: y, z: zt + chipD }, RAPID_RATE, bi, lab);
      }
      // full retract to set-up clearance, then rapid back to just above last depth
      if (universal) emit(st, 'feed', { x: x, y: y, z: safe }, fret, bi, lab);
      else           emit(st, 'rapid', { x: x, y: y, z: safe }, RAPID_RATE, bi, lab);
      emit(st, 'rapid', { x: x, y: y, z: zt + 0.2 }, RAPID_RATE, bi, lab);

      if (universal && decr > EPS) step = Math.max(step - decr, minp > EPS ? minp : decr);
      if (step <= EPS) step = total;
    }

    if (universal) emit(st, 'feed', { x: x, y: y, z: safe }, fret, bi, lab);
    emit(st, 'rapid', { x: x, y: y, z: surf + clr2 }, RAPID_RATE, bi, lab);
  }

  /* --- CYCL DEF 201 REAMING --- */
  function cycleReam(st, cy, bi) {
    var clr  = qp(cy, 200, 2);
    var dep  = -Math.abs(qp(cy, 201, 0));
    var fpl  = qp(cy, 206, st.feed) || st.feed;
    var fret = qp(cy, 208, RAPID_RATE) || RAPID_RATE;
    var surf = qp(cy, 203, 0);
    var clr2 = qp(cy, 204, clr);
    var x = st.pos.x, y = st.pos.y, lab = cy.label;

    if (Math.abs(dep) <= EPS) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    if (fpl <= 0) { fail(st, bi, 'FEED RATE MISSING'); return; }

    emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
    emit(st, 'feed',  { x: x, y: y, z: surf + dep }, fpl, bi, lab);
    emit(st, 'feed',  { x: x, y: y, z: surf + clr }, fret, bi, lab);
    emit(st, 'rapid', { x: x, y: y, z: surf + clr2 }, RAPID_RATE, bi, lab);
  }

  /* --- CYCL DEF 4 POCKET MILLING (spiral-out rectangular clearing) --- */
  function cyclePocket(st, cy, bi) {
    var clr, dep, peck, fpl, sx, sy, feed;
    if (cy.dot) {
      clr  = sub(cy, 1, 0, 2);
      dep  = sub(cy, 2, 0, 0);
      peck = sub(cy, 3, 0, 0);
      fpl  = sub(cy, 3, 1, st.feed);
      sx   = sub(cy, 4, 0, 0);
      sy   = sub(cy, 5, 0, 0);
      feed = sub(cy, 6, 0, st.feed);
    } else {
      var o = cy.order;
      clr  = (typeof o[0] === 'number') ? o[0] : qp(cy, 200, 2);
      dep  = (typeof o[1] === 'number') ? o[1] : qp(cy, 201, 0);
      peck = (typeof o[2] === 'number') ? o[2] : qp(cy, 202, 0);
      fpl  = (typeof o[3] === 'number') ? o[3] : qp(cy, 206, st.feed);
      sx   = (typeof o[4] === 'number') ? o[4] : 0;
      sy   = (typeof o[5] === 'number') ? o[5] : 0;
      feed = (typeof o[6] === 'number') ? o[6] : st.feed;
    }
    clr = Math.abs(clr);
    dep = -Math.abs(dep);
    sx = Math.abs(sx); sy = Math.abs(sy);
    peck = Math.abs(peck);
    if (!(fpl > 0)) fpl = st.feed;
    if (!(feed > 0)) feed = st.feed;

    var lab = cy.label;
    if (sx <= EPS || sy <= EPS || Math.abs(dep) <= EPS) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }

    var R = st.tool.r;
    var hx = sx / 2 - R, hy = sy / 2 - R;
    if (hx < -EPS || hy < -EPS) { fail(st, bi, 'TOOL TOO LARGE'); return; }
    hx = Math.max(hx, 0); hy = Math.max(hy, 0);

    var cxp = st.pos.x, cyp = st.pos.y;
    var surf = st.pos.z - clr;                 // tool sits at set-up clearance above the surface
    var bottom = surf + dep;
    var stepOver = 0.7 * R; if (!(stepOver > EPS)) stepOver = 1;

    // concentric rectangles, built outside-in then reversed => spiral out
    var rects = [], rx = hx, ry = hy, g = 0;
    while (g++ < 500) {
      rects.push([rx, ry]);
      if (rx <= EPS && ry <= EPS) break;
      var nrx = Math.max(rx - stepOver, 0), nry = Math.max(ry - stepOver, 0);
      if (nrx === rx && nry === ry) break;
      rx = nrx; ry = nry;
    }
    rects.reverse();

    var ccw = cy.dr !== '-';
    var levels = [], zc = surf, gp = 0;
    var dz = (peck > EPS) ? peck : Math.abs(dep);
    while (gp++ < 1000) { zc = Math.max(zc - dz, bottom); levels.push(zc); if (zc <= bottom + 1e-6) break; }

    emit(st, 'rapid', { x: cxp, y: cyp, z: surf + clr }, RAPID_RATE, bi, lab);

    for (var li = 0; li < levels.length && !st.abort; li++) {
      var z = levels[li];
      emit(st, 'rapid', { x: cxp, y: cyp, z: (li === 0 ? surf : levels[li - 1]) + 0.2 }, RAPID_RATE, bi, lab);
      emit(st, 'feed', { x: cxp, y: cyp, z: z }, fpl, bi, lab);
      for (var ri = 0; ri < rects.length; ri++) {
        var ax = rects[ri][0], ay = rects[ri][1];
        var corners = ccw
          ? [[-ax, -ay], [ax, -ay], [ax, ay], [-ax, ay], [-ax, -ay]]
          : [[-ax, -ay], [-ax, ay], [ax, ay], [ax, -ay], [-ax, -ay]];
        for (var ki = 0; ki < corners.length; ki++)
          emit(st, 'feed', { x: cxp + corners[ki][0], y: cyp + corners[ki][1], z: z }, feed, bi, lab);
      }
      emit(st, 'rapid', { x: cxp, y: cyp, z: z }, RAPID_RATE, bi, lab);
    }
    emit(st, 'rapid', { x: cxp, y: cyp, z: surf + clr }, RAPID_RATE, bi, lab);
  }

  function runCycle(st, bi) {
    var cy = st.cycle;
    if (!cy) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    if (!IMPLEMENTED_CYCLES[cy.num]) return;     // error already reported at CYCL DEF
    if (cy.num === 200) cycleDrill(st, cy, bi, false);
    else if (cy.num === 203) cycleDrill(st, cy, bi, true);
    else if (cy.num === 201) cycleReam(st, cy, bi);
    else if (cy.num === 4)   cyclePocket(st, cy, bi);
  }

  /* ---------------------------------------------------------------- 7. execution */

  function targetOf(args, st) {
    var p = { x: st.pos.x, y: st.pos.y, z: st.pos.z };
    var ax = ['x', 'y', 'z'], v;
    for (var i = 0; i < 3; i++) {
      var k = ax[i];
      if (args[k] !== undefined)        { v = resolve(args[k], st.Q); if (v !== null) p[k] = v; }
      if (args['i' + k] !== undefined)  { v = resolve(args['i' + k], st.Q); if (v !== null) p[k] += v; }
    }
    return p;
  }

  function doLine(st, b, bi) {
    var a = b.args;
    applyM(st, a.m, 'start');
    if (a.f !== undefined) {
      var fv = resolve(a.f, st.Q);
      if (fv === null || fv <= 0) fail(st, bi, 'FEED RATE MISSING');
      else st.feed = fv;
    }
    var moves = (a.x !== undefined || a.y !== undefined || a.z !== undefined ||
                 a.ix !== undefined || a.iy !== undefined || a.iz !== undefined);
    if (moves) {
      var to = targetOf(a, st);
      if (a.fmax) emit(st, 'rapid', to, RAPID_RATE, bi, null);
      else {
        if (!(st.feed > 0)) { fail(st, bi, 'FEED RATE MISSING'); return; }
        emit(st, 'feed', to, st.feed, bi, null);
      }
    }
    applyM(st, a.m, 'end');
  }

  function doCC(st, b) {
    var a = b.args, cx = st.cc ? st.cc.x : st.pos.x, cy = st.cc ? st.cc.y : st.pos.y, v;
    cx = st.pos.x; cy = st.pos.y;
    if (a.x !== undefined)  { v = resolve(a.x, st.Q);  if (v !== null) cx = v; }
    if (a.y !== undefined)  { v = resolve(a.y, st.Q);  if (v !== null) cy = v; }
    if (a.ix !== undefined) { v = resolve(a.ix, st.Q); if (v !== null) cx = st.pos.x + v; }
    if (a.iy !== undefined) { v = resolve(a.iy, st.Q); if (v !== null) cy = st.pos.y + v; }
    st.cc = { x: cx, y: cy };
  }

  function doArcC(st, b, bi) {
    var a = b.args;
    applyM(st, a.m, 'start');
    if (a.f !== undefined) { var fv = resolve(a.f, st.Q); if (fv > 0) st.feed = fv; }
    if (!st.cc) { fail(st, bi, 'CIRCLE CENTER UNDEFINED'); return; }
    var to = targetOf(a, st);
    var from = st.pos;
    var r1 = Math.sqrt(Math.pow(from.x - st.cc.x, 2) + Math.pow(from.y - st.cc.y, 2));
    var r2 = Math.sqrt(Math.pow(to.x - st.cc.x, 2) + Math.pow(to.y - st.cc.y, 2));
    if (r1 < EPS || Math.abs(r1 - r2) > ARC_TOL) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
    if (!(st.feed > 0)) { fail(st, bi, 'FEED RATE MISSING'); return; }
    emit(st, 'arc', to, st.feed, bi, null, { cx: st.cc.x, cy: st.cc.y, ccw: a.dr !== '-' });
    applyM(st, a.m, 'end');
  }

  function doArcCR(st, b, bi) {
    var a = b.args;
    applyM(st, a.m, 'start');
    if (a.f !== undefined) { var fv = resolve(a.f, st.Q); if (fv > 0) st.feed = fv; }
    var R = resolve(a.r, st.Q);
    if (R === null || Math.abs(R) < EPS) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
    var to = targetOf(a, st), from = st.pos;
    var dx = to.x - from.x, dy = to.y - from.y;
    var L = Math.sqrt(dx * dx + dy * dy);
    if (L < EPS) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
    var h2 = R * R - L * L / 4;
    if (h2 < -ARC_TOL) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
    var h = Math.sqrt(Math.max(h2, 0));
    var mx = (from.x + to.x) / 2, my = (from.y + to.y) / 2;
    var ux = dx / L, uy = dy / L;
    var cands = [{ x: mx - h * uy, y: my + h * ux }, { x: mx + h * uy, y: my - h * ux }];
    var ccw = a.dr !== '-';
    var wantLong = R < 0, pick = null;
    for (var i = 0; i < 2; i++) {
      var sw = Math.abs(sweepAngle(from, to, cands[i].x, cands[i].y, ccw));
      if (wantLong ? (sw > Math.PI - 1e-6) : (sw <= Math.PI + 1e-6)) { pick = cands[i]; break; }
    }
    if (!pick) pick = cands[0];
    if (!(st.feed > 0)) { fail(st, bi, 'FEED RATE MISSING'); return; }
    st.cc = { x: pick.x, y: pick.y };
    emit(st, 'arc', to, st.feed, bi, null, { cx: pick.x, cy: pick.y, ccw: ccw });
    applyM(st, a.m, 'end');
  }

  function doToolCall(st, b, bi) {
    var t = resolve(b.args.t, st.Q);
    t = (t === null) ? 0 : Math.round(t);
    if (!b.args.axis) fail(st, bi, 'TOOL AXIS MISSING');
    /* The tool change stops the spindle (as on practically every machine);
       S only sets the programmed speed. M3/M4 is needed to start it again. */
    if (st.tool.t !== t) st.spinDir = 0;
    if (b.args.s !== null && b.args.s !== undefined) {
      var s = resolve(b.args.s, st.Q);
      if (s !== null) st.sRpm = Math.abs(s);
    }
    st.spindle = st.sRpm * st.spinDir;
    if (t === 0) { st.tool = { t: 0, name: '', r: 3, l: 0 }; return; }
    var e = toolByNumber(t);
    if (!e) { fail(st, bi, 'TOOL ' + t + ' NOT DEFINED'); st.tool = { t: t, name: 'UNDEFINED', r: 3, l: 0 }; }
    else st.tool = { t: e.t, name: e.name, r: e.r, l: e.l };
    if (!st.toolStat[st.tool.t]) {
      st.toolStat[st.tool.t] = { t: st.tool.t, name: st.tool.name, r: st.tool.r, l: st.tool.l, moves: 0, time: 0 };
      st.toolOrder.push(st.tool.t);
    }
  }

  function doFN(st, b, bi) {
    var a = b.args, A = resolve(a.a, st.Q), B = resolve(a.b, st.Q), r;
    if (a.fn === 0) { st.Q[a.target] = (A === null ? 0 : A); return; }
    if (A === null || B === null) { fail(st, bi, 'ARITHMETICAL ERROR'); return; }
    if (a.fn === 1) r = A + B;
    else if (a.fn === 2) r = A - B;
    else if (a.fn === 3) r = A * B;
    else if (a.fn === 4) {
      if (Math.abs(B) < EPS) { fail(st, bi, 'DIVISION BY ZERO'); return; }
      r = A / B;
    } else { fail(st, bi, 'ARITHMETICAL ERROR'); return; }
    st.Q[a.target] = r;
  }

  function execRange(st, from, to, depth) {
    if (depth > MAX_DEPTH) { st.abort = true; fail(st, from, 'EXCESSIVE SUBPROGRAM NESTING'); return; }
    for (var i = from; i <= to && !st.abort && !st.done; i++) {
      var b = st.blocks[i];
      if (!b) continue;
      if (b.kind === 'BLANK' || b.kind === 'COMMENT') continue;
      if (b.error) continue;                        // bad block: report once, carry on

      switch (b.kind) {
        case 'BEGIN': break;
        case 'END': return;
        case 'BLK1':
          st.stock.x0 = resolve(b.args.x, st.Q) || 0;
          st.stock.y0 = resolve(b.args.y, st.Q) || 0;
          st.stock.z0 = resolve(b.args.z, st.Q) || 0;
          break;
        case 'BLK2':
          st.stock.x1 = resolve(b.args.x, st.Q) || 0;
          st.stock.y1 = resolve(b.args.y, st.Q) || 0;
          st.stock.z1 = resolve(b.args.z, st.Q) || 0;
          break;
        case 'TOOLCALL': doToolCall(st, b, i); break;
        case 'L':
          doLine(st, b, i);
          if (hasM99(b.args.m)) runCycle(st, i);   // M99: call cycle here, blockwise
          if (hasEndM(b.args.m)) { st.done = true; return; }
          break;
        case 'CC': doCC(st, b); break;
        case 'C':  doArcC(st, b, i);
          if (hasM99(b.args.m)) runCycle(st, i);
          if (hasEndM(b.args.m)) { st.done = true; return; } break;
        case 'CR': doArcCR(st, b, i);
          if (hasM99(b.args.m)) runCycle(st, i);
          if (hasEndM(b.args.m)) { st.done = true; return; } break;
        case 'CYCLDEF':
          st.cycle = gatherCycle(st, i);
          if (!IMPLEMENTED_CYCLES[st.cycle.num])
            fail(st, i, 'CYCLE ' + st.cycle.num + ' NOT IMPLEMENTED IN SIMULATOR');
          break;
        case 'CYCLPARM': break;                    // consumed by the CYCL DEF above
        case 'CYCLCALL':
          applyM(st, b.args.m, 'start');
          runCycle(st, i);
          applyM(st, b.args.m, 'end');
          break;
        case 'LBL': break;
        case 'LBLEND': if (depth > 0) return; break;
        case 'CALLLBL': {
          var target = st.labels[b.args.lbl];
          if (target === undefined) { fail(st, i, 'LABEL NUMBER NOT FOUND'); break; }
          var rep = b.args.rep || 1;
          if (b.args.repProg && target < i) {
            /* Program-section repeat: LBL n ... CALL LBL n REP r/r
               The section is bounded by the CALL block itself, not by LBL 0.
               It has already run once inline, so repeat it `rep` more times
               (HEIDENHAIN: total passes = REP + 1). */
            for (var k = 0; k < rep && !st.abort && !st.done; k++)
              execRange(st, target + 1, i - 1, depth + 1);
          } else {
            /* Subprogram call: run from the label to its LBL 0 terminator. */
            var end = st.blocks.length - 1;
            for (var j = target + 1; j < st.blocks.length; j++)
              if (st.blocks[j].kind === 'LBLEND') { end = j; break; }
            var n = b.args.rep || 1;
            for (var k2 = 0; k2 < n && !st.abort && !st.done; k2++)
              execRange(st, target + 1, end, depth + 1);
          }
          break;
        }
        case 'FN': doFN(st, b, i); break;
        case 'STOP':
          applyM(st, b.args.m, 'start');
          applyM(st, b.args.m, 'end');
          if (hasEndM(b.args.m)) { st.done = true; return; }
          break;
        default: break;
      }
    }
  }

  /* ---------------------------------------------------------------- 8. compile */

  function compile(blocks) {
    blocks = blocks || [];
    var i;
    // reset any state a previous compile() left on the blocks
    for (i = 0; i < blocks.length; i++) {
      if (!blocks[i]) continue;
      blocks[i].error = Object.prototype.hasOwnProperty.call(blocks[i], '__perr') ? blocks[i].__perr : null;
    }

    var st = newState(blocks);

    // label table
    st.labels = {};
    for (i = 0; i < blocks.length; i++)
      if (blocks[i] && blocks[i].kind === 'LBL' && st.labels[blocks[i].args.lbl] === undefined)
        st.labels[blocks[i].args.lbl] = i;

    execRange(st, 0, blocks.length - 1, 0);

    // Program head check. Done after the run so that flagging the offending
    // block does not stop that block from being executed.
    var first = -1;
    for (i = 0; i < blocks.length; i++) {
      if (!blocks[i]) continue;
      if (blocks[i].kind === 'BLANK' || blocks[i].kind === 'COMMENT') continue;
      first = i; break;
    }
    if (first < 0 || blocks[first].kind !== 'BEGIN')
      fail(st, first < 0 ? 0 : first, 'PROGRAM START UNDEFINED');

    /* ---- statistics ---- */
    var stock = st.stock;
    var stockTop = Math.max(stock.z0, stock.z1);
    var pathFeed = 0, pathRapid = 0, cycleTime = 0, removed = 0;
    var minZ = Infinity, maxZ = -Infinity;

    for (i = 0; i < st.moves.length; i++) {
      var mv = st.moves[i];
      var f = (mv.kind === 'rapid') ? RAPID_RATE : mv.feed;
      var t = (f > 0) ? (mv.len / f) * 60 : 0;
      cycleTime += t;
      if (mv.kind === 'rapid') pathRapid += mv.len; else pathFeed += mv.len;
      minZ = Math.min(minZ, mv.from.z, mv.to.z);
      maxZ = Math.max(maxZ, mv.from.z, mv.to.z);
      if (mv.kind !== 'rapid') {
        var depth = stockTop - (mv.from.z + mv.to.z) / 2;
        if (depth > 0) removed += 2 * mv.toolR * depth * mv.len;
      }
      var ts = st.toolStat[mv.tool];
      if (!ts) {
        ts = { t: mv.tool, name: mv.toolName, r: mv.toolR, l: 0, moves: 0, time: 0 };
        st.toolStat[mv.tool] = ts; st.toolOrder.push(mv.tool);
      }
      ts.moves++; ts.time += t;
    }
    if (!isFinite(minZ)) { minZ = 0; maxZ = 0; }

    var toolsUsed = [];
    for (i = 0; i < st.toolOrder.length; i++) {
      var ent = st.toolStat[st.toolOrder[i]];
      if (ent && ent.t !== 0) toolsUsed.push(ent);
    }

    return {
      moves: st.moves,
      stock: stock,
      stats: {
        blockCount: blocks.length,
        moveCount: st.moves.length,
        rapidRate: RAPID_RATE,
        pathFeed: pathFeed,
        pathRapid: pathRapid,
        pathTotal: pathFeed + pathRapid,
        cycleTime: cycleTime,
        minZ: minZ,
        maxZ: maxZ,
        toolsUsed: toolsUsed,
        removedVolume: removed
      },
      errors: st.errors
    };
  }

  function run(text) {
    var p = parse(text);
    var c = compile(p.blocks);
    return {
      blocks: p.blocks,
      moves: c.moves,
      stock: c.stock,
      stats: c.stats,
      errors: p.errors.concat(c.errors)
    };
  }

  return { parse: parse, compile: compile, run: run, TOOLS: TOOLS };
})();

if (typeof module !== 'undefined') module.exports = TNC;
