/* ============================================================
   TNC_PART — the "interim 3-D model" for AI generation: a part spec (what the finished part should
   look like) turned into a target height field, and the program's real result measured against it.
   Pure: no DOM, no three.js. Runs in the browser (ai.js / ui.js) and in node (tests, AI bench).

   The loop it serves (ai.js generate): the model first PLANS the part as a spec, the spec is EXPANDED
   here (lettering becomes exact stroke paths, every feature gets checked against the tool table), the
   model WRITES the program from that, the simulator runs it, and COMPARE measures what the program
   actually cuts against the target — per feature, in mm — and that measurement goes back to the model.

   TNC_PART.parse(text)                    -> {spec} | {error}     the ```partspec JSON from a model answer
   TNC_PART.expand(spec, tools)            -> {spec, sheet, notes}  text -> engrave strokes; tool feasibility
   TNC_PART.strokes(text, o)               -> [[[x,y],..],..]       single-stroke capitals (engraving font)
   TNC_PART.target(spec, stock, g)         -> {hm, own}             target top surface per column
   TNC_PART.carve(res, ex, g)              -> Float32Array          what the program removes (stock.js)
   TNC_PART.compare(spec, res, ex, o)      -> report {score, text, features, ...}

   Spec (mm, datum and BLK FORM as in the program; z = the floor the feature leaves, top face Z+0):
     {"blank":{"x":[0,120],"y":[0,80],"z":[-15,0]},
      "features":[
        {"id":"F1","type":"face","z":-0.5},
        {"id":"P1","type":"pocket","shape":"rect","x":[30,90],"y":[25,55],"r":3,"z":-6},
        {"id":"P2","type":"pocket","shape":"circle","x":60,"y":40,"d":30,"z":-5},
        {"id":"P3","type":"pocket","shape":"poly","points":[[x,y],..],"z":-4},
        {"id":"H1","type":"hole","x":10,"y":10,"d":8.5,"z":-20},
        {"id":"S1","type":"slot","from":[10,40],"to":[50,40],"w":6,"z":-3},
        {"id":"E1","type":"engrave","path":[[x,y],..],"w":3,"z":-1},
        {"id":"T1","type":"text","text":"HELLO","x":20,"y":30,"h":20,"w":3,"z":-1.5,"align":"left"},
        {"id":"O1","type":"profile","points":[[x,y],..],"z":-10}      (outside the outline cut down to z)
      ]}
   ============================================================ */
var TNC_PART = (function () {
  'use strict';
  var STOCK = (typeof TNC_STOCK !== 'undefined' && TNC_STOCK) || (typeof require !== 'undefined' ? require('./stock.js') : null);

  /* ---------- single-stroke engraving capitals: 4 wide × 6 high units, straight strokes with 45° corners ----------
     Written for this simulator (no third-party font). Tool-centre paths: the groove is as wide as the cutter. */
  var O_ = [[1, 0], [0, 1], [0, 5], [1, 6], [3, 6], [4, 5], [4, 1], [3, 0], [1, 0]];
  var A_ = [[[0, 0], [0, 4], [2, 6], [4, 4], [4, 0]], [[0, 3], [4, 3]]];
  var FONT = {
    A: A_,
    B: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [0, 0]]],
    C: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1]]],
    D: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 1], [3, 0], [0, 0]]],
    E: [[[4, 6], [0, 6], [0, 0], [4, 0]], [[0, 3], [3, 3]]],
    F: [[[4, 6], [0, 6], [0, 0]], [[0, 3], [3, 3]]],
    G: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 3], [2, 3]]],
    H: [[[0, 0], [0, 6]], [[4, 0], [4, 6]], [[0, 3], [4, 3]]],
    I: [[[1, 6], [3, 6]], [[2, 6], [2, 0]], [[1, 0], [3, 0]]],
    J: [[[4, 6], [4, 1], [3, 0], [1, 0], [0, 1]]],
    K: [[[0, 0], [0, 6]], [[4, 6], [0, 2]], [[1.5, 3.5], [4, 0]]],
    L: [[[0, 6], [0, 0], [4, 0]]],
    M: [[[0, 0], [0, 6], [2, 3], [4, 6], [4, 0]]],
    N: [[[0, 0], [0, 6], [4, 0], [4, 6]]],
    O: [O_],
    P: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]]],
    Q: [O_, [[2.5, 1.5], [4, 0]]],
    R: [[[0, 0], [0, 6], [3, 6], [4, 5], [4, 4], [3, 3], [0, 3]], [[2, 3], [4, 0]]],
    S: [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
    T: [[[0, 6], [4, 6]], [[2, 6], [2, 0]]],
    U: [[[0, 6], [0, 1], [1, 0], [3, 0], [4, 1], [4, 6]]],
    V: [[[0, 6], [2, 0], [4, 6]]],
    W: [[[0, 6], [1, 0], [2, 4], [3, 0], [4, 6]]],
    X: [[[0, 0], [4, 6]], [[0, 6], [4, 0]]],
    Y: [[[0, 6], [2, 3], [4, 6]], [[2, 3], [2, 0]]],
    Z: [[[0, 6], [4, 6], [0, 0], [4, 0]]],
    '0': [O_, [[0, 1], [4, 5]]],
    '1': [[[1, 5], [2, 6], [2, 0]], [[1, 0], [3, 0]]],
    '2': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [0, 0], [4, 0]]],
    '3': [[[0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1.5, 3]], [[3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
    '4': [[[3, 0], [3, 6], [0, 2], [4, 2]]],
    '5': [[[4, 6], [0, 6], [0, 3], [3, 3], [4, 2], [4, 1], [3, 0], [1, 0], [0, 1]]],
    '6': [[[4, 5], [3, 6], [1, 6], [0, 5], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3], [0, 3]]],
    '7': [[[0, 6], [4, 6], [1, 0]]],
    '8': [[[1, 3], [0, 4], [0, 5], [1, 6], [3, 6], [4, 5], [4, 4], [3, 3], [1, 3], [0, 2], [0, 1], [1, 0], [3, 0], [4, 1], [4, 2], [3, 3]]],
    '9': [[[0, 1], [1, 0], [3, 0], [4, 1], [4, 5], [3, 6], [1, 6], [0, 5], [0, 4], [1, 3], [4, 3]]],
    '-': [[[1, 3], [3, 3]]],
    '+': [[[0.5, 3], [3.5, 3]], [[2, 1.5], [2, 4.5]]],
    '.': [[[2, 0], [2, 0.3]]],
    '/': [[[0, 0], [4, 6]]],
    '&': [[[4, 0], [1, 4], [1, 5], [2, 6], [3, 5], [3, 4], [0, 1.5], [0, 1], [1, 0], [2, 0], [4, 2]]]
  };
  FONT['Ä'] = A_.concat([[[1, 7], [1, 7.3]], [[3, 7], [3, 7.3]]]);
  FONT['Å'] = A_.concat([[[2, 6.6], [2.5, 7.1], [2, 7.6], [1.5, 7.1], [2, 6.6]]]);
  FONT['Ö'] = [O_, [[1, 7], [1, 7.3]], [[3, 7], [3, 7.3]]];
  FONT['Ü'] = FONT.U.concat([[[1, 7], [1, 7.3]], [[3, 7], [3, 7.3]]]);
  ['Č', 'Ć'].forEach(function (c) { FONT[c] = FONT.C.concat([[[1.5, 7.4], [2, 6.9], [2.5, 7.4]]]); });
  FONT['Š'] = FONT.S.concat([[[1.5, 7.4], [2, 6.9], [2.5, 7.4]]]);
  FONT['Ž'] = FONT.Z.concat([[[1.5, 7.4], [2, 6.9], [2.5, 7.4]]]);
  FONT['Đ'] = FONT.D.concat([[[-0.5, 3], [1.5, 3]]]);
  var NARROW = { I: 4, '1': 4, '.': 4, '-': 4 };

  /* text -> stroke polylines in mm. o: {x, y (baseline), h (cap height), gap (between letters, mm; default h/4),
     align 'left'|'center'|'right'}. Unknown characters are skipped and listed in .missing. */
  function strokes(text, o) {
    o = o || {};
    var h = +o.h || 10, u = h / 6, gap = o.gap != null ? +o.gap : h / 4, out = [], missing = [], x = 0;
    var s = String(text || '').toUpperCase();
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch === ' ') { x += 3 * u + gap; continue; }
      var g = FONT[ch];
      if (!g) { if (missing.indexOf(ch) < 0) missing.push(ch); continue; }
      g.forEach(function (pl) { out.push(pl.map(function (p) { return [x + p[0] * u, p[1] * u]; })); });
      x += (NARROW[ch] || 4) * u + gap;
    }
    var width = Math.max(0, x - gap), dx = +o.x || 0, dy = +o.y || 0;
    if (o.align === 'center') dx -= width / 2; else if (o.align === 'right') dx -= width;
    out = out.map(function (pl) { return pl.map(function (p) { return [r3(p[0] + dx), r3(p[1] + dy)]; }); });
    out.width = width; out.missing = missing; out.x0 = dx; out.x1 = dx + width;
    return out;
  }
  function r3(v) { return Math.round(v * 1000) / 1000; }

  /* ---------- spec parsing ---------- */
  function parse(text) {
    text = String(text || '');
    var m = /```(?:partspec|json)\s*\n([\s\S]*?)```/i.exec(text), body = m ? m[1] : null;
    if (!body) { var a = text.indexOf('{'), b = text.lastIndexOf('}'); if (a >= 0 && b > a && /"features"/.test(text)) body = text.slice(a, b + 1); }
    if (!body) return { error: 'NO PART SPEC (```partspec JSON) IN THE ANSWER' };
    var spec;
    try { spec = JSON.parse(body.replace(/\/\/[^\n]*/g, '').replace(/,\s*([}\]])/g, '$1')); }
    catch (e) { return { error: 'PART SPEC IS NOT VALID JSON: ' + e.message }; }
    var err = validate(spec);
    return err ? { error: err, spec: spec } : { spec: spec };
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function pair(v) { return Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]); }
  function validate(s) {
    if (!s || typeof s !== 'object') return 'PART SPEC MUST BE A JSON OBJECT';
    if (!s.blank || !pair(s.blank.x) || !pair(s.blank.y) || !pair(s.blank.z)) return 'PART SPEC: blank needs x, y, z as [min, max]';
    if (!Array.isArray(s.features)) return 'PART SPEC: features must be a list';
    for (var i = 0; i < s.features.length; i++) {
      var f = s.features[i], id = f && (f.id || '#' + (i + 1));
      if (!f || typeof f !== 'object') return 'PART SPEC: feature ' + (i + 1) + ' is not an object';
      if (!num(f.z)) return 'PART SPEC: ' + id + ' needs z (the floor it leaves, e.g. -5)';
      var t = f.type;
      if (t === 'face') continue;
      if (t === 'pocket' && f.shape === 'rect' && pair(f.x) && pair(f.y)) continue;
      if (t === 'pocket' && f.shape === 'circle' && num(f.x) && num(f.y) && num(f.d)) continue;
      if ((t === 'pocket' && f.shape === 'poly' || t === 'profile') && Array.isArray(f.points) && f.points.length >= 3 && f.points.every(pair)) continue;
      if (t === 'hole' && num(f.x) && num(f.y) && num(f.d)) continue;
      if (t === 'slot' && pair(f.from) && pair(f.to) && num(f.w)) continue;
      if (t === 'engrave' && Array.isArray(f.path) && f.path.length >= 2 && f.path.every(pair) && num(f.w)) continue;
      if (t === 'text' && typeof f.text === 'string' && num(f.x) && num(f.y) && num(f.h) && num(f.w)) continue;
      return 'PART SPEC: ' + id + ' (' + t + ') is missing fields — see the spec format';
    }
    return null;
  }

  /* ---------- expand: lettering -> engrave strokes; a sheet of exact geometry + tool feasibility for the writer ---------- */
  function toolKind(t) {
    var n = String(t.name || '').toUpperCase();
    if (/PROBE/.test(n)) return 'probe';
    if (/FACE/.test(n)) return 'face mill';
    if (/SPOT|CENTER|CENTRE/.test(n)) return 'spot drill';
    if (/CHAMFER|COUNTERSINK/.test(n)) return 'chamfer cone';
    if (/TAP/.test(n)) return 'tap';
    if (/REAM/.test(n)) return 'reamer';
    if (/BORE|BORING/.test(n)) return 'boring head';
    if (/DRILL/.test(n)) return 'drill';
    if (/BALL|KUGEL/.test(n)) return 'ball end mill';
    if (/MILL|FRÄS|FRAS/.test(n)) return 'end mill';
    return 'tool';
  }
  function expand(spec, tools) {
    var s = JSON.parse(JSON.stringify(spec)), notes = [], lines = [];
    var mills = (tools || []).filter(function (t) { return /end mill|ball end mill/.test(toolKind(t)); });
    var drills = (tools || []).filter(function (t) { return toolKind(t) === 'drill'; });
    var minMillR = mills.length ? Math.min.apply(null, mills.map(function (t) { return +t.r; })) : null;
    var dia = function (t) { return +(2 * t.r).toFixed(3); };
    var fmt = function (v) { return (Math.round(v * 1000) / 1000).toString(); };
    var pts = function (L) { return L.map(function (p) { return '(' + fmt(p[0]) + ',' + fmt(p[1]) + ')'; }).join(' '); };
    var b = s.blank;
    lines.push('BLANK X' + b.x[0] + '..' + b.x[1] + ' Y' + b.y[0] + '..' + b.y[1] + ' Z' + b.z[0] + '..' + b.z[1]);
    s.features = s.features.map(function (f, i) {
      f.id = f.id || 'F' + (i + 1);
      if (f.type === 'text') {
        var st = strokes(f.text, { x: f.x, y: f.y, h: f.h, gap: f.gap, align: f.align });
        if (st.missing.length) notes.push(f.id + ': no stroke glyph for ' + st.missing.join(' ') + ' (left out)');
        if (st.x0 < b.x[0] || st.x1 > b.x[1]) notes.push(f.id + ': the lettering runs X' + fmt(st.x0) + '..' + fmt(st.x1) + ', outside the blank — make h or gap smaller');
        var e = { id: f.id, type: 'engrave', paths: st, w: f.w, z: f.z, text: f.text };
        lines.push(f.id + ' TEXT "' + f.text + '" cap height ' + f.h + ' groove width ' + f.w + ' floor Z' + f.z + ' — ' + st.length +
          ' strokes, tool-centre paths (absolute mm), each: rapid above the first point, plunge, feed through the points, retract:');
        st.forEach(function (pl, k) { lines.push('  ' + f.id + '.' + (k + 1) + ': ' + pts(pl)); });
        var tw = mills.filter(function (t) { return Math.abs(dia(t) - f.w) < 0.05; });
        if (!tw.length) notes.push(f.id + ': groove width ' + f.w + ' matches no end mill (' + mills.map(function (t) { return 'T' + t.t + ' Ø' + dia(t); }).join(', ') + ') — set w to one of them');
        return e;
      }
      if (f.type === 'engrave') { f.paths = [f.path]; lines.push(f.id + ' ENGRAVE width ' + f.w + ' floor Z' + f.z + ': ' + pts(f.path)); }
      else if (f.type === 'pocket' && f.shape === 'rect') {
        lines.push(f.id + ' RECT POCKET X' + f.x[0] + '..' + f.x[1] + ' Y' + f.y[0] + '..' + f.y[1] + ' corner R' + (f.r || 0) + ' floor Z' + f.z);
        if (minMillR != null && (f.r || 0) + 1e-6 < minMillR) notes.push(f.id + ': corner R' + (f.r || 0) + ' is smaller than the smallest end mill radius ' + minMillR + ' — corners will stay round; use r ≥ ' + minMillR);
        var wmin = Math.min(f.x[1] - f.x[0], f.y[1] - f.y[0]);
        var fit = mills.filter(function (t) { return dia(t) < wmin; }).map(function (t) { return 'T' + t.t + ' Ø' + dia(t); });
        if (!fit.length) notes.push(f.id + ': no end mill fits a ' + wmin + ' mm wide pocket');
      }
      else if (f.type === 'pocket' && f.shape === 'circle') lines.push(f.id + ' CIRCULAR POCKET centre X' + f.x + ' Y' + f.y + ' Ø' + f.d + ' floor Z' + f.z);
      else if (f.type === 'pocket') lines.push(f.id + ' POCKET outline ' + pts(f.points) + ' floor Z' + f.z);
      else if (f.type === 'profile') lines.push(f.id + ' OUTSIDE PROFILE outline ' + pts(f.points) + ' — everything outside cut to Z' + f.z);
      else if (f.type === 'hole') {
        var exact = drills.filter(function (t) { return Math.abs(dia(t) - f.d) < 0.05; });
        lines.push(f.id + ' HOLE X' + f.x + ' Y' + f.y + ' Ø' + f.d + ' to Z' + f.z + (exact.length ? ' — drill T' + exact[0].t : ' — no drill of that size: mill it (helix / circular pocket) or pick a drill size'));
      }
      else if (f.type === 'slot') lines.push(f.id + ' SLOT from (' + f.from + ') to (' + f.to + ') width ' + f.w + ' floor Z' + f.z);
      else if (f.type === 'face') lines.push(f.id + ' FACE whole top to Z' + f.z);
      return f;
    });
    return { spec: s, sheet: lines.join('\n'), notes: notes };
  }

  /* ---------- target height field ---------- */
  function inRR(x, y, x0, x1, y0, y1, r) {          // rounded rectangle
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    r = Math.min(r || 0, (x1 - x0) / 2, (y1 - y0) / 2); if (r <= 0) return true;
    var cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= r * r + 1e-9;
  }
  function inPoly(x, y, P) {
    var c = false;
    for (var i = 0, j = P.length - 1; i < P.length; j = i++) {
      var xi = P[i][0], yi = P[i][1], xj = P[j][0], yj = P[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function segD2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy, t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t; var qx = ax + t * dx - px, qy = ay + t * dy - py; return qx * qx + qy * qy;
  }
  /* every column a feature covers sets z = min(z, feature z); own[] = index of the feature that sets the column */
  function target(spec, st, g) {
    var hm = new Float32Array(g.NX * g.NY), own = new Int16Array(g.NX * g.NY);
    hm.fill(st.z1); own.fill(-1);
    function put(ix, iy, z, k) { var i = iy * g.NX + ix; if (z < hm[i] - 1e-9) { hm[i] = z; own[i] = k; } }
    function cols(x0, x1, y0, y1, fn) {
      var a = Math.max(0, Math.floor((x0 - st.x0) / g.DX)), b = Math.min(g.NX - 1, Math.ceil((x1 - st.x0) / g.DX));
      var c = Math.max(0, Math.floor((y0 - st.y0) / g.DY)), d = Math.min(g.NY - 1, Math.ceil((y1 - st.y0) / g.DY));
      for (var iy = c; iy <= d; iy++) for (var ix = a; ix <= b; ix++) fn(ix, iy, st.x0 + ix * g.DX, st.y0 + iy * g.DY);
    }
    (spec.features || []).forEach(function (f, k) {
      var z = Math.max(f.z, st.z0 - 50);
      if (f.type === 'face') cols(st.x0, st.x1, st.y0, st.y1, function (ix, iy) { put(ix, iy, z, k); });
      else if (f.type === 'pocket' && f.shape === 'rect') cols(f.x[0], f.x[1], f.y[0], f.y[1], function (ix, iy, x, y) { if (inRR(x, y, f.x[0], f.x[1], f.y[0], f.y[1], f.r)) put(ix, iy, z, k); });
      else if ((f.type === 'pocket' && f.shape === 'circle') || f.type === 'hole') {
        var r = f.d / 2;
        cols(f.x - r, f.x + r, f.y - r, f.y + r, function (ix, iy, x, y) { if ((x - f.x) * (x - f.x) + (y - f.y) * (y - f.y) <= r * r) put(ix, iy, z, k); });
      }
      else if (f.type === 'pocket' && f.shape === 'poly') {
        var xs = f.points.map(function (p) { return p[0]; }), ys = f.points.map(function (p) { return p[1]; });
        cols(Math.min.apply(null, xs), Math.max.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, ys), function (ix, iy, x, y) { if (inPoly(x, y, f.points)) put(ix, iy, z, k); });
      }
      else if (f.type === 'profile') cols(st.x0, st.x1, st.y0, st.y1, function (ix, iy, x, y) { if (!inPoly(x, y, f.points)) put(ix, iy, z, k); });
      else if (f.type === 'slot' || f.type === 'engrave' || f.type === 'text') {
        var paths = f.type === 'slot' ? [[f.from, f.to]] : f.paths || (f.type === 'text' ? strokes(f.text, { x: f.x, y: f.y, h: f.h, gap: f.gap, align: f.align }) : [f.path]);
        var rr = f.w / 2, r2 = rr * rr;
        paths.forEach(function (pl) {
          for (var j = 0; j + 1 < pl.length || (pl.length === 1 && j === 0); j++) {
            var A = pl[j], B = pl[j + 1] || pl[j];
            cols(Math.min(A[0], B[0]) - rr, Math.max(A[0], B[0]) + rr, Math.min(A[1], B[1]) - rr, Math.max(A[1], B[1]) + rr, function (ix, iy, x, y) {
              if (segD2(x, y, A[0], A[1], B[0], B[1]) <= r2) put(ix, iy, z, k); });
          }
        });
      }
    });
    return { hm: hm, own: own };
  }

  /* ---------- what the program really removes: every feed move stamped, exactly as the checks do ---------- */
  function carve(res, ex, g) {
    var st = res.stock, hm = STOCK.field(st, g);
    ex.segs.forEach(function (s) {
      if (s.probe || s.kind === 'rapid') return;
      var step = Math.max(0.3, Math.min(s.toolR * 0.45, 1.5)), n = Math.max(1, Math.ceil(s.len / step));
      for (var i = 0; i <= n; i++) {
        var u = i / n, p = { x: s.a.x + (s.b.x - s.a.x) * u, y: s.a.y + (s.b.y - s.a.y) * u, z: s.a.z + (s.b.z - s.a.z) * u };
        STOCK.stamp(hm, st, g, s, p, STOCK.axis(s, u));
      }
    });
    return hm;
  }

  /* ---------- compare: volumes, per-feature coverage and depth, the largest misses and gouges ---------- */
  function compare(spec, res, ex, o) {
    o = o || {};
    var st = res.stock, tol = o.tol != null ? o.tol : 0.1;
    var sb = spec.blank, mism = [];
    if (sb) ['x', 'y', 'z'].forEach(function (a) {
      if (Math.abs(sb[a][0] - st[a + '0']) > 0.01 || Math.abs(sb[a][1] - st[a + '1']) > 0.01)
        mism.push('blank ' + a.toUpperCase() + ' spec ' + sb[a].join('..') + ' vs BLK FORM ' + st[a + '0'] + '..' + st[a + '1']);
    });
    var g = o.grid || STOCK.grid(st, ex.segs);
    var T = target(spec, st, g), A = carve(res, ex, g), cell = g.DX * g.DY, N = g.NX * g.NY;
    var feats = spec.features || [], per = feats.map(function () { return { cols: 0, ok: 0, high: 0, deep: 0, miss: 0, worst: 0, wx: 0, wy: 0, maxDeep: 0 }; });
    var inter = 0, uni = 0, removeT = 0, removeA = 0, missing = 0, extra = 0;
    var bad = new Int8Array(N);
    function edge(i) { var ix = i % g.NX, z = T.hm[i];
      return (ix > 0 && Math.abs(T.hm[i - 1] - z) > 0.01) || (ix < g.NX - 1 && Math.abs(T.hm[i + 1] - z) > 0.01) ||
             (i >= g.NX && Math.abs(T.hm[i - g.NX] - z) > 0.01) || (i + g.NX < N && Math.abs(T.hm[i + g.NX] - z) > 0.01); }                                   // 1 = left high (missing), 2 = cut too deep / where it should stay (gouge)
    for (var i = 0; i < N; i++) {
      var t = Math.max(T.hm[i], st.z0), a = Math.max(A[i], st.z0), rt = st.z1 - t, ra = st.z1 - a;
      removeT += rt; removeA += ra; inter += Math.min(rt, ra); uni += Math.max(rt, ra);
      var d = a - t, k = T.own[i];
      /* a column on a feature edge (a neighbour has another target height) is within half a cell of the
         outline: grid rounding, not a machining error — it counts in the overlap but not as a miss or a gouge */
      var onEdge = Math.abs(d) > tol && edge(i); if (onEdge) d = 0;
      if (d > tol) { missing += d; bad[i] = 1; } else if (d < -tol) { extra += -d; bad[i] = 2; }
      if (k >= 0 && !onEdge) {
        var P = per[k]; P.cols++;
        if (Math.abs(d) <= tol) P.ok++; else if (d > 0) { P.high++; P.miss += d; if (d > P.worst) { P.worst = d; P.wx = st.x0 + (i % g.NX) * g.DX; P.wy = st.y0 + Math.floor(i / g.NX) * g.DY; } }
        else { P.deep++; if (-d > P.maxDeep) P.maxDeep = -d; }
      }
    }
    var score = uni > 1e-9 ? 100 * inter / uni : null;
    /* connected regions of misses / gouges, largest first */
    function regions(kind) {
      var seen = new Uint8Array(N), out = [];
      for (var i0 = 0; i0 < N; i0++) {
        if (bad[i0] !== kind || seen[i0]) continue;
        var q = [i0], vol = 0, x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, worst = 0, zt = 0, za = 0, n = 0; seen[i0] = 1;
        while (q.length) {
          var i = q.pop(), ix = i % g.NX, iy = (i - ix) / g.NX, x = st.x0 + ix * g.DX, y = st.y0 + iy * g.DY;
          var dd = Math.abs(Math.max(A[i], st.z0) - Math.max(T.hm[i], st.z0)); vol += dd * cell; n++;
          if (dd > worst) { worst = dd; zt = Math.max(T.hm[i], st.z0); za = Math.max(A[i], st.z0); }
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          [i - 1, i + 1, i - g.NX, i + g.NX].forEach(function (j) {
            if (j < 0 || j >= N || seen[j] || bad[j] !== kind) return;
            if ((j === i - 1 && ix === 0) || (j === i + 1 && ix === g.NX - 1)) return;
            seen[j] = 1; q.push(j); });
        }
        if (vol >= Math.max(0.5, cell * 2)) out.push({ vol: vol, x0: x0, x1: x1, y0: y0, y1: y1, worst: worst, zTarget: zt, zActual: za, cols: n });
      }
      return out.sort(function (p, q2) { return q2.vol - p.vol; });
    }
    var miss = regions(1), gouge = regions(2);
    var f1 = function (v) { return (Math.round(v * 10) / 10).toFixed(1); }, f2 = function (v) { return (Math.round(v * 100) / 100).toString(); };
    var cm3 = function (v) { return v >= 1000 ? f2(v / 1000) + ' cm³' : f1(v) + ' mm³'; };
    var featureRows = feats.map(function (f, k) {
      var P = per[k], cov = P.cols ? 100 * P.ok / P.cols : 0;
      return { id: f.id || 'F' + (k + 1), type: f.type, coverage: cov, cols: P.cols, high: P.high, deep: P.deep, missing: P.miss * cell, worst: P.worst, at: [P.wx, P.wy], maxDeep: P.maxDeep };
    });
    var L = [];
    L.push('MEASURED: the simulator machined your program and compared the result with your part spec (grid ' + f2(g.DX) + ' × ' + f2(g.DY) + ' mm, tolerance ' + tol + ' mm).');
    L.push('Match ' + (score == null ? '—' : f1(score) + ' %') + ' (removed-volume overlap). Spec removes ' + cm3(removeT * cell) + ', program removes ' + cm3(removeA * cell) +
      '; material left that should be gone ' + cm3(missing * cell) + '; material cut that should stay ' + cm3(extra * cell) + '.');
    mism.forEach(function (m) { L.push('BLANK MISMATCH: ' + m); });
    featureRows.forEach(function (r, k) {
      var f = feats[k];
      var s = r.id + ' ' + f.type + (f.text ? ' "' + f.text + '"' : '') + ' floor Z' + f.z + ': ' + (r.cols ? f1(r.coverage) + ' % at depth' : 'covers no grid column (too small?)');
      if (r.high) s += '; ' + f1(100 * r.high / r.cols) + ' % left high (worst +' + f2(r.worst) + ' mm near X' + f1(r.at[0]) + ' Y' + f1(r.at[1]) + ')';
      if (r.deep) s += '; ' + f1(100 * r.deep / r.cols) + ' % deeper than the floor (up to ' + f2(r.maxDeep) + ' mm)';
      L.push(s);
    });
    var box = function (r) { return 'X' + f1(r.x0) + '..' + f1(r.x1) + ' Y' + f1(r.y0) + '..' + f1(r.y1); };
    miss.slice(0, 5).forEach(function (r) { L.push('NOT CUT ' + box(r) + ': ' + cm3(r.vol) + ', spec floor Z' + f2(r.zTarget) + ' but the surface is at Z' + f2(r.zActual)); });
    gouge.slice(0, 5).forEach(function (r) { L.push('CUT WHERE IT SHOULD NOT ' + box(r) + ': ' + cm3(r.vol) + ', spec keeps Z' + f2(r.zTarget) + ' but the program cut to Z' + f2(r.zActual)); });
    return { score: score, removedTarget: removeT * cell, removedActual: removeA * cell, missing: missing * cell, extra: extra * cell,
      features: featureRows, notCut: miss, gouges: gouge, grid: g, blankMismatch: mism, text: L.join('\n'), target: T, actual: A };
  }

  return { FONT: FONT, strokes: strokes, parse: parse, validate: validate, expand: expand, toolKind: toolKind,
    target: target, carve: carve, compare: compare };
})();
if (typeof module !== 'undefined') module.exports = TNC_PART;
