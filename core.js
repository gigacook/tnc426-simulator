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
  var MAX_MOVES    = 400000;  // runaway guard (real CAM programs run to 10^5 moves)
  var MAX_DEPTH    = 30;      // subprogram nesting guard
  var MAX_STEPS    = 2000000; // blocks executed, guards FN 9-12 loops
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

  var IMPLEMENTED_CYCLES = { 1: 1, 2: 1, 4: 1, 17: 1, 18: 1, 200: 1, 201: 1, 202: 1, 203: 1, 204: 1, 205: 1, 206: 1, 207: 1, 208: 1, 209: 1, 210: 1, 211: 1, 212: 1, 213: 1, 214: 1, 215: 1, 230: 1, 231: 1 };
  var PATTERN_CYCLES = { 220: 1, 221: 1 };
  // definition-only cycles with no tool motion in this simulator (9 dwell, 32 tolerance)
  var NOMOTION_CYCLES = { 7: 1, 8: 1, 9: 1, 10: 1, 11: 1, 19: 1, 32: 1, 247: 1 };

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

  function lblKey(s) { s = String(s).replace(/"/g, ''); return /^\d+$/.test(s) ? parseInt(s, 10) : s; }

  function resolve(v, Q) {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    var x = Q[v.q];
    x = (typeof x === 'number' && isFinite(x)) ? x : 0;
    return v.neg ? -x : x;
  }

  /* Q-parameter formulas (manual 10.9 "Entering formulas directly") and FN 0-8/13 right-hand
     sides. Precedence: + -  <  * / DIV LEN ANG  <  ^  <  unary signs and functions.
     Angles in degrees. Returns an AST, or null on a syntax error. */
  var FUNCS = { SQ: 1, SQRT: 1, SIN: 1, COS: 1, TAN: 1, ASIN: 1, ACOS: 1, ATAN: 1, LN: 1, LOG: 1, EXP: 1, NEG: 1, INT: 1, ABS: 1, FRAC: 1, SGN: 1 };
  function compileExpr(src) {
    var toks = [], re = /\s*(\d+\.?\d*|\.\d+|Q[LR]?\d+|[A-Z]+|[-+*\/^()])/y, m, pos = 0;
    src = String(src).toUpperCase().trim();
    while (pos < src.length) {
      re.lastIndex = pos; m = re.exec(src);
      if (!m) { if (/^\s*$/.test(src.slice(pos))) break; return null; }
      toks.push(m[1]); pos = re.lastIndex;
    }
    var i = 0;
    function peek() { return toks[i]; }
    function expr() {
      var a = term(); if (!a) return null;
      while (peek() === '+' || peek() === '-') { var op = toks[i++], b = term(); if (!b) return null; a = ['b', op, a, b]; }
      return a;
    }
    function term() {
      var a = pow(); if (!a) return null;
      while (peek() === '*' || peek() === '/' || peek() === 'DIV' || peek() === 'LEN' || peek() === 'ANG') {
        var op = toks[i++]; if (op === 'DIV') op = '/'; var b = pow(); if (!b) return null; a = ['b', op, a, b];
      }
      return a;
    }
    function pow() { var a = unary(); if (!a) return null; if (peek() === '^') { i++; var b = pow(); if (!b) return null; return ['b', '^', a, b]; } return a; }
    function unary() {
      var t = peek();
      if (t === '+') { i++; return unary(); }
      if (t === '-') { i++; var u = unary(); return u ? ['u', u] : null; }
      if (FUNCS[t]) { i++; var x = unary(); return x ? ['f', t, x] : null; }
      return prim();
    }
    function prim() {
      var t = toks[i++];
      if (t === undefined) return null;
      if (t === '(') { var e = expr(); if (toks[i++] !== ')') return null; return e; }
      if (t === 'PI') return ['n', Math.PI];
      if (/^Q\d+$/.test(t)) return ['q', parseInt(t.slice(1), 10)];
      if (/^(\d|\.)/.test(t)) return ['n', parseFloat(t)];
      return null;
    }
    var ast = expr();
    return (ast && i === toks.length) ? ast : null;
  }
  var D2R = Math.PI / 180;
  function evalExpr(n, Q, err) {
    switch (n[0]) {
      case 'n': return n[1];
      case 'q': { var v = Q[n[1]]; return (typeof v === 'number' && isFinite(v)) ? v : 0; }
      case 'u': return -evalExpr(n[1], Q, err);
      case 'f': {
        var x = evalExpr(n[2], Q, err);
        switch (n[1]) {
          case 'SQ': return x * x;
          case 'SQRT': if (x < 0) { err('SQUARE ROOT OF NEGATIVE NUMBER'); return 0; } return Math.sqrt(x);
          case 'SIN': return Math.sin(x * D2R); case 'COS': return Math.cos(x * D2R); case 'TAN': return Math.tan(x * D2R);
          case 'ASIN': if (Math.abs(x) > 1) { err('ARITHMETICAL ERROR'); return 0; } return Math.asin(x) / D2R;
          case 'ACOS': if (Math.abs(x) > 1) { err('ARITHMETICAL ERROR'); return 0; } return Math.acos(x) / D2R;
          case 'ATAN': return Math.atan(x) / D2R;
          case 'LN': if (x <= 0) { err('ARITHMETICAL ERROR'); return 0; } return Math.log(x);
          case 'LOG': if (x <= 0) { err('ARITHMETICAL ERROR'); return 0; } return Math.log(x) / Math.LN10;
          case 'EXP': return Math.exp(x); case 'NEG': return -x; case 'ABS': return Math.abs(x);
          case 'INT': return x < 0 ? Math.ceil(x) : Math.floor(x); case 'FRAC': return x - (x < 0 ? Math.ceil(x) : Math.floor(x));
          case 'SGN': return x > 0 ? 1 : (x < 0 ? -1 : 0);
        }
        return 0;
      }
      case 'b': {
        var a = evalExpr(n[2], Q, err), b = evalExpr(n[3], Q, err);
        switch (n[1]) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b;
          case '/': if (Math.abs(b) < EPS) { err('DIVISION BY ZERO'); return 0; } return a / b;
          case '^': return Math.pow(a, b);
          case 'LEN': return Math.sqrt(a * a + b * b);                              // FN 8
          case 'ANG': { var g = Math.atan2(b, a) / D2R; return g < 0 ? g + 360 : g; }  // FN 13
        }
      }
    }
    return 0;
  }

  function markParseError(block, msg) {
    block.error = msg;
    Object.defineProperty(block, '__perr',
      { value: msg, enumerable: false, writable: true, configurable: true });
  }

  function toolByNumber(t, table) {
    table = table || TOOLS;
    for (var i = 0; i < table.length; i++) if (table[i].t === t) return table[i];
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
      if (/^F\s*AUTO$/.test(t))      { args.fauto = true; continue; }     // feed from the TOOL CALL block
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
      if ((m = /^(I)?P([RA])(\S+)$/.exec(t))) {             // polar: PR PA IPR IPA
        var pv = numOrQ(m[3]);
        if (pv !== null) { args[(m[1] ? 'ip' : 'p') + m[2].toLowerCase()] = pv; continue; }
        unknown.push(t); continue;
      }
      if ((m = /^(LEN|CCA)(\S+)$/.exec(t))) {
        var lv = numOrQ(m[2]);
        if (lv !== null) { args[m[1].toLowerCase()] = lv; continue; }
        unknown.push(t); continue;
      }
      if ((m = /^(I)?([ABC])([+-]?(?:\d+\.?\d*|\.\d+|Q\d+))$/.exec(t))) {   // rotary axes (TNC 430)
        args[(m[1] ? 'i' : '') + 'ax' + m[2].toLowerCase()] = numOrQ(m[3]); continue;   // axa axb axc (not rc: that is RL/RR)
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
    var block = { n: idx, raw: String(raw).trim().replace(/^\d+\s+(?=[A-Z;*])/i, ''), kind: 'UNKNOWN', args: {}, indent: false, error: null };   // a listing's own numbers are not kept

    var line = String(raw).replace(/\t/g, ' ').trim();
    line = line.replace(/^\d+\s+/, '');          // the simulator renumbers

    var comment = null, ci = line.indexOf(';');
    if (ci >= 0) { comment = line.slice(ci + 1).trim(); line = line.slice(0, ci).trim(); }

    var U = line.replace(/[\u2013\u2212]/g, '-').replace(/(\d),(\d)/g, '$1.$2').toUpperCase().replace(/\s+/g, ' ').trim();   // decimal comma
    U = U.replace(/\s*~$/, '')                                   // iTNC-style line continuation mark
         .replace(/\bF (MAX|AUTO)\b/g, 'F$1')                    // "F MAX" as printed in the manual
         .replace(/\b(LEN|CCA|IPR|IPA|PR|PA) (?=[+-]?(\d|\.|Q))/g, '$1');   // "CCA 180", "LEN 15"
    if (comment !== null) block.args.comment = comment;

    if (U === '') { block.kind = (comment !== null) ? 'COMMENT' : 'BLANK'; return block; }

    /* ---- structure block:  * - text ---- */
    if (/^\*/.test(U)) { block.kind = 'COMMENT'; block.args.comment = line.replace(/^\*\s*/, ''); block.args.structure = true; return block; }

    /* ---- M140 MB MAX / MB+50: retract in the tool axis ---- */
    if ((m = /\bM140\s+MB\s*(MAX|[+-]?(?:\d+\.?\d*|\.\d+))/.exec(U))) {
      block.args.mb = m[1] === 'MAX' ? 'MAX' : parseFloat(m[1]);
      U = U.replace(/\s*\bMB\s*(MAX|[+-]?(?:\d+\.?\d*|\.\d+))/, '');
    }

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

    /* ---- tool definition in the program:  TOOL DEF 5 L+0 R+4 ---- */
    if ((m = /^TOOL\s+DEF\s+(\S+)\s*(.*)$/.exec(U))) {
      block.kind = 'TOOLDEF';
      block.args.t = numOrQ(m[1]);
      var lm = /(?:^|\s)L\s*([+-]?(?:\d+\.?\d*|\.\d+))/.exec(m[2]), rm = /(?:^|\s)R\s*([+-]?(?:\d+\.?\d*|\.\d+))/.exec(m[2]);
      block.args.l = lm ? parseFloat(lm[1]) : null;
      block.args.r = rm ? parseFloat(rm[1]) : null;
      if (block.args.t === null) markParseError(block, 'TOOL NUMBER MISSING');
      return block;
    }

    /* ---- tool call ---- */
    if ((m = /^TOOL\s+CALL\s*(.*)$/.exec(U))) {
      block.kind = 'TOOLCALL';
      toks = words(m[1]);
      /* No number: axis / speed / oversize change only, the tool stays (TOOL CALL Z S2000). */
      var tn = toks.length ? numOrQ(toks[0]) : null;
      block.args.t = tn;
      block.args.axis = null; block.args.s = null; block.args.dl = 0; block.args.dr = 0;
      for (var i = (tn === null ? 0 : 1); i < toks.length; i++) {
        var dm2;
        if (/^[XYZ]$/.test(toks[i]))      block.args.axis = toks[i];
        else if (/^S/.test(toks[i]))      block.args.s = numOrQ(toks[i].slice(1));
        else if (/^F/.test(toks[i]))      block.args.f = numOrQ(toks[i].slice(1));
        else if ((dm2 = /^D([LR])([+-]?(?:\d+\.?\d*|\.\d+))$/.exec(toks[i]))) block.args['d' + dm2[1].toLowerCase()] = parseFloat(dm2[2]);
      }
      if (tn === null && !block.args.axis && block.args.s === null) markParseError(block, 'TOOL NUMBER MISSING');
      return block;
    }

    /* ---- cycle definition, old dotted style:  CYCL DEF 4.2 DEPTH -10 ---- */
    if ((m = /^CYCL\s+DEF\s+(\d+)\.(\d+)\s*(.*)$/.exec(U))) {
      var cnum = parseInt(m[1], 10), sub = parseInt(m[2], 10), body = m[3];
      if (sub === 0) {
        block.kind = 'CYCLDEF'; block.args.num = cnum; block.args.name = body.trim();
      } else {
        block.kind = 'CYCLPARM'; block.indent = true;
        block.args.q = sub; block.args.dot = true; block.args.body = body.trim();
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
    if ((m = /^CALL\s+LBL\s*("?[A-Z0-9_]+"?)\s*(?:REP\s*(Q\d+|\d+)(?:\s*\/\s*(\d+))?)?$/.exec(U))) {
      block.kind = 'CALLLBL';
      block.args.lbl = lblKey(m[1]);
      block.args.rep = m[2] ? numOrQ(m[2]) : 1;               // REP 3 or REP Q5
      block.args.repProg = !!m[2];   // REP word present => program section repeat
      return block;
    }
    if ((m = /^LBL\s*("?[A-Z0-9_]+"?)$/.exec(U))) {
      var ln = lblKey(m[1]);
      block.kind = (ln === 0) ? 'LBLEND' : 'LBL';
      block.args.lbl = ln;
      return block;
    }

    /* ---- Q parameter functions ---- */
    if ((m = /^FN\s*(\d+)\s*:\s*(.*)$/.exec(U))) {
      var fnum = parseInt(m[1], 10), rest2 = m[2].trim(), jm;
      block.args.fn = fnum;
      if (fnum >= 9 && fnum <= 12) {                           // FN 9-12: IF a EQU/NE/GT/LT b GOTO LBL n
        block.kind = 'JUMP';
        jm = /^IF\s*(.+?)\s*(EQU|NE|GT|LT)\s*(.+?)\s*GOTO\s*LBL\s*("?[A-Z0-9_]+"?)$/.exec(rest2);
        if (!jm) { markParseError(block, 'BLOCK FORMAT INCORRECT'); return block; }
        block.args.a = compileExpr(jm[1]); block.args.b = compileExpr(jm[3]);
        block.args.op = jm[2]; block.args.lbl = lblKey(jm[4]);
        if (!block.args.a || !block.args.b) markParseError(block, 'ARITHMETICAL ERROR');
        return block;
      }
      if (fnum === 14) {                                       // FN 14: ERROR = n
        block.kind = 'FNERR'; jm = /ERROR\s*=?\s*(\d+)/.exec(rest2); block.args.code = jm ? parseInt(jm[1], 10) : 0; return block;
      }
      if ((jm = /^Q(\d+)\s*=\s*(.*)$/.exec(rest2)) && (fnum <= 8 || fnum === 13)) {
        block.kind = 'FN';
        block.args.target = parseInt(jm[1], 10);
        block.args.expr = compileExpr(jm[2]);
        if (!block.args.expr) markParseError(block, 'ARITHMETICAL ERROR');
        return block;
      }
      /* FN 15/16 print, 17/18 system data, 19 PLC, 20 wait: accepted, no effect in the simulator */
      if (fnum >= 15 && fnum <= 20) { block.kind = 'FNNOP'; return block; }
      markParseError(block, 'BLOCK FORMAT INCORRECT');
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

    /* ---- contour approach / departure ---- */
    if ((m = /^APPR\s+(P?)(LT|LN|CT|LCT)\b\s*(.*)$/.exec(U))) {
      block.kind = 'APPR'; block.args.form = m[2]; block.args.polar = !!m[1];
      bad = scanWords(words(m[3]), block.args);
      if (bad.length) markParseError(block, 'BLOCK FORMAT INCORRECT');
      else if ((m[2] === 'LT' || m[2] === 'LN') && block.args.len === undefined) markParseError(block, 'ENTRY INCOMPLETE');
      else if ((m[2] === 'CT' || m[2] === 'LCT') && block.args.r === undefined) markParseError(block, 'ENTRY INCOMPLETE');
      else if (m[2] === 'CT' && block.args.cca === undefined) markParseError(block, 'ENTRY INCOMPLETE');
      return block;
    }
    if ((m = /^DEP\s+(P?)(LT|LN|CT|LCT)\b\s*(.*)$/.exec(U))) {
      block.kind = 'DEP'; block.args.form = m[2]; block.args.polar = !!m[1];
      bad = scanWords(words(m[3]), block.args);
      if (bad.length) markParseError(block, 'BLOCK FORMAT INCORRECT');
      else if ((m[2] === 'LT' || m[2] === 'LN') && block.args.len === undefined) markParseError(block, 'ENTRY INCOMPLETE');
      else if ((m[2] === 'CT' || m[2] === 'LCT') && block.args.r === undefined) markParseError(block, 'ENTRY INCOMPLETE');
      else if (m[2] === 'CT' && block.args.cca === undefined) markParseError(block, 'ENTRY INCOMPLETE');
      return block;
    }

    /* ---- corner functions ---- */
    if ((m = /^RND\s*(.*)$/.exec(U))) {
      block.kind = 'RND';
      bad = scanWords(words(m[1]), block.args);
      if (block.args.r === undefined || typeof block.args.r === 'string') markParseError(block, 'ENTRY INCOMPLETE');
      else if (bad.length) markParseError(block, 'BLOCK FORMAT INCORRECT');
      return block;
    }
    if ((m = /^CHF\s*([+-]?(?:Q\d+|\d+\.?\d*|\.\d+))\s*(.*)$/.exec(U))) {
      block.kind = 'CHF'; block.args.len = numOrQ(m[1]);
      bad = scanWords(words(m[2]), block.args);
      if (bad.length) markParseError(block, 'BLOCK FORMAT INCORRECT');
      return block;
    }

    /* ---- polar and tangential paths ---- */
    if ((m = /^(LP|CP|CTP|CT)\s+(.*)$/.exec(U))) {
      block.kind = m[1];
      bad = scanWords(words(m[2]), block.args);
      if (bad.length) markParseError(block, 'BLOCK FORMAT INCORRECT');
      return block;
    }

    /* ---- circle centre / arcs / lines ---- */
    if ((m = /^CC\s*(.*)$/.exec(U))) {
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

    /* ---- Qn = ... : a cycle parameter line or a formula; parse() decides from the context ---- */
    if ((m = /^Q(\d+)\s*=\s*(.+)$/.exec(U))) {
      block.kind = 'QASSIGN';
      block.args.q = parseInt(m[1], 10);
      var single = m[2].replace(/\s+/g, '');
      block.args.value = numOrQ(single);
      /* FMAX / MAX / FAUTO / AUTO: the cycle's own default (rapid for retraction feeds) */
      if (block.args.value === null && /^F?(MAX|AUTO)$/.test(single)) block.args.value = NaN;
      block.args.expr = compileExpr(m[2]);
      return block;
    }

    markParseError(block, 'BLOCK FORMAT INCORRECT');
    return block;
  }

  function parse(text) {
    var blocks = [], errors = [];
    var lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/);
    var nc = 0, owner = 0;
    var ctx = null;                                   // kind of the last NC block, for Qn = ... lines
    for (var i = 0; i < lines.length; i++) {
      var b = parseLine(lines[i], blocks.length);
      if (b.kind === 'QASSIGN') {
        /* Inside a CYCL DEF (Q-style), Q200+ lines are its parameters; anywhere else it is a formula. */
        var inCycle = (ctx === 'CYCLDEF' || ctx === 'CYCLPARM') && b.args.q >= 200 && b.args.value !== null;
        if (inCycle) { b.kind = 'CYCLPARM'; b.indent = true; delete b.args.expr; }
        else { b.kind = 'FORMULA'; if (!b.args.expr) markParseError(b, 'ARITHMETICAL ERROR'); }
      }
      if (b.kind !== 'BLANK' && b.kind !== 'COMMENT') ctx = (b.kind === 'CYCLPARM' && b.args.dot) ? 'DOT' : b.kind;
      /* HEIDENHAIN numbering: a CYCL DEF and its Q-parameter lines are ONE NC
         block, so parameter lines carry their CYCL DEF's number and do not
         advance the count. Blank lines are not NC blocks and carry none. */
      if (b.kind === 'CYCLPARM' && !b.args.dot) b.n = owner;          // Q lines belong to their CYCL DEF; dotted lines are numbered
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
      pos: { x: 0, y: 0, z: 0 },          // programmed coordinates (after cycles 7/8/10/11)
      mpos: { x: 0, y: 0, z: 0 },         // machine coordinates: where the tool really is
      xf: { on: false, dx: 0, dy: 0, dz: 0, mx: false, my: false, mz: false, rot: 0, s: 1, flip: false, tilt: null },
      steps: 0,
      rot: { a: 0, b: 0, c: 0 },          // rotary axis positions, degrees
      feed: DEFAULT_FEED,
      tool: { t: 0, name: '', r: 3, l: 0, dr: 0 },
      spindle: 0,          // effective: sRpm * spinDir
      sRpm: 0, spinDir: 0,
      coolant: false,
      cc: null,
      rc: 'R0',            // modal radius compensation
      rcAct: false,        // this block switches RL/RR on
      lastTan: null,       // XY unit tangent at the end of the last path element (for CT)
      toolDefs: {},        // TOOL DEF inside the program
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

  /* ---- coordinate transformations: cycles 7 datum shift, 8 mirror, 10 rotation, 11 scaling.
     machine = shift + rotate( scale( mirror(programmed) ) ), all about the active datum. ---- */
  function toM(st, p) {
    var f = st.xf; if (!f.on) return { x: p.x, y: p.y, z: p.z };
    var x = f.mx ? -p.x : p.x, y = f.my ? -p.y : p.y, z = f.mz ? -p.z : p.z;
    x *= f.s; y *= f.s; z *= f.s;
    var c = Math.cos(f.rot * Math.PI / 180), sn = Math.sin(f.rot * Math.PI / 180), X = x * c - y * sn, Y = x * sn + y * c;
    if (f.tilt) { var T = f.tilt.m; var X2 = T[0] * X + T[1] * Y + T[2] * z, Y2 = T[3] * X + T[4] * Y + T[5] * z, Z2 = T[6] * X + T[7] * Y + T[8] * z; X = X2; Y = Y2; z = Z2; }
    return { x: X + f.dx, y: Y + f.dy, z: z + f.dz };
  }
  function fromM(st, p) {
    var f = st.xf; if (!f.on) return { x: p.x, y: p.y, z: p.z };
    var x = p.x - f.dx, y = p.y - f.dy, z = p.z - f.dz;
    if (f.tilt) { var T = f.tilt.m; var x2 = T[0] * x + T[3] * y + T[6] * z, y2 = T[1] * x + T[4] * y + T[7] * z, z2 = T[2] * x + T[5] * y + T[8] * z; x = x2; y = y2; z = z2; }  // inverse = transpose
    var c = Math.cos(f.rot * Math.PI / 180), sn = Math.sin(f.rot * Math.PI / 180);
    var xr = x * c + y * sn, yr = -x * sn + y * c;
    xr /= f.s; yr /= f.s; z /= f.s;
    return { x: f.mx ? -xr : xr, y: f.my ? -yr : yr, z: f.mz ? -z : z };
  }
  function flipRc(st, rc) { return (st.xf.flip && (rc === 'RL' || rc === 'RR')) ? (rc === 'RL' ? 'RR' : 'RL') : rc; }
  function applyTransform(st, cy, bi) {
    var f = st.xf, subs = cy.bodies || {}, k, v, m, toks, i;
    var all = Object.keys(subs).sort().map(function (n) { return subs[n]; }).join(' ');
    if (cy.num === 7) {
      toks = words(all);
      for (i = 0; i < toks.length; i++) if ((m = /^(I)?([XYZ])(\S+)$/.exec(toks[i]))) {
        v = resolve(numOrQ(m[3]), st.Q); if (v === null) { fail(st, bi, 'CYCL DEF INCOMPLETE'); continue; }
        k = 'd' + m[2].toLowerCase(); f[k] = m[1] ? f[k] + v : v;
      }
    } else if (cy.num === 8) {
      if (/NO\s*ENT|^\s*$/.test(all)) { f.mx = f.my = f.mz = false; }
      else { f.mx = /(^|\s)X\b/.test(all); f.my = /(^|\s)Y\b/.test(all); f.mz = /(^|\s)Z\b/.test(all); }
    } else if (cy.num === 10) {
      if ((m = /(I)?ROT\s*([+-]?(?:Q\d+|\d+\.?\d*|\.\d+))/.exec(all))) { v = resolve(numOrQ(m[2]), st.Q) || 0; f.rot = m[1] ? f.rot + v : v; }
      else fail(st, bi, 'CYCL DEF INCOMPLETE');
    } else if (cy.num === 19) {
      /* 19.1 A.. B.. C..: the working plane follows the head. This machine's head: B (outer, about Y, B+ tilts the
         tip to X+) carries A (inner, about X, A+ tilts the tip to Y+): R = Ry(-B)·Rx(A). All zero cancels the tilt. */
      var ang = { a: 0, b: 0, c: 0 }, any = false;
      words(all).forEach(function (w) { var mm = /^([ABC])(\S+)$/.exec(w); if (mm) { var vv = resolve(numOrQ(mm[2]), st.Q); if (vv !== null) { ang[mm[1].toLowerCase()] = vv; any = true; } } });
      if (!any || (!ang.a && !ang.b && !ang.c)) f.tilt = null;
      else {
        var A = ang.a * Math.PI / 180, B = -ang.b * Math.PI / 180, ca = Math.cos(A), sa = Math.sin(A), cb = Math.cos(B), sb = Math.sin(B);
        f.tilt = { a: ang.a, b: ang.b, c: ang.c, m: [cb, sb * sa, sb * ca, 0, ca, -sa, -sb, cb * sa, cb * ca] };
      }
      if (st.mach.c19pos !== false && (st.mach.axes || []).some(function (x) { return x === 'A' || x === 'B'; })) {
        st.rotTo = { a: ang.a, b: ang.b };                        // MP 7500 bit 2: cycle 19 positions the rotary axes
        f.on = true; st.pos = fromM(st, st.mpos);
        emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: st.pos.z }, RAPID_RATE, bi, null);
      }
    } else if (cy.num === 11) {
      if ((m = /SCL\s*([+-]?(?:Q\d+|\d+\.?\d*|\.\d+))/.exec(all))) { v = resolve(numOrQ(m[1]), st.Q); if (v > 0) f.s = v; else fail(st, bi, 'CYCL DEF INCOMPLETE'); }
      else fail(st, bi, 'CYCL DEF INCOMPLETE');
    }
    f.flip = f.mx !== f.my;                                   // one plane axis mirrored: arcs and RL/RR swap
    f.on = !!(f.dx || f.dy || f.dz || f.mx || f.my || f.mz || f.rot || f.s !== 1 || f.tilt);
    st.pos = fromM(st, st.mpos);                              // the tool does not move; its programmed position does
    if (st.cc) st.cc = st.cc;                                 // CC stays in programmed coordinates
  }

  function arcSweep(from, to, arc) {
    return (arc.sweep !== undefined && arc.sweep !== null) ? arc.sweep : sweepAngle(from, to, arc.cx, arc.cy, arc.ccw);
  }

  function emit(st, kind, to, feed, bi, cycleName, arc) {
    if (st.abort) return;
    if (kind === 'arc' && st.xf.tilt) {                          // an arc in the tilted plane is a 3D arc: chords
      var p0 = st.pos, sw0 = arcSweep(p0, to, arc), r0_ = Math.hypot(p0.x - arc.cx, p0.y - arc.cy), a00 = Math.atan2(p0.y - arc.cy, p0.x - arc.cx);
      var nch = Math.max(8, Math.ceil(Math.abs(sw0) / (Math.PI / 36))), z0_ = p0.z;
      for (var ci = 1; ci <= nch; ci++) { var an = a00 + sw0 * ci / nch;
        emit(st, 'feed', ci === nch ? to : { x: arc.cx + r0_ * Math.cos(an), y: arc.cy + r0_ * Math.sin(an), z: z0_ + (to.z - z0_) * ci / nch }, feed, bi, cycleName); }
      return;
    }
    var pfrom = { x: st.pos.x, y: st.pos.y, z: st.pos.z };      // programmed
    var from = { x: st.mpos.x, y: st.mpos.y, z: st.mpos.z }, pto = to;
    to = toM(st, pto);
    var psw = (kind === 'arc') ? arcSweep(pfrom, pto, arc) : 0, sw = st.xf.flip ? -psw : psw, len, mc = null;
    if (kind === 'arc') {
      mc = toM(st, { x: arc.cx, y: arc.cy, z: 0 });
      var rr = Math.sqrt((from.x - mc.x) * (from.x - mc.x) + (from.y - mc.y) * (from.y - mc.y));
      len = Math.sqrt(rr * sw * rr * sw + (to.z - from.z) * (to.z - from.z));
    } else len = dist3(from, to);
    var tagRc = cycleName ? null : flipRc(st, st.rc === 'RL' || st.rc === 'RR' ? st.rc : null);
    var r0 = { a: st.rot.a, b: st.rot.b, c: st.rot.c }, r1 = r0, dRot = 0;
    if (st.rotTo) {                                              // rotary axes move with this block
      r1 = { a: st.rotTo.a !== undefined ? st.rotTo.a : r0.a, b: st.rotTo.b !== undefined ? st.rotTo.b : r0.b, c: st.rotTo.c !== undefined ? st.rotTo.c : r0.c };
      st.rotTo = null;
      var lim = st.mach.limits || {};
      ['a', 'b', 'c'].forEach(function (k) { var L = lim[k.toUpperCase()]; if (!L) return;
        if (r1[k] > L[1] + 1e-9) { fail(st, bi, 'LIMIT SWITCH ' + k.toUpperCase() + '+'); r1[k] = L[1]; }
        if (r1[k] < L[0] - 1e-9) { fail(st, bi, 'LIMIT SWITCH ' + k.toUpperCase() + '-'); r1[k] = L[0]; } });
      dRot = Math.max(Math.abs(r1.a - r0.a), Math.abs(r1.b - r0.b), Math.abs(r1.c - r0.c));
      st.rot = r1;
    }
    // a zero-length activation block still has to mark where RL/RR starts; a rotary-only move still moves
    if (!(len > EPS) && !(tagRc && st.rcAct) && !(dRot > EPS)) { st.pos = { x: pto.x, y: pto.y, z: pto.z }; st.mpos = to; return; }
    /* machine dynamics: F capped at MP 1020, rapids per axis (MP 1010), acceleration (MP 1060) */
    var mc2 = st.mach, dur = null;
    if (kind !== 'rapid' && mc2.fMax && feed > mc2.fMax) feed = mc2.fMax;
    if (mc2.rapid || mc2.accel) {
      var R = mc2.rapid || {}, tmin;
      if (kind === 'rapid') {
        tmin = Math.max(Math.abs(to.x - from.x) / (R.x || RAPID_RATE), Math.abs(to.y - from.y) / (R.y || RAPID_RATE), Math.abs(to.z - from.z) / (R.z || RAPID_RATE),
                        Math.abs(r1.a - r0.a) / (R.a || 3600), Math.abs(r1.b - r0.b) / (R.b || 3600), Math.abs(r1.c - r0.c) / (R.c || 3600));
      } else tmin = Math.max(len / Math.max(feed, 1), Math.abs(r1.a - r0.a) / 800, Math.abs(r1.b - r0.b) / 720);
      var sec = tmin * 60;
      if (mc2.accel && len > EPS) {                              // trapezoid: v/a extra, or a triangle on short moves
        var v = len / Math.max(sec, 1e-9), acc = mc2.accel * 1000;
        sec = (len >= v * v / acc) ? len / v + v / acc : 2 * Math.sqrt(len / acc);
      }
      dur = sec;
    }
    st.moves.push({
      kind: kind,
      from: from,
      to: { x: to.x, y: to.y, z: to.z },
      cx: mc ? mc.x : null,
      cy: mc ? mc.y : null,
      ccw: arc ? sw > 0 : false,
      sweep: arc ? sw : null,
      feed: (kind === 'rapid') ? RAPID_RATE : feed,
      tool: st.tool.t,
      toolR: st.tool.r,
      toolDR: st.tool.dr || 0,
      toolL: st.tool.l > 0 ? st.tool.l : 0,
      stick: stickOf(st),
      toolName: st.tool.name,
      spindle: st.spindle,
      sRpm: st.sRpm,
      coolant: st.coolant,
      block: bi,
      cycle: cycleName || null,
      rc: tagRc,
      rcAct: !!(tagRc && st.rcAct),
      rot0: dRot > EPS || r0.a || r0.b || r0.c ? r0 : null,
      rot1: dRot > EPS || r1.a || r1.b || r1.c ? r1 : null,
      dur: dur,
      len: len
    });
    if (tagRc) st.rcAct = false;
    // tangent at the end of this element (programmed coordinates), for CT
    if (kind === 'arc') {
      var ea = Math.atan2(pto.y - arc.cy, pto.x - arc.cx), d = psw > 0 ? 1 : -1;
      st.lastTan = { x: -Math.sin(ea) * d, y: Math.cos(ea) * d };
    } else {
      var dx = pto.x - pfrom.x, dy = pto.y - pfrom.y, l = Math.sqrt(dx * dx + dy * dy);
      if (l > EPS) st.lastTan = { x: dx / l, y: dy / l };
    }
    st.pos = { x: pto.x, y: pto.y, z: pto.z }; st.mpos = to;
    if (st.moves.length >= MAX_MOVES) { st.abort = true; fail(st, bi, 'EXCESSIVE SUBPROGRAM NESTING'); }
  }

  /* stick-out below the holder nose. Only for a tool whose length L is known: with L = 0 the length was
     measured on the machine and the simulator cannot know it, so no holder check. */
  function stickOf(st) {
    var L = st.tool.l;
    if (!(L > 0) || !st.holder || !st.holder.stack || !st.tool.t) return null;
    return Math.max(L - st.holder.stack(st.tool.r), 0.25 * L);
  }
  function mark(st, m) { m.kind = 'mark'; st.moves.push(m); }   // m.len is the APPR/DEP LEN, not a path length

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
        cy.dot = true; (cy.bodies = cy.bodies || {})[p.args.q] = p.args.body || '';
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
    // Q208 = 0: retract at the plunging feed Q206 (manual, cycle 203)
    var fret  = universal ? (qp(cy, 208, RAPID_RATE) === 0 ? fpl : qp(cy, 208, RAPID_RATE)) : RAPID_RATE;
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
    var fret = qp(cy, 208, RAPID_RATE) === 0 ? fpl : qp(cy, 208, RAPID_RATE);   // Q208 = 0: at the reaming feed
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
    var stepOver = (st.mach.pocketK || 0.7) * R; if (!(stepOver > EPS)) stepOver = 1;   // MP 7430 overlap factor

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


  /* ---- spindle helpers for tapping / boring: reverse, stop, restore ---- */
  function spin(st, dir) { st.spinDir = dir; st.spindle = st.sRpm * st.spinDir; }

  /* --- CYCL DEF 202 BORING: down at Q206, dwell, oriented stop, disengage 0.2 (Q214), out at Q208 --- */
  function cycleBore(st, cy, bi) {
    var clr = qp(cy, 200, 2), dep = -Math.abs(qp(cy, 201, 0)), fpl = qp(cy, 206, st.feed) || st.feed;
    var fret = qp(cy, 208, 0) || fpl, surf = qp(cy, 203, 0), clr2 = qp(cy, 204, clr), dirn = Math.round(qp(cy, 214, 0));
    var x = st.pos.x, y = st.pos.y, lab = cy.label, keep = st.spinDir;
    if (Math.abs(dep) <= EPS) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
    emit(st, 'feed', { x: x, y: y, z: surf + dep }, fpl, bi, lab);
    var off = { 1: [-0.2, 0], 2: [0, -0.2], 3: [0.2, 0], 4: [0, 0.2] }[dirn] || [0, 0];
    spin(st, 0);                                                // oriented spindle stop
    emit(st, 'feed', { x: x + off[0], y: y + off[1], z: surf + dep }, fpl, bi, lab);
    emit(st, 'feed', { x: x + off[0], y: y + off[1], z: surf + clr }, fret, bi, lab);
    emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
    emit(st, 'rapid', { x: x, y: y, z: surf + clr2 }, RAPID_RATE, bi, lab);
    spin(st, keep);                                             // spindle state as before the cycle
  }

  /* --- CYCL DEF 204 BACK BORING: through the hole off-centre, counterbore upward from below --- */
  function cycleBackBore(st, cy, bi) {
    var clr = qp(cy, 200, 2), cb = qp(cy, 249, 0), thick = Math.abs(qp(cy, 250, 0)), offc = Math.abs(qp(cy, 251, 0)), edge = Math.abs(qp(cy, 252, 0));
    var fpre = qp(cy, 253, RAPID_RATE) || RAPID_RATE, fcb = qp(cy, 254, st.feed) || st.feed, surf = qp(cy, 203, 0), clr2 = qp(cy, 204, clr);
    var dirn = Math.round(qp(cy, 214, 1)), x = st.pos.x, y = st.pos.y, lab = cy.label, keep = st.spinDir;
    if (thick <= EPS || Math.abs(cb) <= EPS) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    var off = { 1: [-offc, 0], 2: [0, -offc], 3: [offc, 0], 4: [0, offc] }[dirn] || [-offc, 0];
    var zStart = surf - thick - edge - clr, zEnd = surf - thick - edge + Math.abs(cb);
    emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
    spin(st, 0);
    emit(st, 'rapid', { x: x + off[0], y: y + off[1], z: surf + clr }, RAPID_RATE, bi, lab);
    emit(st, 'feed', { x: x + off[0], y: y + off[1], z: zStart }, fpre, bi, lab);
    emit(st, 'feed', { x: x, y: y, z: zStart }, fpre, bi, lab);
    spin(st, keep || 1);
    emit(st, 'feed', { x: x, y: y, z: zEnd }, fcb, bi, lab);
    spin(st, 0);
    emit(st, 'feed', { x: x, y: y, z: zStart }, fpre, bi, lab);
    emit(st, 'feed', { x: x + off[0], y: y + off[1], z: zStart }, fpre, bi, lab);
    emit(st, 'feed', { x: x + off[0], y: y + off[1], z: surf + clr }, fpre, bi, lab);
    emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
    emit(st, 'rapid', { x: x, y: y, z: surf + clr2 }, RAPID_RATE, bi, lab);
    spin(st, keep);
  }

  /* --- CYCL DEF 205 UNIVERSAL PECKING: decrementing pecks, advanced stop Q258 -> Q259, chip breaking Q257/Q256 --- */
  function cyclePeck205(st, cy, bi) {
    var clr = qp(cy, 200, 2), total = Math.abs(qp(cy, 201, 0)), fpl = qp(cy, 206, st.feed) || st.feed, peck = Math.abs(qp(cy, 202, 0));
    var surf = qp(cy, 203, 0), clr2 = qp(cy, 204, clr), decr = Math.abs(qp(cy, 212, 0)), minp = Math.abs(qp(cy, 205, 0));
    var up = Math.abs(qp(cy, 258, 0.2)), lo = Math.abs(qp(cy, 259, up)), cbd = Math.abs(qp(cy, 257, 0)), cbr = Math.abs(qp(cy, 256, 0.2));
    var x = st.pos.x, y = st.pos.y, lab = cy.label;
    if (total <= EPS) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
    var step = peck > EPS ? peck : total, d = 0, g = 0, sinceBreak = 0;
    while (d < total - 1e-6 && g++ < 2000 && !st.abort) {
      var target = Math.min(d + step, total);
      if (cbd > EPS) {                                          // chip breaking inside the peck
        while (d < target - 1e-6 && g++ < 4000) {
          var nd = Math.min(d + cbd - sinceBreak, target); sinceBreak = 0;
          emit(st, 'feed', { x: x, y: y, z: surf - nd }, fpl, bi, lab); d = nd;
          if (d < target - 1e-6) emit(st, 'rapid', { x: x, y: y, z: surf - d + cbr }, RAPID_RATE, bi, lab),
                                 emit(st, 'feed', { x: x, y: y, z: surf - d }, fpl, bi, lab);
        }
      } else { emit(st, 'feed', { x: x, y: y, z: surf - target }, fpl, bi, lab); d = target; }
      if (d >= total - 1e-6) break;
      var adv = total > EPS ? up + (lo - up) * (d / total) : up; // advanced stop distance, first -> last
      emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
      emit(st, 'rapid', { x: x, y: y, z: surf - d + adv }, RAPID_RATE, bi, lab);
      emit(st, 'feed', { x: x, y: y, z: surf - d }, fpl, bi, lab);
      if (decr > EPS) step = Math.max(step - decr, minp > EPS ? minp : decr);
    }
    emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
    emit(st, 'rapid', { x: x, y: y, z: surf + clr2 }, RAPID_RATE, bi, lab);
  }

  /* --- tapping: 206 (floating holder, F = Q206), 207 (rigid, F = S x Q239), 209 (rigid, chip breaking) --- */
  function cycleTap(st, cy, bi, kind) {
    var clr = qp(cy, 200, 2), dep = Math.abs(qp(cy, 201, 0)), surf = qp(cy, 203, 0), clr2 = qp(cy, 204, clr);
    var x = st.pos.x, y = st.pos.y, lab = cy.label, keep = st.spinDir, f;
    if (dep <= EPS) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    if (kind === 206) f = qp(cy, 206, st.feed) || st.feed;
    else { var pitch = qp(cy, 239, 0); f = Math.abs(pitch) * st.sRpm; if (!(f > 0)) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; } }
    /* 206 (floating tap holder) needs the spindle running. 207/209 are rigid: the control drives the spindle itself,
       so a repeated M99 after the spindle stopped at the end of the previous hole is legal (CAM posts rely on it). */
    if (!keep && kind === 206) { fail(st, bi, 'SPINDLE ?'); }
    var dir = keep || 1;
    emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
    spin(st, dir);                                                // the cycle runs the spindle for the tap
    if (kind === 209) {                                         // infeed Q257, reverse, retract Q256 (0: to set-up clearance)
      var inf = Math.abs(qp(cy, 257, dep)) || dep, back = Math.abs(qp(cy, 256, 0)), d = 0, g = 0;
      while (d < dep - 1e-6 && g++ < 1000) {
        d = Math.min(d + inf, dep);
        emit(st, 'feed', { x: x, y: y, z: surf - d }, f, bi, lab);
        if (d >= dep - 1e-6) break;
        spin(st, -dir);
        emit(st, 'feed', { x: x, y: y, z: back > EPS ? surf - d + back : surf + clr }, f, bi, lab);
        spin(st, dir);
        emit(st, 'feed', { x: x, y: y, z: surf - d }, f, bi, lab);
      }
    } else emit(st, 'feed', { x: x, y: y, z: surf - dep }, f, bi, lab);
    spin(st, -dir);                                             // reverse at the bottom, feed out
    emit(st, 'feed', { x: x, y: y, z: surf + clr }, f, bi, lab);
    spin(st, kind === 206 ? dir : 0);                           // 207/209: spindle stops at the end (manual)
    emit(st, 'rapid', { x: x, y: y, z: surf + clr2 }, RAPID_RATE, bi, lab);
  }

  /* --- CYCL DEF 208 BORE MILLING: helix Q334 per turn down to depth, full circle, back to centre --- */
  function cycleBoreMill(st, cy, bi) {
    var clr = qp(cy, 200, 2), dep = Math.abs(qp(cy, 201, 0)), f = qp(cy, 206, st.feed) || st.feed, pitch = Math.abs(qp(cy, 334, 0.25));
    var surf = qp(cy, 203, 0), clr2 = qp(cy, 204, clr), dia = Math.abs(qp(cy, 335, 0)), x = st.pos.x, y = st.pos.y, lab = cy.label;
    var r = dia / 2 - st.tool.r;
    if (dep <= EPS || dia <= EPS) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    if (r < -EPS) { fail(st, bi, 'TOOL RADIUS TOO LARGE'); return; }
    emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
    if (r <= EPS) { emit(st, 'feed', { x: x, y: y, z: surf - dep }, f, bi, lab); }      // tool = bore: plunge
    else {
      emit(st, 'feed', { x: x + r, y: y, z: surf + clr }, f, bi, lab);
      var drop = dep + clr, turns = drop / Math.max(pitch, 1e-3);
      emit(st, 'arc', { x: x + r * Math.cos(turns * 2 * Math.PI), y: y + r * Math.sin(turns * 2 * Math.PI), z: surf - dep }, f, bi, lab,
           { cx: x, cy: y, ccw: true, sweep: turns * 2 * Math.PI });
      var a0 = Math.atan2(st.pos.y - y, st.pos.x - x);
      emit(st, 'arc', { x: st.pos.x, y: st.pos.y, z: surf - dep }, f, bi, lab, { cx: x, cy: y, ccw: true, sweep: 2 * Math.PI });  // clean-up circle
      emit(st, 'feed', { x: x, y: y, z: surf - dep }, f, bi, lab);
    }
    emit(st, 'rapid', { x: x, y: y, z: surf + clr }, RAPID_RATE, bi, lab);
    emit(st, 'rapid', { x: x, y: y, z: surf + clr2 }, RAPID_RATE, bi, lab);
  }

  /* --- old dotted cycles, started from set-up clearance above the surface (tool already there) ---
     1 PECKING: 1.1 SET UP, 1.2 DEPTH, 1.3 PECKG, 1.4 DWELL, 1.5 F
     2 TAPPING: 2.1 SET UP, 2.2 DEPTH, 2.3 DWELL, 2.4 F       17 RIGID TAPPING: 17.1 SET UP, 17.2 DEPTH, 17.3 PITCH
     18 THREAD CUTTING: 18.1 DEPTH, 18.2 PITCH (from the current position) */
  function cycleOld(st, cy, bi) {
    var x = st.pos.x, y = st.pos.y, z0 = st.pos.z, lab = cy.label, keep = st.spinDir || 1, n = cy.num;
    if (n === 18) {
      var d18 = sub(cy, 1, 0, 0), p18 = Math.abs(sub(cy, 2, 0, 0)), f18 = p18 * st.sRpm;
      if (!d18 || !(f18 > 0)) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
      emit(st, 'feed', { x: x, y: y, z: z0 + d18 }, f18, bi, lab); spin(st, -keep);
      emit(st, 'feed', { x: x, y: y, z: z0 }, f18, bi, lab); spin(st, keep); return;
    }
    var set = Math.abs(sub(cy, 1, 0, 2)), dep = -Math.abs(sub(cy, 2, 0, 0)), surf = z0 - set;
    if (Math.abs(dep) <= EPS) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    if (n === 1) {
      var peck = Math.abs(sub(cy, 3, 0, 0)) || Math.abs(dep), f1 = sub(cy, 5, 0, st.feed) || st.feed, d = 0;
      while (d < Math.abs(dep) - 1e-6) {
        d = Math.min(d + peck, Math.abs(dep));
        emit(st, 'feed', { x: x, y: y, z: surf - d }, f1, bi, lab);
        emit(st, 'rapid', { x: x, y: y, z: z0 }, RAPID_RATE, bi, lab);
        if (d < Math.abs(dep) - 1e-6) emit(st, 'rapid', { x: x, y: y, z: surf - d + 0.2 }, RAPID_RATE, bi, lab);
      }
      return;
    }
    var f = n === 2 ? (sub(cy, 4, 0, st.feed) || st.feed) : Math.abs(sub(cy, 3, 0, 0)) * st.sRpm;
    if (!(f > 0)) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    if (n === 17) spin(st, keep);                                 // rigid: spindle under cycle control, no M3 needed
    emit(st, 'feed', { x: x, y: y, z: surf + dep }, f, bi, lab); spin(st, -keep);
    emit(st, 'feed', { x: x, y: y, z: z0 }, f, bi, lab); spin(st, n === 17 ? 0 : keep);
  }


  /* depth levels from the surface down to the bottom in steps of Q202 (whole depth when 0) */
  function levels(surf, total, peck) {
    var out = [], d = 0, g = 0, step = peck > EPS ? peck : total;
    while (d < total - 1e-6 && g++ < 1000) { d = Math.min(d + step, total); out.push(surf - d); }
    return out;
  }
  /* rounded rectangle as a closed tool-centre path from the mid of the +X side; ccw or cw */
  function rrectPath(cx, cy, hx, hy, rc, ccw) {
    rc = Math.max(0, Math.min(rc, hx, hy));
    var P = [], ex = hx - rc, ey = hy - rc;
    var corners = [[ex, ey, 0], [-ex, ey, 90], [-ex, -ey, 180], [ex, -ey, 270]];        // ccw order, start angles
    P.push({ t: 'L', x: cx + hx, y: cy + (ccw ? ey : -ey) });
    var order = ccw ? [0, 1, 2, 3] : [3, 2, 1, 0];
    for (var k = 0; k < 4; k++) {
      var c = corners[order[k]], a0 = (ccw ? c[2] : c[2] + 90) * Math.PI / 180, sw = (ccw ? 90 : -90) * Math.PI / 180;
      if (rc > EPS) P.push({ t: 'A', cx: cx + c[0], cy: cy + c[1], sw: sw, x: cx + c[0] + rc * Math.cos(a0 + sw), y: cy + c[1] + rc * Math.sin(a0 + sw) });
      var n = corners[order[(k + 1) % 4]], na = (ccw ? n[2] : n[2] + 90) * Math.PI / 180;
      P.push({ t: 'L', x: cx + n[0] + rc * Math.cos(na), y: cy + n[1] + rc * Math.sin(na) });
    }
    P.pop(); P.push({ t: 'L', x: cx + hx, y: cy });                                      // close at the start point
    return P;
  }
  function runPath(st, P, z, f, bi, lab) {
    for (var i = 0; i < P.length; i++) {
      var e = P[i];
      if (e.t === 'A') emit(st, 'arc', { x: e.x, y: e.y, z: z }, f, bi, lab, { cx: e.cx, cy: e.cy, ccw: e.sw > 0, sweep: e.sw });
      else emit(st, 'feed', { x: e.x, y: e.y, z: z }, f, bi, lab);
    }
  }
  function toClear(st, x, y, clrZ, clr2Z, bi, lab) {        // "if the tool is at the 2nd set-up clearance, rapid in the plane there"
    var z = Math.max(st.pos.z, clrZ);
    emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: z }, RAPID_RATE, bi, lab);
    emit(st, 'rapid', { x: x, y: y, z: z }, RAPID_RATE, bi, lab);
    emit(st, 'rapid', { x: x, y: y, z: clrZ }, RAPID_RATE, bi, lab);
  }

  /* --- 212 POCKET / 213 STUD FINISHING, 214 / 215 CIRCULAR: tangential in, one loop per Q202 level, tangential out --- */
  function cycleFinish(st, cy, bi, at) {
    var n = cy.num, clr = qp(cy, 200, 2), total = Math.abs(qp(cy, 201, 0)), fpl = qp(cy, 206, st.feed) || st.feed, peck = Math.abs(qp(cy, 202, 0));
    var fm = qp(cy, 207, st.feed) || st.feed, surf = qp(cy, 203, 0), clr2 = qp(cy, 204, clr), lab = cy.label, R = st.tool.r;
    var cx = at ? at.x : qp(cy, 216, st.pos.x), cyy = at ? at.y : qp(cy, 217, st.pos.y);
    var pocket = n === 212 || n === 214, round = n === 214 || n === 215, hx, hy, rc;
    if (round) { var d = Math.abs(qp(cy, 223, 0)) / 2; hx = hy = pocket ? d - R : d + R; rc = hx; }
    else { hx = Math.abs(qp(cy, 218, 0)) / 2 + (pocket ? -R : R); hy = Math.abs(qp(cy, 219, 0)) / 2 + (pocket ? -R : R); rc = Math.max(0, Math.abs(qp(cy, 220, 0)) + (pocket ? -R : R)); }
    if (total <= EPS || !(hx > 0) || !(hy > 0)) { fail(st, bi, (hx <= 0 || hy <= 0) ? 'TOOL RADIUS TOO LARGE' : 'CYCL DEF INCOMPLETE'); return; }
    if (pocket && !round && Math.abs(qp(cy, 220, 0)) < R - EPS) fail(st, bi, 'TOOL RADIUS TOO LARGE');   // corner radius smaller than the tool
    var ra = pocket ? Math.min(hx, hy) / 2 : Math.max(R, 2);                // approach arc radius
    var S = { x: cx + hx, y: cyy }, ccw = pocket;                             // climb milling with M3
    var P = round ? [{ t: 'A', cx: cx, cy: cyy, sw: ccw ? 2 * Math.PI : -2 * Math.PI, x: S.x, y: S.y }] : rrectPath(cx, cyy, hx, hy, rc, ccw);
    var a1 = pocket ? { x: S.x - ra, y: S.y - ra } : { x: S.x + ra, y: S.y + ra };          // arc start (in)
    var a2 = pocket ? { x: S.x - ra, y: S.y + ra } : { x: S.x + ra, y: S.y - ra };          // arc end (out)
    var ac = pocket ? { x: S.x - ra, y: S.y } : { x: S.x + ra, y: S.y };
    var start = pocket ? { x: cx, y: cyy } : a1;
    toClear(st, start.x, start.y, surf + clr, surf + clr2, bi, lab);
    var L = levels(surf, total, peck);
    for (var i = 0; i < L.length && !st.abort; i++) {
      emit(st, 'feed', { x: start.x, y: start.y, z: L[i] }, fpl, bi, lab);
      if (pocket) emit(st, 'feed', { x: a1.x, y: a1.y, z: L[i] }, fm, bi, lab);
      emit(st, 'arc', { x: S.x, y: S.y, z: L[i] }, fm, bi, lab, { cx: ac.x, cy: ac.y, ccw: pocket, sweep: (pocket ? 1 : 1) * Math.PI / 2 * (pocket ? 1 : 1) * (pocket ? 1 : 1) });
      runPath(st, P, L[i], fm, bi, lab);
      emit(st, 'arc', { x: a2.x, y: a2.y, z: L[i] }, fm, bi, lab, { cx: ac.x, cy: ac.y, ccw: pocket, sweep: pocket ? Math.PI / 2 : Math.PI / 2 });
      if (pocket) emit(st, 'feed', { x: cx, y: cyy, z: L[i] }, fm, bi, lab);
      else emit(st, 'feed', { x: a1.x, y: a1.y, z: L[i] }, fm, bi, lab);
    }
    emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: surf + clr }, RAPID_RATE, bi, lab);
    emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: surf + clr2 }, RAPID_RATE, bi, lab);
  }

  /* --- 210 SLOT / 211 CIRCULAR SLOT with reciprocating plunge; Q215 0 rough+finish, 1 rough, 2 finish --- */
  function cycleSlot(st, cy, bi, at) {
    var clr = qp(cy, 200, 2), total = Math.abs(qp(cy, 201, 0)), fm = qp(cy, 207, st.feed) || st.feed, peck = Math.abs(qp(cy, 202, 0));
    var op = Math.round(qp(cy, 215, 0)), surf = qp(cy, 203, 0), clr2 = qp(cy, 204, clr), lab = cy.label, R = st.tool.r;
    var cx = at ? at.x : qp(cy, 216, st.pos.x), cyy = at ? at.y : qp(cy, 217, st.pos.y), w = Math.abs(qp(cy, 219, 0)), rs = w / 2 - R;
    if (total <= EPS || w <= EPS) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    if (rs < -EPS || w > 3 * 2 * R + EPS) { fail(st, bi, rs < -EPS ? 'TOOL RADIUS TOO LARGE' : 'SLOT WIDTH TOO LARGE'); if (rs < -EPS) return; }  // manual: width <= 3 x tool diameter
    rs = Math.max(rs, 0);
    var A, B, arcMid = null, pr = 0, a0 = 0, sw = 0;
    if (cy.num === 210) {
      var ang = qp(cy, 224, 0) * Math.PI / 180, half = Math.abs(qp(cy, 218, 0)) / 2 - w / 2;
      if (half < 0) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
      A = { x: cx - half * Math.cos(ang), y: cyy - half * Math.sin(ang) }; B = { x: cx + half * Math.cos(ang), y: cyy + half * Math.sin(ang) };
    } else {
      pr = Math.abs(qp(cy, 244, 0)) / 2; a0 = qp(cy, 245, 0) * Math.PI / 180; sw = qp(cy, 248, 0) * Math.PI / 180;
      A = { x: cx + pr * Math.cos(a0), y: cyy + pr * Math.sin(a0) }; B = { x: cx + pr * Math.cos(a0 + sw), y: cyy + pr * Math.sin(a0 + sw) };
    }
    var go = function (p, z) {                        // along the slot centre line
      if (cy.num === 210) emit(st, 'feed', { x: p.x, y: p.y, z: z }, fm, bi, lab);
      else { var sgn = (p === B) ? 1 : -1; emit(st, 'arc', { x: p.x, y: p.y, z: z }, fm, bi, lab, { cx: cx, cy: cyy, ccw: sgn * sw > 0, sweep: sgn * sw }); }
    };
    toClear(st, A.x, A.y, surf + clr, surf + clr2, bi, lab);
    emit(st, 'feed', { x: A.x, y: A.y, z: surf }, fm, bi, lab);
    var L = levels(surf, total, peck), atA = true;
    if (op !== 2) for (var i = 0; i < L.length && !st.abort; i++) {        // reciprocating ramp down, then back at depth
      go(atA ? B : A, L[i]); atA = !atA; go(atA ? B : A, L[i]); atA = !atA;
    }
    if (op !== 1 && rs > EPS) {                                            // finishing: once around at full depth
      var z = surf - total;
      if (!atA) { go(A, z); atA = true; }
      if (cy.num === 210) {
        var ux = (B.x - A.x), uy = (B.y - A.y), l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l;
        var nx = -uy * rs, ny = ux * rs;
        emit(st, 'feed', { x: A.x - nx, y: A.y - ny, z: z }, fm, bi, lab);
        emit(st, 'feed', { x: B.x - nx, y: B.y - ny, z: z }, fm, bi, lab);
        emit(st, 'arc', { x: B.x + nx, y: B.y + ny, z: z }, fm, bi, lab, { cx: B.x, cy: B.y, ccw: true, sweep: Math.PI });
        emit(st, 'feed', { x: A.x + nx, y: A.y + ny, z: z }, fm, bi, lab);
        emit(st, 'arc', { x: A.x - nx, y: A.y - ny, z: z }, fm, bi, lab, { cx: A.x, cy: A.y, ccw: true, sweep: Math.PI });
        emit(st, 'feed', { x: A.x, y: A.y, z: z }, fm, bi, lab);
      } else {
        var d1 = pr - rs, d2 = pr + rs, e0 = a0, e1 = a0 + sw, dirn = sw >= 0 ? 1 : -1;
        emit(st, 'feed', { x: cx + d1 * Math.cos(e0), y: cyy + d1 * Math.sin(e0), z: z }, fm, bi, lab);
        emit(st, 'arc', { x: cx + d1 * Math.cos(e1), y: cyy + d1 * Math.sin(e1), z: z }, fm, bi, lab, { cx: cx, cy: cyy, ccw: dirn > 0, sweep: sw });
        emit(st, 'arc', { x: cx + d2 * Math.cos(e1), y: cyy + d2 * Math.sin(e1), z: z }, fm, bi, lab, { cx: B.x, cy: B.y, ccw: dirn > 0, sweep: dirn * Math.PI });
        emit(st, 'arc', { x: cx + d2 * Math.cos(e0), y: cyy + d2 * Math.sin(e0), z: z }, fm, bi, lab, { cx: cx, cy: cyy, ccw: dirn < 0, sweep: -sw });
        emit(st, 'arc', { x: cx + d1 * Math.cos(e0), y: cyy + d1 * Math.sin(e0), z: z }, fm, bi, lab, { cx: A.x, cy: A.y, ccw: dirn > 0, sweep: dirn * Math.PI });
        emit(st, 'feed', { x: A.x, y: A.y, z: z }, fm, bi, lab);
      }
    }
    emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: surf + clr }, RAPID_RATE, bi, lab);
    emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: surf + clr2 }, RAPID_RATE, bi, lab);
  }

  /* --- 230 MULTIPASS MILLING (zig-zag over a rectangle) and 231 RULED SURFACE (between lines 1-2 and 4-3) --- */
  function cycleSurface(st, cy, bi) {
    var lab = cy.label, n = Math.max(1, Math.round(qp(cy, 240, 1))), fm = qp(cy, 207, st.feed) || st.feed, clr = qp(cy, 200, 2), P, i;
    if (cy.num === 230) {
      var x0 = qp(cy, 225, 0), y0 = qp(cy, 226, 0), z0 = qp(cy, 227, 0), L1 = qp(cy, 218, 0), L2 = qp(cy, 219, 0);
      var fpl = qp(cy, 206, st.feed) || st.feed, fst = qp(cy, 209, fm) || fm;
      if (!L1 || !L2) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
      toClear(st, x0, y0, z0 + clr, z0 + clr, bi, lab);
      emit(st, 'feed', { x: x0, y: y0, z: z0 }, fpl, bi, lab);
      for (i = 0; i < n && !st.abort; i++) {
        var y = y0 + (n > 1 ? L2 * i / (n - 1) : 0), xe = (i % 2) ? x0 : x0 + L1;
        if (i) emit(st, 'feed', { x: st.pos.x, y: y, z: z0 }, fst, bi, lab);
        emit(st, 'feed', { x: xe, y: y, z: z0 }, fm, bi, lab);
      }
      emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: z0 + clr }, RAPID_RATE, bi, lab);
      return;
    }
    P = [1, 2, 3, 4].map(function (k) { return { x: qp(cy, 225 + 3 * (k - 1), 0), y: qp(cy, 226 + 3 * (k - 1), 0), z: qp(cy, 227 + 3 * (k - 1), 0) }; });
    var lerp = function (a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }; };
    var top = Math.max(P[0].z, P[1].z, P[2].z, P[3].z) + clr;
    toClear(st, P[0].x, P[0].y, top, top, bi, lab);
    emit(st, 'feed', P[0], fm, bi, lab);
    for (i = 0; i <= n && !st.abort; i++) {
      var t = i / n, a = lerp(P[0], P[3], t), b = lerp(P[1], P[2], t);
      if (i) emit(st, 'feed', (i % 2) ? b : a, fm, bi, lab);
      emit(st, 'feed', (i % 2) ? a : b, fm, bi, lab);
    }
    emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: top }, RAPID_RATE, bi, lab);
  }

  /* --- 220 CIRCULAR / 221 LINEAR PATTERN: DEF-active, calls the last machining cycle at every point.
         Q200, Q203, Q204 of the pattern also apply to that cycle; Q301 0 = move at set-up clearance, 1 = 2nd. --- */
  function cyclePattern(st, pat, bi) {
    var mc = st.cycle, pts = [], i, j;
    if (!mc || !IMPLEMENTED_CYCLES[mc.num]) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    if (pat.num === 220) {
      var cx = qp(pat, 216, 0), cy0 = qp(pat, 217, 0), r = Math.abs(qp(pat, 244, 0)) / 2, a0 = qp(pat, 245, 0), a1 = qp(pat, 246, 360);
      var stp = qp(pat, 247, 0), N = Math.max(1, Math.round(qp(pat, 241, 1)));
      if (!stp) stp = (Math.abs(a1 - a0) >= 360 - 1e-9 ? (a1 - a0) / N : (N > 1 ? (a1 - a0) / (N - 1) : 0));
      for (i = 0; i < N; i++) { var a = (a0 + stp * i) * Math.PI / 180; pts.push({ x: cx + r * Math.cos(a), y: cy0 + r * Math.sin(a) }); }
    } else {
      var sx = qp(pat, 225, 0), sy = qp(pat, 226, 0), dx = qp(pat, 237, 0), dy = qp(pat, 238, 0);
      var nc = Math.max(1, Math.round(qp(pat, 242, 1))), nl = Math.max(1, Math.round(qp(pat, 243, 1))), rot = qp(pat, 224, 0) * Math.PI / 180;
      for (j = 0; j < nl; j++) for (i = 0; i < nc; i++) {
        var ii = (j % 2) ? nc - 1 - i : i, u = ii * dx, v = j * dy;                  // line by line, alternating
        pts.push({ x: sx + u * Math.cos(rot) - v * Math.sin(rot), y: sy + u * Math.sin(rot) + v * Math.cos(rot) });
      }
    }
    var run = JSON.parse(JSON.stringify(mc)); run.label = mc.label + ' @' + pat.num;
    ['200', '203', '204'].forEach(function (k) { if (pat.params[k] !== undefined && isFinite(pat.params[k])) run.params[k] = pat.params[k]; });
    var surf = qp(run, 203, 0), travel = surf + (Math.round(qp(pat, 301, 1)) ? qp(run, 204, 50) : qp(run, 200, 2));
    for (i = 0; i < pts.length && !st.abort; i++) {
      emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: Math.max(st.pos.z, travel) }, RAPID_RATE, bi, run.label);
      emit(st, 'rapid', { x: pts[i].x, y: pts[i].y, z: st.pos.z }, RAPID_RATE, bi, run.label);
      execCycle(st, run, bi, pts[i]);
      emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: travel }, RAPID_RATE, bi, run.label);
    }
  }

  function runCycle(st, bi) {
    var cy = st.cycle;
    if (!cy) { fail(st, bi, 'CYCL DEF INCOMPLETE'); return; }
    if (!IMPLEMENTED_CYCLES[cy.num]) return;     // error already reported at CYCL DEF (or no motion)
    execCycle(st, cy, bi, null);
  }
  /* at: pattern point (220/221). Point cycles run at the current position, which the pattern set. */
  function execCycle(st, cy, bi, at) {
    if (cy.num === 200) cycleDrill(st, cy, bi, false);
    else if (cy.num === 203) cycleDrill(st, cy, bi, true);
    else if (cy.num === 201) cycleReam(st, cy, bi);
    else if (cy.num === 4)   cyclePocket(st, cy, bi);
    else if (cy.num === 202) cycleBore(st, cy, bi);
    else if (cy.num === 204) cycleBackBore(st, cy, bi);
    else if (cy.num === 205) cyclePeck205(st, cy, bi);
    else if (cy.num === 206 || cy.num === 207 || cy.num === 209) cycleTap(st, cy, bi, cy.num);
    else if (cy.num === 208) cycleBoreMill(st, cy, bi);
    else if (cy.num >= 212 && cy.num <= 215) cycleFinish(st, cy, bi, at);
    else if (cy.num === 210 || cy.num === 211) cycleSlot(st, cy, bi, at);
    else if (cy.num === 230 || cy.num === 231) cycleSurface(st, cy, bi);
    else if (cy.num === 1 || cy.num === 2 || cy.num === 17 || cy.num === 18) cycleOld(st, cy, bi);
  }

  /* ---------------------------------------------------------------- 7. execution */

  function targetOf(args, st) {
    var p = { x: st.pos.x, y: st.pos.y, z: st.pos.z };
    ['a', 'b', 'c'].forEach(function (k) {                      // rotary axes: machine angles, no transformation
      var v2;
      if (args['ax' + k] !== undefined)  { v2 = resolve(args['ax' + k], st.Q);  if (v2 !== null) st.rotTo = st.rotTo || {}, st.rotTo[k] = v2; }
      if (args['iax' + k] !== undefined) { v2 = resolve(args['iax' + k], st.Q); if (v2 !== null) st.rotTo = st.rotTo || {}, st.rotTo[k] = (st.rotTo && st.rotTo[k] !== undefined ? st.rotTo[k] : st.rot[k]) + v2; }
    });
    var ax = ['x', 'y', 'z'], v;
    for (var i = 0; i < 3; i++) {
      var k = ax[i];
      if (args[k] !== undefined)        { v = resolve(args[k], st.Q); if (v !== null) p[k] = v; }
      if (args['i' + k] !== undefined)  { v = resolve(args['i' + k], st.Q); if (v !== null) p[k] += v; }
    }
    return p;
  }

  /* RL / RR / R0 are modal. Switching straight between RL and RR is refused. */
  function setRc(st, a, bi) {
    st.rcAct = false;
    if (!a.rc) return true;
    var prev = st.rc;
    if ((prev === 'RL' && a.rc === 'RR') || (prev === 'RR' && a.rc === 'RL')) {
      fail(st, bi, 'RADIUS COMP. UNDEFINED'); return false;           // needs an R0 block in between
    }
    st.rc = a.rc;
    st.rcAct = (prev === 'R0' && a.rc !== 'R0');
    return true;
  }

  function feedOf(st, a, bi) {
    /* F AUTO: the control takes it from the cutting-data table. The simulator has none:
       it uses the F of the TOOL CALL block, else keeps the current feed. */
    if (a.fauto) { if (st.autoFeed > 0) st.feed = st.autoFeed; if (st.feed > 0) return true; fail(st, bi, 'FEED RATE MISSING'); return false; }
    if (a.f === undefined) return true;
    var fv = resolve(a.f, st.Q);
    if (fv === null || !(fv > 0)) { fail(st, bi, 'FEED RATE MISSING'); return false; }
    st.feed = fv; return true;
  }

  function doLine(st, b, bi) {
    var a = b.args;
    if (!setRc(st, a, bi)) return;
    applyM(st, a.m, 'start');
    feedOf(st, a, bi);
    var moves = (a.x !== undefined || a.y !== undefined || a.z !== undefined ||
                 a.ix !== undefined || a.iy !== undefined || a.iz !== undefined ||
                 a.axa !== undefined || a.axb !== undefined || a.axc !== undefined ||
                 a.iaxa !== undefined || a.iaxb !== undefined || a.iaxc !== undefined);
    if (moves) {
      var to = targetOf(a, st);
      if (a.fmax) emit(st, 'rapid', to, RAPID_RATE, bi, null);
      else {
        if (!(st.feed > 0)) { fail(st, bi, 'FEED RATE MISSING'); return; }
        emit(st, 'feed', to, st.feed, bi, null);
      }
    }
    applyM(st, a.m, 'end');
    if (a.mb !== undefined) {                     // M140 MB: retract in the tool axis
      var zr = (a.mb === 'MAX') ? Math.max(st.pos.z, Math.max(st.stock.z1, st.stock.z0) + 100) : st.pos.z + a.mb;
      emit(st, 'rapid', { x: st.pos.x, y: st.pos.y, z: zr }, RAPID_RATE, bi, null);
    }
  }

  /* CC sets the circle centre / pole. The two axes programmed pick the plane of the
     following C / CP blocks: X Y (default), Z X or Y Z ("CC Z+0 X+0: pole in the Z/X plane"). */
  function doCC(st, b) {
    var a = b.args, v, c = { x: st.pos.x, y: st.pos.y, z: st.pos.z };
    ['x', 'y', 'z'].forEach(function (k) {
      if (a[k] !== undefined)       { v = resolve(a[k], st.Q);       if (v !== null) c[k] = v; }
      if (a['i' + k] !== undefined) { v = resolve(a['i' + k], st.Q); if (v !== null) c[k] = st.pos[k] + v; }
    });
    var hx = a.x !== undefined || a.ix !== undefined, hy = a.y !== undefined || a.iy !== undefined, hz = a.z !== undefined || a.iz !== undefined;
    c.plane = (hz && hx && !hy) ? 'ZX' : (hz && hy && !hx) ? 'YZ' : 'XY';
    st.cc = c;
  }

  /* arcs outside the XY plane: tessellated here (no radius compensation there) */
  var PLANES = { XY: ['x', 'y', 'z'], ZX: ['z', 'x', 'y'], YZ: ['y', 'z', 'x'] };
  function planeArc(st, bi, sweep, endUV, wEnd) {
    var ax = PLANES[st.cc.plane], u = ax[0], v = ax[1], w = ax[2], from = st.pos;
    var cu = st.cc[u], cv = st.cc[v], r = Math.sqrt((from[u] - cu) * (from[u] - cu) + (from[v] - cv) * (from[v] - cv));
    if (r < EPS) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
    var a0 = Math.atan2(from[v] - cv, from[u] - cu), w0 = from[w];
    if (sweep === null) {                                   // C: from the end point and direction
      var a1 = Math.atan2(endUV[1] - cv, endUV[0] - cu), r2 = Math.sqrt((endUV[0] - cu) * (endUV[0] - cu) + (endUV[1] - cv) * (endUV[1] - cv));
      if (Math.abs(r2 - r) > st.arcTol) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
      sweep = endUV[2] ? dirAngle(a0, a1, 1) || 2 * Math.PI : (dirAngle(a0, a1, -1) || -2 * Math.PI);
    }
    var n = Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 36)));
    for (var i = 1; i <= n; i++) {
      var an = a0 + sweep * i / n, p = {};
      p[u] = cu + r * Math.cos(an); p[v] = cv + r * Math.sin(an); p[w] = w0 + (wEnd - w0) * i / n;
      emit(st, 'feed', p, st.feed, bi, null);
    }
  }

  function doArcC(st, b, bi) {
    var a = b.args;
    if (!setRc(st, a, bi)) return;
    applyM(st, a.m, 'start');
    if (a.f !== undefined) { var fv = resolve(a.f, st.Q); if (fv > 0) st.feed = fv; }
    if (!st.cc) { fail(st, bi, 'CIRCLE CENTER UNDEFINED'); return; }
    var to = targetOf(a, st);
    if (st.cc.plane && st.cc.plane !== 'XY') {
      if (!(st.feed > 0)) { fail(st, bi, 'FEED RATE MISSING'); return; }
      var ax = PLANES[st.cc.plane];
      planeArc(st, bi, null, [to[ax[0]], to[ax[1]], a.dr !== '-'], to[ax[2]]); applyM(st, a.m, 'end'); return;
    }
    var from = st.pos;
    var r1 = Math.sqrt(Math.pow(from.x - st.cc.x, 2) + Math.pow(from.y - st.cc.y, 2));
    var r2 = Math.sqrt(Math.pow(to.x - st.cc.x, 2) + Math.pow(to.y - st.cc.y, 2));
    if (r1 < EPS || Math.abs(r1 - r2) > st.arcTol) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
    if (!(st.feed > 0)) { fail(st, bi, 'FEED RATE MISSING'); return; }
    emit(st, 'arc', to, st.feed, bi, null, { cx: st.cc.x, cy: st.cc.y, ccw: a.dr !== '-' });
    applyM(st, a.m, 'end');
  }

  function doArcCR(st, b, bi) {
    var a = b.args;
    if (!setRc(st, a, bi)) return;
    applyM(st, a.m, 'start');
    if (a.f !== undefined) { var fv = resolve(a.f, st.Q); if (fv > 0) st.feed = fv; }
    var R = resolve(a.r, st.Q);
    if (R === null || Math.abs(R) < EPS) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
    var to = targetOf(a, st), from = st.pos;
    var dx = to.x - from.x, dy = to.y - from.y;
    var L = Math.sqrt(dx * dx + dy * dy);
    if (L < EPS) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
    var h2 = R * R - L * L / 4;
    if (h2 < -st.arcTol) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
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


  /* --- CT: arc tangent to the previous contour element --- */
  function ctTo(st, to, bi) {
    if (!st.lastTan) { fail(st, bi, 'TANGENTIAL CONNECTION NOT POSSIBLE'); return false; }
    var from = st.pos, t = st.lastTan;
    var dx = to.x - from.x, dy = to.y - from.y, d2 = dx * dx + dy * dy;
    if (d2 < EPS) { fail(st, bi, 'ARC END POS. INCORRECT'); return false; }
    var dn = -t.y * dx + t.x * dy;                         // chord projected on the left normal
    if (!(st.feed > 0)) { fail(st, bi, 'FEED RATE MISSING'); return false; }
    if (Math.abs(dn) < 1e-9 * Math.sqrt(d2)) {             // end point straight ahead: the "arc" is a line
      if (dx * t.x + dy * t.y < 0) { fail(st, bi, 'TANGENTIAL CONNECTION NOT POSSIBLE'); return false; }
      emit(st, 'feed', to, st.feed, bi, null); return true;
    }
    var rho = d2 / (2 * dn);
    var cx = from.x - t.y * rho, cy = from.y + t.x * rho;
    st.cc = { x: cx, y: cy };
    emit(st, 'arc', to, st.feed, bi, null, { cx: cx, cy: cy, ccw: rho > 0 });
    return true;
  }
  function doCT(st, b, bi) {
    var a = b.args;
    if (!setRc(st, a, bi)) return;
    applyM(st, a.m, 'start'); feedOf(st, a, bi);
    ctTo(st, targetOf(a, st), bi);
    applyM(st, a.m, 'end');
  }

  /* --- polar coordinates about the pole CC --- */
  function polarTarget(st, a, bi) {
    if (!st.cc) { fail(st, bi, 'CIRCLE CENTER UNDEFINED'); return null; }
    var px = st.pos.x - st.cc.x, py = st.pos.y - st.cc.y;
    var pr = Math.sqrt(px * px + py * py), pa = Math.atan2(py, px) * 180 / Math.PI, v;
    if (a.pr !== undefined)  { v = resolve(a.pr, st.Q);  if (v !== null) pr = v; }
    if (a.ipr !== undefined) { v = resolve(a.ipr, st.Q); if (v !== null) pr += v; }
    if (a.pa !== undefined)  { v = resolve(a.pa, st.Q);  if (v !== null) pa = v; }
    if (a.ipa !== undefined) { v = resolve(a.ipa, st.Q); if (v !== null) pa += v; }
    var p = { x: st.cc.x + pr * Math.cos(pa * Math.PI / 180), y: st.cc.y + pr * Math.sin(pa * Math.PI / 180), z: st.pos.z };
    if (a.z !== undefined)  { v = resolve(a.z, st.Q);  if (v !== null) p.z = v; }
    if (a.iz !== undefined) { v = resolve(a.iz, st.Q); if (v !== null) p.z += v; }
    return p;
  }
  function doLP(st, b, bi) {
    var a = b.args;
    if (!setRc(st, a, bi)) return;
    applyM(st, a.m, 'start'); feedOf(st, a, bi);
    var to = polarTarget(st, a, bi);
    if (to) {
      if (a.fmax) emit(st, 'rapid', to, RAPID_RATE, bi, null);
      else if (!(st.feed > 0)) fail(st, bi, 'FEED RATE MISSING');
      else emit(st, 'feed', to, st.feed, bi, null);
    }
    applyM(st, a.m, 'end');
  }
  function doCTP(st, b, bi) {
    var a = b.args;
    if (!setRc(st, a, bi)) return;
    applyM(st, a.m, 'start'); feedOf(st, a, bi);
    var to = polarTarget(st, a, bi);
    if (to) ctTo(st, to, bi);
    applyM(st, a.m, 'end');
  }
  /* CP: arc about the pole. PA = end angle, IPA = swept angle (may exceed 360 deg: helix). */
  function doCP(st, b, bi) {
    var a = b.args;
    if (!setRc(st, a, bi)) return;
    applyM(st, a.m, 'start'); feedOf(st, a, bi);
    if (!st.cc) { fail(st, bi, 'CIRCLE CENTER UNDEFINED'); return; }
    if (st.cc.plane && st.cc.plane !== 'XY') {
      var pax = PLANES[st.cc.plane], pu = pax[0], pv = pax[1], pw = pax[2], pf = st.pos, psw, pv2;
      var pa0 = Math.atan2(pf[pv] - st.cc[pv], pf[pu] - st.cc[pu]), pccw = a.dr !== '-';
      if (a.ipa !== undefined) psw = Math.abs(resolve(a.ipa, st.Q)) * Math.PI / 180 * (pccw ? 1 : -1);
      else if (a.pa !== undefined) { psw = dirAngle(pa0, resolve(a.pa, st.Q) * Math.PI / 180, pccw ? 1 : -1); if (Math.abs(psw) < EPS) psw = pccw ? 2 * Math.PI : -2 * Math.PI; }
      else { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
      var wz = pf[pw], wkey = pw;                          // helix along the third axis of the plane
      if (a[wkey] !== undefined) { pv2 = resolve(a[wkey], st.Q); if (pv2 !== null) wz = pv2; }
      if (a['i' + wkey] !== undefined) { pv2 = resolve(a['i' + wkey], st.Q); if (pv2 !== null) wz += pv2; }
      if (!(st.feed > 0)) { fail(st, bi, 'FEED RATE MISSING'); return; }
      planeArc(st, bi, psw, null, wz); applyM(st, a.m, 'end'); return;
    }
    var cx = st.cc.x, cy = st.cc.y, from = st.pos;
    var r = Math.sqrt((from.x - cx) * (from.x - cx) + (from.y - cy) * (from.y - cy));
    if (r < EPS) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
    var a0 = Math.atan2(from.y - cy, from.x - cx), ccw = a.dr !== '-', sw, v;
    if (a.ipa !== undefined) {
      v = resolve(a.ipa, st.Q); if (v === null) { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
      sw = Math.abs(v) * Math.PI / 180 * (ccw ? 1 : -1);
    } else if (a.pa !== undefined) {
      v = resolve(a.pa, st.Q) * Math.PI / 180;
      sw = v - a0;
      if (ccw) { while (sw <= EPS) sw += 2 * Math.PI; while (sw > 2 * Math.PI + EPS) sw -= 2 * Math.PI; }
      else     { while (sw >= -EPS) sw -= 2 * Math.PI; while (sw < -2 * Math.PI - EPS) sw += 2 * Math.PI; }
    } else { fail(st, bi, 'ARC END POS. INCORRECT'); return; }
    if (Math.abs(sw) < EPS) return;
    var to = { x: cx + r * Math.cos(a0 + sw), y: cy + r * Math.sin(a0 + sw), z: from.z };
    if (a.z !== undefined)  { v = resolve(a.z, st.Q);  if (v !== null) to.z = v; }
    if (a.iz !== undefined) { v = resolve(a.iz, st.Q); if (v !== null) to.z += v; }
    if (!(st.feed > 0)) { fail(st, bi, 'FEED RATE MISSING'); return; }
    emit(st, 'arc', to, st.feed, bi, null, { cx: cx, cy: cy, ccw: ccw, sweep: sw });
    applyM(st, a.m, 'end');
  }

  /* --- RND / CHF: resolved against both neighbours after the run (resolveCorners) --- */
  function doCorner(st, b, bi) {
    var a = b.args, f = null, v;
    if (a.f !== undefined) { f = resolve(a.f, st.Q); if (!(f > 0)) f = null; }   // effective in this block only
    if (b.kind === 'RND') {
      v = resolve(a.r, st.Q);
      if (!(v > 0)) { fail(st, bi, 'ENTRY INCOMPLETE'); return; }
      mark(st, { mark: 'RND', r: v, feed: f, block: bi });
    } else {
      v = resolve(a.len, st.Q);
      if (!(v > 0)) { fail(st, bi, 'ENTRY INCOMPLETE'); return; }
      mark(st, { mark: 'CHF', len: v, feed: f, block: bi });
    }
  }

  /* --- APPR / DEP: geometry is built on the tool-centre path in the contour pass --- */
  function doAppr(st, b, bi) {
    var a = b.args, side = a.rc || 'R0';
    if (st.rc === 'RL' || st.rc === 'RR') { fail(st, bi, 'RADIUS COMP. UNDEFINED'); return; }
    var entryFeed = st.feed;                          // PS -> PH runs at the last programmed feed
    applyM(st, a.m, 'start');
    if (!feedOf(st, a, bi)) return;
    var to = a.polar ? polarTarget(st, a, bi) : targetOf(a, st);
    if (!to) return;
    var hasZ = a.z !== undefined || a.iz !== undefined;
    var mside = flipRc(st, side);
    mark(st, { mark: 'APPR', form: a.form, side: mside, block: bi,
      len: a.len !== undefined ? Math.abs(resolve(a.len, st.Q)) : 0,
      r: a.r !== undefined ? resolve(a.r, st.Q) : 0,
      cca: a.cca !== undefined ? Math.abs(resolve(a.cca, st.Q)) : 0,
      feed: st.feed, entryFeed: entryFeed > 0 ? entryFeed : st.feed,
      from: { x: st.mpos.x, y: st.mpos.y, z: st.mpos.z }, to: toM(st, to), hasZ: hasZ,
      rc: (mside === 'RL' || mside === 'RR') ? mside : null,
      tool: st.tool.t, toolR: st.tool.r, toolDR: st.tool.dr || 0, toolName: st.tool.name,
      spindle: st.spindle, coolant: st.coolant });
    st.rc = side; st.rcAct = false;
    st.pos = { x: to.x, y: to.y, z: to.z }; st.mpos = toM(st, to);
    st.lastTan = null;
    applyM(st, a.m, 'end');
  }
  function doDep(st, b, bi) {
    var a = b.args, side = st.rc;
    applyM(st, a.m, 'start');
    if (!feedOf(st, a, bi)) return;
    var pn = null;
    if (a.form === 'LCT') { pn = a.polar ? polarTarget(st, a, bi) : targetOf(a, st); if (!pn) return; }
    var t = st.lastTan || { x: 1, y: 0 }, s = side === 'RL' ? 1 : -1, len = a.len !== undefined ? Math.abs(resolve(a.len, st.Q)) : 0;
    var m = { mark: 'DEP', form: a.form, side: flipRc(st, side), block: bi, len: len,
      r: a.r !== undefined ? resolve(a.r, st.Q) : 0,
      cca: a.cca !== undefined ? Math.abs(resolve(a.cca, st.Q)) : 0,
      feed: st.feed, to: pn ? toM(st, pn) : null, from: { x: st.mpos.x, y: st.mpos.y, z: st.mpos.z },
      tool: st.tool.t, toolR: st.tool.r, toolDR: st.tool.dr || 0, toolName: st.tool.name,
      spindle: st.spindle, coolant: st.coolant };
    mark(st, m);
    // nominal end point, so incremental blocks after DEP have a reference; the pass fixes the real one
    if (a.form === 'LT') st.pos = { x: st.pos.x + t.x * len, y: st.pos.y + t.y * len, z: st.pos.z };
    else if (a.form === 'LN') st.pos = { x: st.pos.x - t.y * s * len, y: st.pos.y + t.x * s * len, z: st.pos.z };
    else if (a.form === 'LCT') st.pos = { x: pn.x, y: pn.y, z: pn.z };
    st.mpos = toM(st, st.pos);
    st.rc = 'R0'; st.rcAct = false; st.lastTan = null;
    applyM(st, a.m, 'end');
  }

  function doToolDef(st, b) {
    var t = resolve(b.args.t, st.Q); if (t === null) return;
    t = Math.round(t);
    if (b.args.r !== null || b.args.l !== null)
      st.toolDefs[t] = { t: t, name: 'TOOL DEF ' + t, l: b.args.l || 0, r: b.args.r || 0 };
  }

  function doToolCall(st, b, bi) {
    var t = (b.args.t === null || b.args.t === undefined) ? st.tool.t : resolve(b.args.t, st.Q);
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
    if (b.args.f !== undefined && b.args.f !== null) { var tf = resolve(b.args.f, st.Q); if (tf > 0) st.autoFeed = tf; }
    var dr = b.args.dr || 0;                       // DR in TOOL CALL: radius oversize for RL/RR
    if (t === 0) { st.tool = { t: 0, name: '', r: 0, l: 0, dr: dr }; return; }
    var e = st.toolDefs[t] || toolByNumber(t, st.toolTable);
    if (!e && st.autoTools) {                      // opts.autoTools: size the tool from a CAM comment, else R3; no error
      var g2 = st.commentTools && st.commentTools[t];
      e = { t: t, name: 'T' + t + (g2 ? ' (FROM COMMENT)' : ' (AUTO)'), r: g2 ? g2.r : 3, l: 0 };
      st.toolDefs[t] = e;
    }
    if (!e) {
      var guess = st.commentTools && st.commentTools[t];
      fail(st, bi, 'TOOL ' + t + ' NOT DEFINED');
      st.tool = { t: t, name: guess ? 'T' + t + ' (FROM COMMENT)' : 'UNDEFINED', r: guess ? guess.r : 3, l: 0, dr: dr };
    }
    else st.tool = { t: e.t, name: e.name, r: e.r, l: e.l, dr: dr };
    if (!st.toolStat[st.tool.t]) {
      st.toolStat[st.tool.t] = { t: st.tool.t, name: st.tool.name, r: st.tool.r, l: st.tool.l, moves: 0, time: 0 };
      st.toolOrder.push(st.tool.t);
    }
  }

  function doFN(st, b, bi) {                        // FN 0-8, FN 13 and Qn = formula
    var a = b.args, bad = null;
    var v = evalExpr(a.expr, st.Q, function (msg) { bad = msg; });
    if (bad) { fail(st, bi, bad); return; }
    st.Q[b.kind === 'FORMULA' ? a.q : a.target] = v;
  }
  function jumpTaken(st, b, bi) {                   // FN 9 EQU, 10 NE, 11 GT, 12 LT
    var bad = null, err = function (m) { bad = m; };
    var A = evalExpr(b.args.a, st.Q, err), B = evalExpr(b.args.b, st.Q, err);
    if (bad) { fail(st, bi, bad); return false; }
    switch (b.args.op) { case 'EQU': return Math.abs(A - B) < 1e-9; case 'NE': return Math.abs(A - B) >= 1e-9; case 'GT': return A > B; case 'LT': return A < B; }
    return false;
  }

  function execRange(st, from, to, depth) {
    if (depth > MAX_DEPTH) { st.abort = true; fail(st, from, 'EXCESSIVE SUBPROGRAM NESTING'); return; }
    for (var i = from; i <= to && !st.abort && !st.done; i++) {
      var b = st.blocks[i];
      if (!b) continue;
      if (++st.steps > MAX_STEPS) { st.abort = true; fail(st, i, 'EXCESSIVE SUBPROGRAM NESTING'); return; }
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
        case 'CT':  doCT(st, b, i);  if (hasM99(b.args.m)) runCycle(st, i); if (hasEndM(b.args.m)) { st.done = true; return; } break;
        case 'CP':  doCP(st, b, i);  if (hasM99(b.args.m)) runCycle(st, i); if (hasEndM(b.args.m)) { st.done = true; return; } break;
        case 'LP':  doLP(st, b, i);  if (hasM99(b.args.m)) runCycle(st, i); if (hasEndM(b.args.m)) { st.done = true; return; } break;
        case 'CTP': doCTP(st, b, i); if (hasM99(b.args.m)) runCycle(st, i); if (hasEndM(b.args.m)) { st.done = true; return; } break;
        case 'RND': case 'CHF': doCorner(st, b, i); break;
        case 'APPR': doAppr(st, b, i); break;
        case 'DEP':  doDep(st, b, i); if (hasEndM(b.args.m)) { st.done = true; return; } break;
        case 'TOOLDEF': doToolDef(st, b); break;
        case 'C':  doArcC(st, b, i);
          if (hasM99(b.args.m)) runCycle(st, i);
          if (hasEndM(b.args.m)) { st.done = true; return; } break;
        case 'CR': doArcCR(st, b, i);
          if (hasM99(b.args.m)) runCycle(st, i);
          if (hasEndM(b.args.m)) { st.done = true; return; } break;
        case 'CYCLDEF':
          if (PATTERN_CYCLES[b.args.num]) { cyclePattern(st, gatherCycle(st, i), i); break; }   // DEF-active
          st.cycle = gatherCycle(st, i);
          if (!IMPLEMENTED_CYCLES[st.cycle.num] && !NOMOTION_CYCLES[st.cycle.num])
            fail(st, i, 'CYCLE ' + st.cycle.num + ' NOT IMPLEMENTED IN SIMULATOR');
          if (st.cycle.num === 7 || st.cycle.num === 8 || st.cycle.num === 10 || st.cycle.num === 11 || st.cycle.num === 19) {
            applyTransform(st, st.cycle, i); st.cycle = null;   // takes effect here; not called
          }
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
          var rep = Math.round(resolve(b.args.rep, st.Q) || 0);
          if (b.args.repProg && rep < 0) { fail(st, i, 'ARITHMETICAL ERROR'); break; }
          if (!b.args.repProg) rep = 1;
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
            var n = Math.max(1, rep);
            for (var k2 = 0; k2 < n && !st.abort && !st.done; k2++)
              execRange(st, target + 1, end, depth + 1);
          }
          break;
        }
        case 'FN': case 'FORMULA': doFN(st, b, i); break;
        case 'JUMP': {
          if (!jumpTaken(st, b, i)) break;
          var jt = st.labels[b.args.lbl];
          if (jt === undefined) { fail(st, i, 'LABEL NUMBER NOT FOUND'); break; }
          if (jt < from || jt > to) { fail(st, i, 'JUMP TO LABEL NOT PERMITTED'); st.abort = true; return; }
          i = jt;                                       // continue after the label
          break;
        }
        case 'FNERR': fail(st, i, 'FN 14: ERROR ' + b.args.code); st.done = true; return;
        case 'FNNOP': break;
        case 'STOP':
          applyM(st, b.args.m, 'start');
          applyM(st, b.args.m, 'end');
          if (hasEndM(b.args.m)) { st.done = true; return; }
          break;
        default: break;
      }
    }
  }

  /* ---------------------------------------------------------------- 7b. contour pass
     The executor emits the programmed (nominal) contour, tagged RL / RR, plus
     markers for RND, CHF, APPR and DEP. This pass then, in order:
       1. resolves RND / CHF against both neighbouring elements (nominal geometry);
       2. offsets every RL / RR run by the tool radius (R + DR):
          outside corners -> transitional arc about the corner point,
          inside corners  -> intersection of the offset paths,
          activation      -> straight to the offset start of the first element
                             ("perpendicular to the programmed starting position"),
          deactivation    -> from the offset end point to the next R0 target;
       3. builds APPR / DEP on the tool-centre path (TNC 426/430 manual 6.3);
          APPR/DEP with R0 run with tool radius 0 and direction RR, as the manual says.
     Primitives: {type:'line', s, e} or {type:'arc', cx, cy, r, a0, sw, z0, z1}. */

  function P3(p) { return { x: p.x, y: p.y, z: p.z }; }
  function pStart(p) { return p.type === 'line' ? P3(p.s) : { x: p.cx + p.r * Math.cos(p.a0), y: p.cy + p.r * Math.sin(p.a0), z: p.z0 }; }
  function pEnd(p) { if (p.type === 'line') return P3(p.e); var a = p.a0 + p.sw; return { x: p.cx + p.r * Math.cos(a), y: p.cy + p.r * Math.sin(a), z: p.z1 }; }
  function pTan(p, atEnd) {
    if (p.type === 'line') { var dx = p.e.x - p.s.x, dy = p.e.y - p.s.y, l = Math.sqrt(dx * dx + dy * dy); return l > 1e-12 ? { x: dx / l, y: dy / l } : null; }
    var a = p.a0 + (atEnd ? p.sw : 0), d = p.sw >= 0 ? 1 : -1;
    return { x: -Math.sin(a) * d, y: Math.cos(a) * d };
  }
  function planar(p) { return p.type === 'arc' || Math.abs(p.e.x - p.s.x) + Math.abs(p.e.y - p.s.y) > 1e-9; }
  function dirAngle(a0, a1, dir) {
    var d = a1 - a0;
    if (dir > 0) { while (d < 0) d += 2 * Math.PI; while (d >= 2 * Math.PI) d -= 2 * Math.PI; }
    else { while (d > 0) d -= 2 * Math.PI; while (d <= -2 * Math.PI) d += 2 * Math.PI; }
    return d;
  }
  function primOf(mv) {
    if (mv.kind === 'arc' && mv.cx !== null && mv.cx !== undefined) {
      var r = Math.sqrt((mv.from.x - mv.cx) * (mv.from.x - mv.cx) + (mv.from.y - mv.cy) * (mv.from.y - mv.cy));
      var sw = (mv.sweep !== null && mv.sweep !== undefined) ? mv.sweep : sweepAngle(mv.from, mv.to, mv.cx, mv.cy, mv.ccw);
      return { type: 'arc', cx: mv.cx, cy: mv.cy, r: r, a0: Math.atan2(mv.from.y - mv.cy, mv.from.x - mv.cx), sw: sw, z0: mv.from.z, z1: mv.to.z };
    }
    return { type: 'line', s: P3(mv.from), e: P3(mv.to) };
  }
  function setEndP(p, pt) {
    if (p.type === 'line') { p.e = P3(pt); return; }
    var d = p.sw >= 0 ? 1 : -1, old = p.sw, rem = dirAngle(p.a0, Math.atan2(pt.y - p.cy, pt.x - p.cx), d);
    var turns = Math.max(0, Math.round((old - rem) / (d * 2 * Math.PI)));
    p.sw = rem + d * 2 * Math.PI * turns; p.z1 = pt.z;
  }
  function setStartP(p, pt) {
    if (p.type === 'line') { p.s = P3(pt); return; }
    var endA = p.a0 + p.sw, d = p.sw >= 0 ? 1 : -1, old = p.sw;
    p.a0 = Math.atan2(pt.y - p.cy, pt.x - p.cx);
    var rem = dirAngle(p.a0, endA, d), turns = Math.max(0, Math.round((old - rem) / (d * 2 * Math.PI)));
    p.sw = rem + d * 2 * Math.PI * turns; p.z0 = pt.z;
  }
  /* offset to the left (s=+1) or right (s=-1) of the direction of travel */
  function offsetP(p, s, R) {
    if (p.type === 'line') {
      var t = pTan(p, false); if (!t) return null;
      var nx = -t.y * s * R, ny = t.x * s * R;
      return { type: 'line', s: { x: p.s.x + nx, y: p.s.y + ny, z: p.s.z }, e: { x: p.e.x + nx, y: p.e.y + ny, z: p.e.z } };
    }
    var d = p.sw >= 0 ? 1 : -1, r = p.r - s * d * R;
    if (r < -1e-9) return { type: 'invalid' };
    return { type: 'arc', cx: p.cx, cy: p.cy, r: Math.max(r, 0), a0: p.a0, sw: p.sw, z0: p.z0, z1: p.z1 };
  }
  function onP(pt, p, tol) {
    tol = tol || 1e-6;
    if (p.type === 'line') {
      var dx = p.e.x - p.s.x, dy = p.e.y - p.s.y, l2 = dx * dx + dy * dy;
      if (l2 < 1e-18) return Math.hypot(pt.x - p.s.x, pt.y - p.s.y) <= tol;
      var u = ((pt.x - p.s.x) * dx + (pt.y - p.s.y) * dy) / l2;
      return u >= -tol / Math.sqrt(l2) && u <= 1 + tol / Math.sqrt(l2) && Math.hypot(p.s.x + dx * u - pt.x, p.s.y + dy * u - pt.y) <= tol;
    }
    if (Math.abs(Math.hypot(pt.x - p.cx, pt.y - p.cy) - p.r) > tol) return false;
    if (Math.abs(p.sw) >= 2 * Math.PI - 1e-9) return true;
    var d = p.sw >= 0 ? 1 : -1, rel = dirAngle(p.a0, Math.atan2(pt.y - p.cy, pt.x - p.cx), d);
    return Math.abs(rel) <= Math.abs(p.sw) + tol / Math.max(p.r, 1e-9);
  }
  /* intersections of the supporting line / circle of two primitives */
  function isect(a, b) {
    var out = [];
    if (a.type === 'arc' && b.type === 'line') return isect(b, a);
    if (a.type === 'line' && b.type === 'line') {
      var rx = a.e.x - a.s.x, ry = a.e.y - a.s.y, sx = b.e.x - b.s.x, sy = b.e.y - b.s.y, den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) return out;
      var t = ((b.s.x - a.s.x) * sy - (b.s.y - a.s.y) * sx) / den;
      out.push({ x: a.s.x + rx * t, y: a.s.y + ry * t, z: a.e.z }); return out;
    }
    if (a.type === 'line') {
      var dx = a.e.x - a.s.x, dy = a.e.y - a.s.y, fx = a.s.x - b.cx, fy = a.s.y - b.cy;
      var qa = dx * dx + dy * dy, qb = 2 * (fx * dx + fy * dy), qc = fx * fx + fy * fy - b.r * b.r, disc = qb * qb - 4 * qa * qc;
      if (qa < 1e-18 || disc < -1e-9) return out;
      disc = Math.sqrt(Math.max(0, disc));
      [(-qb - disc) / (2 * qa), (-qb + disc) / (2 * qa)].forEach(function (u) { out.push({ x: a.s.x + dx * u, y: a.s.y + dy * u, z: a.e.z }); });
      return out;
    }
    var ddx = b.cx - a.cx, ddy = b.cy - a.cy, D = Math.hypot(ddx, ddy);
    if (D < 1e-12 || D > a.r + b.r + 1e-9 || D < Math.abs(a.r - b.r) - 1e-9) return out;
    var x = (a.r * a.r - b.r * b.r + D * D) / (2 * D), h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
    var ux = ddx / D, uy = ddy / D, px = a.cx + ux * x, py = a.cy + uy * x;
    out.push({ x: px - uy * h, y: py + ux * h, z: a.z1 }); out.push({ x: px + uy * h, y: py - ux * h, z: a.z1 });
    return out;
  }
  function nearest(cands, ref, p, q) {
    var best = null, bd = Infinity;
    for (var i = 0; i < cands.length; i++) {
      if (p && !onP(cands[i], p, 1e-5)) continue;
      if (q && !onP(cands[i], q, 1e-5)) continue;
      var d = Math.hypot(cands[i].x - ref.x, cands[i].y - ref.y);
      if (d < bd) { bd = d; best = cands[i]; }
    }
    return best;
  }
  /* primitive -> move, copying tool / spindle / block data from a template move */
  function moveFrom(p, tpl, extra) {
    var mv = { kind: tpl.kind === 'arc' ? 'feed' : tpl.kind, from: pStart(p), to: pEnd(p), cx: null, cy: null, ccw: false, sweep: null,
      feed: tpl.feed, tool: tpl.tool, toolR: tpl.toolR, toolDR: tpl.toolDR || 0, toolL: tpl.toolL, stick: tpl.stick, toolName: tpl.toolName, spindle: tpl.spindle,
      coolant: tpl.coolant, block: tpl.block, cycle: tpl.cycle || null, rc: null, rcAct: false, len: 0,
      rot0: tpl.rot1 || tpl.rot0 || null, rot1: tpl.rot1 || null, dur: null };
    if (p.type === 'arc') {
      mv.kind = 'arc'; mv.cx = p.cx; mv.cy = p.cy; mv.ccw = p.sw > 0; mv.sweep = p.sw;
      if (tpl.kind === 'rapid') mv.feed = RAPID_RATE;
      mv.len = Math.sqrt(p.r * p.sw * p.r * p.sw + (p.z1 - p.z0) * (p.z1 - p.z0));
    } else mv.len = dist3(mv.from, mv.to);
    if (extra) for (var k in extra) mv[k] = extra[k];
    if (p.type === 'arc') mv.kind = 'arc';
    return mv;
  }
  function lineP(a, b) { return { type: 'line', s: P3(a), e: P3(b) }; }
  function arcP(cx, cy, r, a0, sw, z0, z1) { return { type: 'arc', cx: cx, cy: cy, r: r, a0: a0, sw: sw, z0: z0, z1: z1 }; }

  /* ---- 1. RND / CHF ---- */
  function resolveCorners(st, mv) {
    for (var k = 0; k < mv.length; k++) {
      var m = mv[k];
      if (m.kind !== 'mark' || (m.mark !== 'RND' && m.mark !== 'CHF')) continue;
      var A = mv[k - 1], B = mv[k + 1];
      var ok = A && B && A.kind !== 'mark' && B.kind !== 'mark';
      if (!ok) { fail(st, m.block, m.mark === 'CHF' ? 'CHAMFER NOT PERMITTED' : 'ROUNDING-OFF NOT PERMITTED'); mv.splice(k, 1); k--; continue; }
      var p = primOf(A), q = primOf(B);
      if (!planar(p) || !planar(q)) { fail(st, m.block, m.mark === 'CHF' ? 'CHAMFER NOT PERMITTED' : 'ROUNDING-OFF NOT PERMITTED'); mv.splice(k, 1); k--; continue; }
      var t1 = pTan(p, true), t2 = pTan(q, false), cross = t1.x * t2.y - t1.y * t2.x, P = pEnd(p);
      var feed = m.feed || A.feed, ins;
      if (m.mark === 'CHF') {
        if (p.type !== 'line' || q.type !== 'line') { fail(st, m.block, 'CHAMFER NOT PERMITTED'); mv.splice(k, 1); k--; continue; }
        var L1 = Math.hypot(p.e.x - p.s.x, p.e.y - p.s.y), L2 = Math.hypot(q.e.x - q.s.x, q.e.y - q.s.y);
        if (m.len > L1 + 1e-9 || m.len > L2 + 1e-9) { fail(st, m.block, 'CHAMFER NOT PERMITTED'); mv.splice(k, 1); k--; continue; }
        var T1 = { x: P.x - t1.x * m.len, y: P.y - t1.y * m.len, z: p.s.z + (p.e.z - p.s.z) * (1 - m.len / L1) };
        var T2 = { x: P.x + t2.x * m.len, y: P.y + t2.y * m.len, z: P.z };
        setEndP(p, T1); setStartP(q, T2);
        ins = lineP(T1, T2);
      } else {
        if (Math.abs(cross) < 1e-9) { mv.splice(k, 1); k--; continue; }        // tangential already: nothing to round
        var s = cross > 0 ? 1 : -1, op = offsetP(p, s, m.r), oq = offsetP(q, s, m.r);
        var C = (op && oq && op.type !== 'invalid' && oq.type !== 'invalid') ? nearest(isect(op, oq), P) : null;
        var F1 = C && foot(C, p), F2 = C && foot(C, q);
        if (!C || !F1 || !F2 || !onP(F1, p, 1e-5) || !onP(F2, q, 1e-5)) { fail(st, m.block, 'ROUNDING-OFF RADIUS TOO LARGE'); mv.splice(k, 1); k--; continue; }
        F1.z = P.z; F2.z = P.z;
        setEndP(p, F1); setStartP(q, F2);
        var a0 = Math.atan2(F1.y - C.y, F1.x - C.x), a1 = Math.atan2(F2.y - C.y, F2.x - C.x);
        ins = arcP(C.x, C.y, m.r, a0, dirAngle(a0, a1, s), P.z, P.z);
      }
      var nA = moveFrom(p, A, { rc: A.rc, rcAct: A.rcAct }), nB = moveFrom(q, B, { rc: B.rc, rcAct: B.rcAct });
      var nI = moveFrom(ins, { kind: (A.kind === 'rapid' && B.kind === 'rapid') ? 'rapid' : 'feed', feed: feed, tool: A.tool, toolR: A.toolR, toolDR: A.toolDR,
        toolName: A.toolName, spindle: A.spindle, coolant: A.coolant, block: m.block }, { rc: B.rc });
      mv.splice(k - 1, 3, nA, nI, nB);
    }
  }
  /* foot of the perpendicular from a fillet centre onto a primitive's support */
  function foot(C, p) {
    if (p.type === 'line') {
      var dx = p.e.x - p.s.x, dy = p.e.y - p.s.y, l2 = dx * dx + dy * dy; if (l2 < 1e-18) return null;
      var u = ((C.x - p.s.x) * dx + (C.y - p.s.y) * dy) / l2;
      return { x: p.s.x + dx * u, y: p.s.y + dy * u, z: p.s.z };
    }
    var vx = C.x - p.cx, vy = C.y - p.cy, l = Math.hypot(vx, vy); if (l < 1e-12) return null;
    return { x: p.cx + vx / l * p.r, y: p.cy + vy / l * p.r, z: p.z0 };
  }

  /* ---- 3. APPR / DEP plans, on the tool-centre path ---- */
  function lctArc(ext, cp, t, R, cs, approach) {
    // arc of radius R tangent to the contour at cp (centre on side cs), and a line from/to ext tangent to it
    var cx = cp.x - t.y * cs * R, cy = cp.y + t.x * cs * R;
    var vx = ext.x - cx, vy = ext.y - cy, d2 = vx * vx + vy * vy;
    if (d2 < R * R - 1e-9) return null;
    var base = R * R / d2, sc = R * Math.sqrt(Math.max(0, d2 - R * R)) / d2;
    var cands = [{ x: cx + base * vx - sc * vy, y: cy + base * vy + sc * vx }, { x: cx + base * vx + sc * vy, y: cy + base * vy - sc * vx }];
    for (var i = 0; i < 2; i++) {
      var h = cands[i], lx = approach ? h.x - ext.x : ext.x - h.x, ly = approach ? h.y - ext.y : ext.y - h.y, ll = Math.hypot(lx, ly);
      var rx = (h.x - cx) / R, ry = (h.y - cy) / R, tx = -ry * cs, ty = rx * cs;       // arc travel direction at h
      if (ll < 1e-9 || (lx * tx + ly * ty) / ll > 1 - 1e-6) {
        var ha = Math.atan2(h.y - cy, h.x - cx), ca = Math.atan2(cp.y - cy, cp.x - cx);
        var sw = approach ? dirAngle(ha, ca, cs) : dirAngle(ca, ha, cs);
        return { h: { x: h.x, y: h.y, z: cp.z }, arc: arcP(cx, cy, R, approach ? ha : ca, sw, cp.z, cp.z) };
      }
    }
    return null;
  }
  function apprPlan(m, PA, t, side) {
    var s = side === 'RL' ? 1 : -1, PS = m.from, prims = [], H;
    if (m.form === 'LT') { H = { x: PA.x - t.x * m.len, y: PA.y - t.y * m.len, z: PA.z }; prims.push(['entry', H]); prims.push(['el', lineP(H, PA)]); }
    else if (m.form === 'LN') { H = { x: PA.x - t.y * s * m.len, y: PA.y + t.x * s * m.len, z: PA.z }; prims.push(['entry', H]); prims.push(['el', lineP(H, PA)]); }
    else if (m.form === 'CT') {
      var R = Math.abs(m.r), d = s * (m.r < 0 ? -1 : 1);          // R>0: approach from the compensation side
      var cx = PA.x - t.y * d * R, cy = PA.y + t.x * d * R, ea = Math.atan2(PA.y - cy, PA.x - cx);
      var sw = d * m.cca * Math.PI / 180, sa = ea - sw;           // arc ends at PA, turning in direction d
      H = { x: cx + R * Math.cos(sa), y: cy + R * Math.sin(sa), z: PA.z };
      prims.push(['entry', H]); prims.push(['el', arcP(cx, cy, R, sa, sw, PA.z, PA.z)]);
    } else if (m.form === 'LCT') {
      var L = lctArc({ x: PS.x, y: PS.y, z: PA.z }, PA, t, Math.abs(m.r), s, true);
      if (!L) return null;
      prims.push(['lct', L.h]); prims.push(['el', L.arc]);
    } else return null;
    return prims;
  }
  function emitAppr(out, m, plan, tpl) {
    var PS = m.from, H = plan[0][1], el = plan[1][1];
    var entryFeed = plan[0][0] === 'lct' ? m.feed : m.entryFeed;
    out.push(moveFrom(lineP(PS, { x: H.x, y: H.y, z: PS.z }), tpl, { kind: 'feed', feed: entryFeed, block: m.block }));
    if (Math.abs(PS.z - H.z) > 1e-9)          // APPR with Z: in the plane to PH first, then to depth
      out.push(moveFrom(lineP({ x: H.x, y: H.y, z: PS.z }, H), tpl, { kind: 'feed', feed: m.feed, block: m.block }));
    out.push(moveFrom(el, tpl, { kind: 'feed', feed: m.feed, block: m.block }));
  }
  function depPlan(m, PE, t, side) {
    var s = side === 'RL' ? 1 : -1, prims = [];
    if (m.form === 'LT') prims.push(lineP(PE, { x: PE.x + t.x * m.len, y: PE.y + t.y * m.len, z: PE.z }));
    else if (m.form === 'LN') prims.push(lineP(PE, { x: PE.x - t.y * s * m.len, y: PE.y + t.x * s * m.len, z: PE.z }));
    else if (m.form === 'CT') {
      var R = Math.abs(m.r), d = s * (m.r < 0 ? -1 : 1);
      var cx = PE.x - t.y * d * R, cy = PE.y + t.x * d * R, a0 = Math.atan2(PE.y - cy, PE.x - cx);
      prims.push(arcP(cx, cy, R, a0, d * m.cca * Math.PI / 180, PE.z, PE.z));
    } else if (m.form === 'LCT') {
      var L = lctArc({ x: m.to.x, y: m.to.y, z: PE.z }, PE, t, Math.abs(m.r), s, false);
      if (!L) return null;
      prims.push(L.arc); prims.push(lineP(L.h, { x: m.to.x, y: m.to.y, z: PE.z }));
      if (Math.abs(m.to.z - PE.z) > 1e-9) prims.push(lineP({ x: m.to.x, y: m.to.y, z: PE.z }, m.to));
    } else return null;
    return prims;
  }
  /* after a run or a DEP: the next move starts where the tool really is; pure Z moves keep that XY */
  function carryXY(mv, j, end) {
    var nx = mv[j]; if (!nx || nx.kind === 'mark') return;
    var pureZ = Math.abs(nx.to.x - nx.from.x) < 1e-9 && Math.abs(nx.to.y - nx.from.y) < 1e-9 && nx.kind !== 'arc';
    var ox = nx.from.x, oy = nx.from.y;
    nx.from = P3(end);
    if (pureZ) {
      nx.to.x = end.x; nx.to.y = end.y;
      for (var k = j + 1; k < mv.length; k++) {           // following moves that still sit on the old nominal XY
        var f = mv[k]; if (f.kind === 'mark' || f.kind === 'arc') break;
        if (Math.abs(f.from.x - ox) > 1e-9 || Math.abs(f.from.y - oy) > 1e-9) break;
        f.from.x = end.x; f.from.y = end.y;
        if (Math.abs(f.to.x - ox) < 1e-9 && Math.abs(f.to.y - oy) < 1e-9) { f.to.x = end.x; f.to.y = end.y; f.len = dist3(f.from, f.to); } else { f.len = dist3(f.from, f.to); break; }
      }
    }
    if (nx.kind === 'arc') { var p = primOf(nx); setStartP(p, end); mv[j] = moveFrom(p, nx, { rc: nx.rc }); }
    else nx.len = dist3(nx.from, nx.to);
  }

  /* ---- 2. radius compensation runs ---- */
  function compRun(st, mv, a, b) {
    var head = mv[a], side = head.rc, s = side === 'RL' ? 1 : -1;
    var appr = head.kind === 'mark' ? head : null;
    var R = (head.toolR || 0) + (head.toolDR || 0);
    var body = mv.slice(appr ? a + 1 : a + 1, b + 1);       // elements after the activation block / APPR
    if (!(R >= 0)) { fail(st, head.block, 'TOOL RADIUS TOO LARGE'); return null; }
    var items = body.map(function (m) { var p = primOf(m); return { m: m, nom: p, off: planar(p) ? offsetP(p, s, R) : null }; });
    var xy = items.filter(function (it) { return it.off; });
    for (var i = 0; i < xy.length; i++)
      if (xy[i].off.type === 'invalid') { fail(st, xy[i].m.block, 'TOOL RADIUS TOO LARGE'); return null; }
    if (!xy.length) {
      if (appr) fail(st, head.block, 'TANGENTIAL CONNECTION NOT POSSIBLE');
      return null;                                           // RL/RR with no contour after it: leave nominal
    }
    var trans = {};
    for (i = 0; i < xy.length - 1; i++) {
      var L = xy[i], Rt = xy[i + 1], p = L.off, q = Rt.off;
      var corner = pEnd(L.nom);
      var t1 = pTan(L.nom, true), t2 = pTan(Rt.nom, false), cross = t1.x * t2.y - t1.y * t2.x, dot = t1.x * t2.x + t1.y * t2.y;
      if (Math.abs(cross) < 1e-9 && dot > 0) { var sn = pEnd(p); setEndP(p, sn); setStartP(q, sn); continue; }   // tangential
      if (s * cross < 0 || (Math.abs(cross) < 1e-9 && dot < 0)) {                                                  // outside corner
        var f = pEnd(p), g = pStart(q), aa0 = Math.atan2(f.y - corner.y, f.x - corner.x), aa1 = Math.atan2(g.y - corner.y, g.x - corner.x);
        var dir = Math.abs(cross) < 1e-9 ? -s : (cross > 0 ? 1 : -1);
        if (R > 1e-9) trans[i] = arcP(corner.x, corner.y, R, aa0, dirAngle(aa0, aa1, dir), f.z, g.z);
      } else {                                                                                                    // inside corner
        var X = nearest(isect(p, q), pEnd(p), p, q);
        if (!X) { fail(st, Rt.m.block, 'TOOL RADIUS TOO LARGE'); return null; }
        X.z = corner.z; setEndP(p, X); setStartP(q, X);
      }
    }
    var out = [], first = pStart(xy[0].off), cur;
    if (appr) {
      var plan = apprPlan(appr, first, pTan(xy[0].off, false), side);
      if (!plan) { fail(st, appr.block, 'TANGENTIAL CONNECTION NOT POSSIBLE'); return null; }
      emitAppr(out, appr, plan, appr);
      cur = first;
    } else {
      var act = { x: first.x, y: first.y, z: head.to.z };   // activation: perpendicular to the first element
      out.push(moveFrom(lineP(head.from, act), head, { rc: side }));
      cur = act;
    }
    var xi = 0;
    for (i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.off) {                                         // tool-axis move inside the run: keep the offset XY
        var vz = { x: cur.x, y: cur.y, z: it.nom.e.z };
        if (Math.abs(vz.z - cur.z) > 1e-9) out.push(moveFrom(lineP(cur, vz), it.m, { rc: side }));
        cur = vz; continue;
      }
      var op = it.off; if (Math.abs(pStart(op).z - cur.z) > 1e-9 && op.type === 'line') op.s.z = cur.z;
      out.push(moveFrom(op, it.m, { rc: side })); cur = pEnd(op);
      if (trans[xi]) { out.push(moveFrom(trans[xi], it.m, { rc: side })); cur = pEnd(trans[xi]); }
      xi++;
    }
    return { out: out, end: cur, tan: pTan(xy[xy.length - 1].off, true) };
  }

  function contourPass(st) {
    var mv = st.moves;
    if (!mv.some(function (m) { return m.kind === 'mark' || m.rc; })) return;
    resolveCorners(st, mv);
    for (var i = 0; i < mv.length; i++) {
      var m = mv[i];
      var runHead = (m.rc === 'RL' || m.rc === 'RR') && (m.rcAct || (m.kind === 'mark' && m.mark === 'APPR'));
      var r0appr = m.kind === 'mark' && m.mark === 'APPR' && !m.rc;
      if (runHead) {
        var j = i + 1;
        while (j < mv.length && mv[j].kind !== 'mark' && mv[j].rc === m.rc && !mv[j].rcAct) j++;
        var res = compRun(st, mv, i, j - 1);
        if (!res) { if (m.kind === 'mark') { mv.splice(i, 1); i--; } continue; }
        var dep = mv[j] && mv[j].kind === 'mark' && mv[j].mark === 'DEP' ? mv[j] : null, depOut = [], end = res.end;
        if (dep) {
          var dp = depPlan(dep, res.end, res.tan, m.rc);
          if (!dp) fail(st, dep.block, 'TANGENTIAL CONNECTION NOT POSSIBLE');
          else { dp.forEach(function (p) { depOut.push(moveFrom(p, dep, { kind: 'feed', feed: dep.feed })); }); end = pEnd(dp[dp.length - 1]); }
        }
        var repl = res.out.concat(depOut);
        mv.splice.apply(mv, [i, j - i + (dep ? 1 : 0)].concat(repl));
        carryXY(mv, i + repl.length, end);
        i += repl.length - 1;
      } else if (r0appr) {                                   // APPR with R0: radius 0, direction RR
        var nx = mv[i + 1] && mv[i + 1].kind !== 'mark' ? mv[i + 1] : null;
        var t = nx && pTan(primOf(nx), false);
        var plan = t && apprPlan(m, m.to, t, 'RR');
        if (!plan) { fail(st, m.block, 'TANGENTIAL CONNECTION NOT POSSIBLE'); mv.splice(i, 1); i--; continue; }
        var o = []; emitAppr(o, m, plan, m);
        mv.splice.apply(mv, [i, 1].concat(o)); i += o.length - 1;
      } else if (m.kind === 'mark' && m.mark === 'DEP') {   // DEP without compensation: radius 0, direction RR
        var pv = i > 0 && mv[i - 1].kind !== 'mark' ? mv[i - 1] : null;
        var tt = pv && pTan(primOf(pv), true);
        var dq = tt && depPlan(m, pv.to, tt, m.side === 'RL' ? 'RL' : 'RR');
        if (!dq) { fail(st, m.block, 'TANGENTIAL CONNECTION NOT POSSIBLE'); mv.splice(i, 1); i--; continue; }
        var o2 = dq.map(function (p) { return moveFrom(p, m, { kind: 'feed', feed: m.feed }); });
        mv.splice.apply(mv, [i, 1].concat(o2));
        carryXY(mv, i + o2.length, pEnd(dq[dq.length - 1]));
        i += o2.length - 1;
      }
    }
    for (i = mv.length - 1; i >= 0; i--) if (mv[i].kind === 'mark' || (!(mv[i].len > EPS) && !mv[i].rcAct)) mv.splice(i, 1);
    for (i = mv.length - 1; i >= 0; i--) if (!(mv[i].len > EPS)) mv.splice(i, 1);
  }

  /* ---------------------------------------------------------------- 8. compile */

  /* opts.tools: the machine's tool table (TOOL.T); defaults to the built-in one */
  function compile(blocks, opts) {
    blocks = blocks || [];
    var i;
    // reset any state a previous compile() left on the blocks
    for (i = 0; i < blocks.length; i++) {
      if (!blocks[i]) continue;
      blocks[i].error = Object.prototype.hasOwnProperty.call(blocks[i], '__perr') ? blocks[i].__perr : null;
    }

    var st = newState(blocks);
    st.toolTable = (opts && opts.tools) || TOOLS;
    /* opts.machine: the machine parameters that change interpreter results (see MACHINE_430 in ui.js)
       arcTol (MP 7431), pocketK (MP 7430), fMax (MP 1020), rapid {x,y,z,a,b} (MP 1010), accel (MP 1060),
       axes, limits {A:[min,max], ...} (MP 910/920), sMax (MP 3515) */
    st.mach = (opts && opts.machine) || {};
    st.arcTol = st.mach.arcTol || ARC_TOL;
    /* opts.holder: {len, stack(r)} — TOOL HOLDER LENGTH is the gauge length used when a tool has L = 0;
       stack(r) = holder height below the spindle face, so stick-out = L - stack(r) */
    st.holder = (opts && opts.holder) || null;
    st.autoTools = !!(opts && opts.autoTools);

    // label table
    st.labels = {};
    for (i = 0; i < blocks.length; i++)
      if (blocks[i] && blocks[i].kind === 'LBL' && st.labels[blocks[i].args.lbl] === undefined)
        st.labels[blocks[i].args.lbl] = i;

    // tool radii from CAM comments (";T5 D=+8 ..."), used only to draw tools missing from the table
    st.commentTools = {};
    for (i = 0; i < blocks.length; i++) {
      var cm = blocks[i] && blocks[i].args && blocks[i].args.comment, tm;
      if (cm && (tm = /^T(\d+)\s+D=\s*([+-]?\d+\.?\d*)/i.exec(cm))) st.commentTools[+tm[1]] = { r: Math.abs(parseFloat(tm[2])) / 2 };
    }

    execRange(st, 0, blocks.length - 1, 0);
    contourPass(st);

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
      var t = (mv.dur != null) ? mv.dur : ((f > 0) ? (mv.len / f) * 60 : 0);
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
      errors: st.errors,
      machine: st.mach
    };
  }

  function run(text, opts) {
    var p = parse(text);
    var c = compile(p.blocks, opts);
    return {
      blocks: p.blocks,
      moves: c.moves,
      stock: c.stock,
      stats: c.stats,
      machine: c.machine,
      errors: p.errors.concat(c.errors)
    };
  }

  return { parse: parse, compile: compile, run: run, TOOLS: TOOLS };
})();

if (typeof module !== 'undefined') module.exports = TNC;
