/* ============================================================
   TNC_SIM — shared simulation helpers + safety checks.
   Pure: no DOM, no three.js. Used by the UI and by node tests.

   TNC_SIM.expand(res)            -> { segs, total }   timed, arc-tessellated
   TNC_SIM.grid(stock, segs)      -> { NX, NY, DX, DY } height-field resolution
   TNC_SIM.analyse(res, ex, g)    -> events[]          crashes + warnings
   TNC_SIM.isCone(toolNumber)     -> Boolean           chamfer / spot tools
   ============================================================ */
var TNC_SIM = (function () {
  'use strict';

  var TOOLS = (typeof TNC !== 'undefined' && TNC.TOOLS) ||
              (typeof require !== 'undefined' ? require('./core.js').TOOLS : []);
  var CONE = {}, FLUTES = {};
  TOOLS.forEach(function (t) {
    if (/CHAMFER|SPOT/.test(t.name)) CONE[t.t] = true;
    if (/FACEMILL/.test(t.name)) FLUTES[t.t] = 5;
    else if (/ENDMILL/.test(t.name)) FLUTES[t.t] = 3;
  });
  function isCone(t) { return !!CONE[t]; }

  /* ---------- arcs -> short chords ---------- */
  function tessArc(mv, out) {
    var f = mv.from, to = mv.to, cx = mv.cx, cy = mv.cy;
    var r = Math.hypot(f.x - cx, f.y - cy);
    var a0 = Math.atan2(f.y - cy, f.x - cx), a1 = Math.atan2(to.y - cy, to.x - cx);
    var sw = a1 - a0;
    if (mv.sweep !== null && mv.sweep !== undefined) sw = mv.sweep;     // helices / multi-turn arcs
    else if (mv.ccw) { while (sw <= 1e-9) sw += Math.PI * 2; }
    else             { while (sw >= -1e-9) sw -= Math.PI * 2; }
    var n = Math.max(6, Math.ceil(Math.abs(sw) / (Math.PI / 36)));
    var prev = f;
    for (var i = 1; i <= n; i++) {
      var a = a0 + sw * (i / n);
      var p = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), z: f.z + (to.z - f.z) * (i / n) };
      out.push([prev, p]); prev = p;
    }
  }

  /* ---------- moves -> timed segments ---------- */
  function expand(res) {
    var segs = [], t = 0, rapid = (res.stats && res.stats.rapidRate) || 18000;
    (res.moves || []).forEach(function (mv) {
      var pairs = [];
      if (mv.kind === 'arc' && mv.cx != null) tessArc(mv, pairs);
      else pairs.push([mv.from, mv.to]);
      /* rotary axes ride along: angles interpolated over the move (DRO + head pose) */
      var r0 = mv.rot0, r1 = mv.rot1 || mv.rot0, total = 0;
      pairs.forEach(function (pr) { total += Math.hypot(pr[1].x - pr[0].x, pr[1].y - pr[0].y, pr[1].z - pr[0].z); });
      var done = 0, rotOnly = total < 1e-9 && r0 && r1 && (r0.a !== r1.a || r0.b !== r1.b || r0.c !== r1.c);
      if (rotOnly) pairs = [[mv.from, mv.to]];
      pairs.forEach(function (pr) {
        var a = pr[0], b = pr[1];
        var len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (len < 1e-9 && !rotOnly) return;
        if (r0) {
          var u0 = total > 1e-9 ? done / total : 0, u1 = total > 1e-9 ? (done + len) / total : 1;
          a = { x: a.x, y: a.y, z: a.z, a: r0.a + (r1.a - r0.a) * u0, b: r0.b + (r1.b - r0.b) * u0, c: r0.c + (r1.c - r0.c) * u0 };
          b = { x: b.x, y: b.y, z: b.z, a: r0.a + (r1.a - r0.a) * u1, b: r0.b + (r1.b - r0.b) * u1, c: r0.c + (r1.c - r0.c) * u1 };
        }
        done += len;
        var f = mv.kind === 'rapid' ? rapid : Math.max(1, mv.feed || 500);
        var dt = mv.dur != null ? mv.dur * (total > 1e-9 ? len / total : 1) : len / f * 60;   // machine time when the core knows it
        segs.push({ a: a, b: b, len: len, f: f, kind: mv.kind === 'rapid' ? 'rapid' : 'feed',
                    block: mv.block, tool: mv.tool, toolR: mv.toolR || 3, stick: mv.stick, toolL: mv.toolL, sRpm: mv.sRpm, cone: isCone(mv.tool) || /CHAMFER|SPOT|CENTER|CENTRE/i.test(mv.toolName || ''),
                    spindle: mv.spindle || 0, coolant: !!mv.coolant, cycle: mv.cycle || null,
                    t0: t, t1: t + dt });
        t += dt;
      });
    });
    return { segs: segs, total: t };
  }

  /* ---------- height-field resolution: follow the smallest cutter ---------- */
  function grid(st, segs) {
    var w = Math.max(1, st.x1 - st.x0), h = Math.max(1, st.y1 - st.y0);
    var minR = Infinity;
    for (var i = 0; i < segs.length; i++) if (segs[i].kind === 'feed' && segs[i].toolR < minR) minR = segs[i].toolR;
    if (!isFinite(minR)) minR = 3;
    var cell = Math.max(0.3, Math.min(0.8, minR / 2));
    while ((w / cell + 1) * (h / cell + 1) > 150000) cell *= 1.08;
    var NX = Math.max(30, Math.round(w / cell) + 1), NY = Math.max(30, Math.round(h / cell) + 1);
    return { NX: NX, NY: NY, DX: w / (NX - 1), DY: h / (NY - 1) };
  }

  /* ---------- disc visit: stamp or probe ---------- */
  function disc(hm, st, g, cx, cy, z, r, cone, stamp) {
    var i0 = Math.max(0, Math.floor((cx - r - st.x0) / g.DX)), i1 = Math.min(g.NX - 1, Math.ceil((cx + r - st.x0) / g.DX));
    var j0 = Math.max(0, Math.floor((cy - r - st.y0) / g.DY)), j1 = Math.min(g.NY - 1, Math.ceil((cy + r - st.y0) / g.DY));
    var r2 = r * r, hit = false;
    for (var j = j0; j <= j1; j++) {
      var dy = st.y0 + j * g.DY - cy;
      for (var i = i0; i <= i1; i++) {
        var dx = st.x0 + i * g.DX - cx, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        var zz = cone ? z + Math.sqrt(d2) : z, k = j * g.NX + i;
        if (hm[k] > zz + 0.05 && hm[k] > st.z0 + 1e-6) {   // a column cut to the bottom holds no material
          hit = true;
          if (stamp) hm[k] = Math.max(st.z0, zz); else return true;
        }
      }
    }
    return hit;
  }

  /* ---------- safety analysis ---------- */
  var MSG = {
    RAPID_IN_MATERIAL: 'CRASH: RAPID TRAVERSE INTO MATERIAL',
    SPINDLE_OFF:       'CRASH: CUTTING WITH SPINDLE STOPPED',
    BELOW_BLANK:       'CRASH: TOOL MORE THAN 3 MM BELOW BLANK — INTO THE PARALLELS / TABLE',
    THROUGH_CUT:       'NOTE: TOOL BREAKS THROUGH THE BLANK BOTTOM — ASSUMES PARALLELS UNDER THE PART',
    CHIP_LOAD:         'WARNING: CHIP LOAD HIGH FOR THIS CUTTER',
    SPINDLE_MAX:       'WARNING: SPINDLE SPEED ABOVE THE MACHINE MAXIMUM',
    HOLDER:            'CRASH: TOOL HOLDER COLLISION — THE HOLDER NOSE REACHES THE PART'
  };

  function analyse(res, ex, g) {
    var st = res.stock, ev = [], seen = {};
    var hm = new Float32Array(g.NX * g.NY); hm.fill(st.z1);
    function add(code, sev, s, idx, t, p, extra) {
      var key = code === 'CHIP_LOAD' ? code + ':' + s.tool + ':' + s.f
              : code === 'THROUGH_CUT' ? code + ':' + s.tool
              : code + ':' + s.block;
      if (seen[key] || ev.length >= 60) return;
      seen[key] = 1;
      ev.push({ code: code, sev: sev, msg: MSG[code] + (extra || ''), block: s.block, seg: idx, t: t,
                at: { x: p.x, y: p.y, z: p.z }, tool: s.tool });
    }
    function inside(p, r) {
      return p.x > st.x0 - r && p.x < st.x1 + r && p.y > st.y0 - r && p.y < st.y1 + r;
    }
    ex.segs.forEach(function (s, idx) {
      var step = Math.max(0.3, Math.min(s.toolR * 0.45, 1.5));
      var n = Math.max(1, Math.ceil(s.len / step));
      for (var i = 0; i <= n; i++) {
        var u = i / n, t = s.t0 + (s.t1 - s.t0) * u;
        var p = { x: s.a.x + (s.b.x - s.a.x) * u, y: s.a.y + (s.b.y - s.a.y) * u, z: s.a.z + (s.b.z - s.a.z) * u };
        if (s.kind === 'rapid') {
          if (disc(hm, st, g, p.x, p.y, p.z, s.toolR, s.cone, false)) {
            add('RAPID_IN_MATERIAL', 'crash', s, idx, t, p); break;
          }
          continue;
        }
        if (inside(p, s.toolR)) {
          /* holder: the part surface stands higher than the holder nose (tip + stick-out) */
          if (s.stick > 0) {                    // material under the collet nut (radius ~ 2 x tool, min 12) above the nose height
            var zn = p.z + s.stick, hr = Math.max(s.toolR * 2, 12);
            if (zn < st.z1 && disc(hm, st, g, p.x, p.y, zn, hr, false, false))
              add('HOLDER', 'crash', s, idx, t, p, ' — T' + s.tool + ' STICK-OUT ' + s.stick.toFixed(1) + ' MM FROM L ' + (s.toolL || 0).toFixed(1) + ' (TOOL LIST / TOOL HOLDER LENGTH)');
          }
          if (p.z < st.z0 - 3) add('BELOW_BLANK', 'crash', s, idx, t, p);
          else if (p.z < st.z0 - 0.01) add('THROUGH_CUT', 'info', s, idx, t, p);
        }
        var cut = disc(hm, st, g, p.x, p.y, p.z, s.toolR, s.cone, true);
        if (cut) {
          if (s.spindle === 0) add('SPINDLE_OFF', 'crash', s, idx, t, p);
          var z = FLUTES[s.tool];
          var lateral = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > Math.abs(s.b.z - s.a.z);
          if (z && s.spindle && lateral) {
            var D = 2 * s.toolR, fz = s.f / (Math.abs(s.spindle) * z), lim = 0.012 * D + 0.005;
            if (fz > lim) add('CHIP_LOAD', 'warn', s, idx, t, p,
              ' — fz ' + fz.toFixed(3) + ' MM/TOOTH, SUGGEST ≤ ' + lim.toFixed(3) +
              ' (F' + Math.floor(lim * Math.abs(s.spindle) * z) + ' AT S' + Math.abs(s.spindle) + ')');
          }
        }
      }
    });
    var sMax = res.machine && res.machine.sMax;                // MP 3515: the control limits S to the gear range maximum
    if (sMax) for (var k = 0; k < ex.segs.length; k++) { var sg = ex.segs[k];
      if (Math.abs(sg.spindle || 0) > sMax + 1e-9) add('SPINDLE_MAX', 'warn', sg, k, sg.t0, sg.a, ' — S' + Math.abs(sg.spindle) + ' > ' + sMax + ' RPM (MP 3515), THE CONTROL LIMITS IT'); }
    return ev;
  }

  return { expand: expand, grid: grid, analyse: analyse, isCone: isCone, MSG: MSG };
})();
if (typeof module !== 'undefined') module.exports = TNC_SIM;
