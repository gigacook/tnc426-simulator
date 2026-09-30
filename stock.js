/* ============================================================
   TNC_STOCK — the material model, shared by the live view (ui.js) and the checks (sim.js analyse).
   Pure: no DOM, no three.js.

   Height field: one top-surface z per XY column over the blank (BLK FORM). It cannot hold undercuts:
   a tilted tool that passes UNDER an overhang removes the whole column above its lowest point too.
   Accepted — a dexel/voxel model is the real fix (see CONTINUE.md, TNC 430 multi-axis).

   TNC_STOCK.grid(stock, segs)          -> { NX, NY, DX, DY }   resolution follows the smallest cutter
   TNC_STOCK.field(stock, g)            -> Float32Array         a fresh blank (every column at the top)
   TNC_STOCK.axis(s, u)                 -> null | [ux,uy,uz]   tool axis (tip -> spindle) at u along seg s; null = vertical
   TNC_STOCK.stamp(hm, st, g, s, p, ax, eps) -> Boolean         cut the tool body at tip p; true when material went
   TNC_STOCK.probe(hm, st, g, s, p, ax) -> Boolean              tool body touches material (rapid check)
   TNC_STOCK.holderHits(hm, st, g, s, p, ax) -> Boolean         holder (nose and up, along the axis) touches material
   TNC_STOCK.vice(st)                   -> [box, box] | []     jaw boxes {x0,x1,y0,y1,z0,z1}
   TNC_STOCK.viceHit(st, s, p, ax)      -> null | 'tool' | 'holder'
   TNC_STOCK.disc(...)                  the vertical-tool disc visit (unchanged from sim.js)

   Vertical tool (A = B = 0 or no rotary axes): the exact old disc code, so the 426 path is unchanged.
   Tilted tool: the body is a cylinder (flat), ball + cylinder (ball: name BALL / KUGEL / KULFR, or R2 >= R)
   or 45° cone + cylinder (chamfer / spot), along its real axis from A/B; each column takes the lowest point
   of the body over it.
   ============================================================ */
var TNC_STOCK = (function () {
  'use strict';

  /* ---------- vice: a standard machine vice (160 mm jaws), part on parallels, jaws on the Y faces ----------
     The jaws grip the bottom GRIP mm of the blank (a third of a thin part): cutting the part's sides lower
     than that, or a holder reaching them, is a crash, as it would be on the machine. Through the bottom
     inside the part (drilling, tapping) is not. Off (UI "Vice" toggle) = part on a fixture plate. */
  var VICE = {
    on: true,
    axis: 'Y',       // jaws close along Y: one jaw on the Y- face, one on the Y+ face of the blank
    grip: 6,         // jaw top this far above the blank bottom (mm) …
    minGrip: 1 / 3,  // … but never more than this share of the blank height (thin plates)
    jawT: 25,        // jaw thickness along Y (mm)
    jawW: 160,       // jaw width along X (mm) — a 160 mm vice, centred on the blank; never narrower than the blank
    below: 40        // jaw depth below the blank bottom, drawn only (mm)
  };
  var FLUTE_DEF = function (r) { return Math.max(30, r * 7); };   // body length when L is unknown: as ui.js draws it
  var HEAD_LEN = 300;          // holder + spindle head probe length above the nose, along the axis (mm)
  var VICE_STEP = 1;           // column spacing for the vice probe (mm)
  var BIG = 1e6;
  var SHRINK = 0.02;           // tilted probes run 0.02 mm inside the stamped body: grid columns on the exact silhouette
                               // (a tangent, discriminant ~ 0) must not flip between cut and uncut by rounding

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
  function field(st, g) { var hm = new Float32Array(g.NX * g.NY); hm.fill(st.z1); return hm; }

  /* ---------- vertical tool: disc visit, stamp or probe (eps: the analysis ignores slivers under 0.05) ---------- */
  function disc(hm, st, g, cx, cy, z, r, cone, stamp, eps) {
    if (eps == null) eps = 0.05;
    var i0 = Math.max(0, Math.floor((cx - r - st.x0) / g.DX)), i1 = Math.min(g.NX - 1, Math.ceil((cx + r - st.x0) / g.DX));
    var j0 = Math.max(0, Math.floor((cy - r - st.y0) / g.DY)), j1 = Math.min(g.NY - 1, Math.ceil((cy + r - st.y0) / g.DY));
    var r2 = r * r, hit = false;
    for (var j = j0; j <= j1; j++) {
      var dy = st.y0 + j * g.DY - cy;
      for (var i = i0; i <= i1; i++) {
        var dx = st.x0 + i * g.DX - cx, d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        var zz = cone ? z + Math.sqrt(d2) : z, k = j * g.NX + i;
        if (hm[k] > zz + eps && hm[k] > st.z0 + 1e-6) {   // a column cut to the bottom holds no material
          hit = true;
          if (stamp) hm[k] = Math.max(st.z0, zz); else return true;
        }
      }
    }
    return hit;
  }

  /* ---------- tool axis from the head angles. This machine: R = Ry(-B)·Rx(A) (as core.js cycle 19 and the
     ui.js tool pose); the axis tip -> spindle is R·(0,0,1) = (-sinB cosA, -sinA, cosB cosA). ---------- */
  function axis(s, u) {
    if (!s.a || s.a.a == null) return null;
    var A = s.a.a + ((s.b.a || 0) - s.a.a) * u, B = (s.a.b || 0) + ((s.b.b || 0) - (s.a.b || 0)) * u;
    if (Math.abs(A) < 1e-6 && Math.abs(B) < 1e-6) return null;
    A *= Math.PI / 180; B *= Math.PI / 180;
    return [-Math.sin(B) * Math.cos(A), -Math.sin(A), Math.cos(B) * Math.cos(A)];
  }
  function isBall(s) { return !s.cone && (!!s.ball || (s.toolR2 > 0 && s.toolR2 >= s.toolR - 1e-9)); }   // s.ball: expand() from the tool name
  function bodyLen(s) { return s.stick > 0 ? s.stick : FLUTE_DEF(s.toolR); }

  /* smallest h in [lo,hi] with A h² + B h + C <= 0, NaN if none */
  function qmin(A, B, C, lo, hi) {
    if (lo > hi) return NaN;
    if (A * lo * lo + B * lo + C <= 0) return lo;
    var r0, r1;
    if (Math.abs(A) < 1e-12) { if (Math.abs(B) < 1e-12) return NaN; r0 = r1 = -C / B; }
    else { var D = B * B - 4 * A * C; if (D < 0) return NaN; D = Math.sqrt(D);
      r0 = (-B - D) / (2 * A); r1 = (-B + D) / (2 * A); if (r0 > r1) { var tt = r0; r0 = r1; r1 = tt; } }
    if (r0 >= lo && r0 <= hi) return r0;
    if (r1 >= lo && r1 <= hi) return r1;
    return NaN;
  }
  /* h range where the axial coordinate t = a + h·uz lies in [t0,t1] */
  function tRange(a, uz, t0, t1, out) {
    if (Math.abs(uz) < 1e-12) { if (a < t0 || a > t1) return false; out[0] = -BIG; out[1] = BIG; return true; }
    var h0 = (t0 - a) / uz, h1 = (t1 - a) / uz; out[0] = Math.min(h0, h1); out[1] = Math.max(h0, h1); return true;
  }
  var TR = [0, 0];
  /* lowest h (z above the base point) of the solid cylinder r, t in [t0,t1] over column offset (dx,dy) */
  function cylLow(dx, dy, ax, r, t0, t1) {
    var a = dx * ax[0] + dy * ax[1], uz = ax[2];
    if (!tRange(a, uz, t0, t1, TR)) return NaN;
    return qmin(1 - uz * uz, -2 * a * uz, dx * dx + dy * dy - a * a - r * r, TR[0], TR[1]);
  }
  /* 45° cone, tip at the base point, t in [0,r]: radius at t is t */
  function coneLow(dx, dy, ax, r) {
    var a = dx * ax[0] + dy * ax[1], uz = ax[2];
    if (!tRange(a, uz, 0, r, TR)) return NaN;
    return qmin(1 - 2 * uz * uz, -4 * a * uz, dx * dx + dy * dy - 2 * a * a, TR[0], TR[1]);
  }
  /* lowest point of the tool body over the column (dx,dy) from the tip, relative to the tip z; NaN = misses */
  function bodyLow(kind, dx, dy, ax, r, L) {
    var h = NaN, c;
    if (kind === 1) {                         // ball: sphere centred r up the axis, then the shank
      var cx = dx - r * ax[0], cy = dy - r * ax[1], d2 = cx * cx + cy * cy;
      if (d2 <= r * r) h = r * ax[2] - Math.sqrt(r * r - d2);
      c = cylLow(dx, dy, ax, r, r, Math.max(r, L));
    } else if (kind === 2) {                  // chamfer / spot: cone, then the shank
      h = coneLow(dx, dy, ax, r);
      c = cylLow(dx, dy, ax, r, r, Math.max(r, L));
    } else c = cylLow(dx, dy, ax, r, 0, L);
    return (h === h && !(c < h)) ? h : c;     // NaN-safe min
  }
  /* XY bounding box of a body from the tip along the axis, t in [t0,t1], radius r */
  function bbox(p, ax, r, t0, t1) {
    var s = r;                                                    // a tilted cross-section still fits in r around the axis
    var xa = p.x + ax[0] * t0, xb = p.x + ax[0] * t1, ya = p.y + ax[1] * t0, yb = p.y + ax[1] * t1;
    return [Math.min(xa, xb) - s, Math.max(xa, xb) + s, Math.min(ya, yb) - s, Math.max(ya, yb) + s];
  }
  /* visit the columns of the body: stamp (lower them) or probe (true at first material) */
  function visit(hm, st, g, p, ax, kind, r, t0, t1, L, stamp, eps) {
    var bb = bbox(p, ax, r, t0, t1);
    var i0 = Math.max(0, Math.floor((bb[0] - st.x0) / g.DX)), i1 = Math.min(g.NX - 1, Math.ceil((bb[1] - st.x0) / g.DX));
    var j0 = Math.max(0, Math.floor((bb[2] - st.y0) / g.DY)), j1 = Math.min(g.NY - 1, Math.ceil((bb[3] - st.y0) / g.DY));
    var hit = false;
    for (var j = j0; j <= j1; j++) {
      var dy = st.y0 + j * g.DY - p.y;
      for (var i = i0; i <= i1; i++) {
        var k = j * g.NX + i;
        if (!(hm[k] > st.z0 + 1e-6)) continue;
        var dx = st.x0 + i * g.DX - p.x;
        var h = kind < 0 ? cylLow(dx, dy, ax, r, t0, t1) : bodyLow(kind, dx, dy, ax, r, L);
        if (h !== h) continue;
        var zz = p.z + h;
        if (hm[k] > zz + eps) { hit = true; if (stamp) hm[k] = Math.max(st.z0, zz); else return true; }
      }
    }
    return hit;
  }
  function kindOf(s) { return s.cone ? 2 : isBall(s) ? 1 : 0; }

  /* ---------- the public stamp / probe ---------- */
  function stamp(hm, st, g, s, p, ax, eps) {
    if (eps == null) eps = 0.05;
    if (!ax) {
      if (isBall(s)) return visit(hm, st, g, p, [0, 0, 1], 1, s.toolR, 0, bodyLen(s), bodyLen(s), true, eps);
      return disc(hm, st, g, p.x, p.y, p.z, s.toolR, s.cone, true, eps);
    }
    return visit(hm, st, g, p, ax, kindOf(s), s.toolR, 0, bodyLen(s), bodyLen(s), true, eps);
  }
  function probe(hm, st, g, s, p, ax) {
    if (!ax) {
      if (isBall(s)) return visit(hm, st, g, p, [0, 0, 1], 1, s.toolR - SHRINK, 0, bodyLen(s), bodyLen(s), false, 0.05);
      return disc(hm, st, g, p.x, p.y, p.z, s.toolR, s.cone, false);
    }
    return visit(hm, st, g, p, ax, kindOf(s), s.toolR - SHRINK, 0, bodyLen(s), bodyLen(s), false, 0.05);
  }
  function holderR(s) { return Math.max(s.toolR * 2, 12); }   // collet nut radius ~ 2 x tool, min 12
  /* holder: from the nose (tip + stick-out) up the axis. Vertical: material above the nose height (old check). */
  function holderHits(hm, st, g, s, p, ax) {
    if (!(s.stick > 0)) return false;
    var hr = holderR(s);
    if (!ax) { var zn = p.z + s.stick; return zn < st.z1 && disc(hm, st, g, p.x, p.y, zn, hr, false, false); }
    return visit(hm, st, g, p, ax, -1, hr - SHRINK, s.stick, s.stick + HEAD_LEN, 0, false, 0.05);
  }

  /* ---------- vice ---------- */
  function vice(st) {
    if (!VICE.on) return [];
    var H = st.z1 - st.z0, top = st.z0 + Math.min(VICE.grip, H * VICE.minGrip), bot = st.z0 - VICE.below;
    var cx = (st.x0 + st.x1) / 2, hw = Math.max(VICE.jawW, st.x1 - st.x0) / 2;
    if (VICE.axis === 'X') {
      var cy = (st.y0 + st.y1) / 2, hy = Math.max(VICE.jawW, st.y1 - st.y0) / 2;
      return [{ x0: st.x0 - VICE.jawT, x1: st.x0, y0: cy - hy, y1: cy + hy, z0: bot, z1: top },
              { x0: st.x1, x1: st.x1 + VICE.jawT, y0: cy - hy, y1: cy + hy, z0: bot, z1: top }];
    }
    return [{ x0: cx - hw, x1: cx + hw, y0: st.y0 - VICE.jawT, y1: st.y0, z0: bot, z1: top },
            { x0: cx - hw, x1: cx + hw, y0: st.y1, y1: st.y1 + VICE.jawT, z0: bot, z1: top }];
  }
  /* body (kind, r, t in [t0,t1]) against one jaw: any column of the jaw where the body dips below the jaw top */
  function boxHit(bx, p, ax, kind, r, t0, t1, L) {
    var A = ax || [0, 0, 1];
    var zlo = Math.min(p.z + A[2] * t0, p.z + A[2] * t1) - (ax ? r * Math.sqrt(Math.max(0, 1 - A[2] * A[2])) : 0);
    if (zlo >= bx.z1 - 1e-6) return false;                        // the whole body stays above the jaw top
    var bb = bbox(p, A, r, t0, t1);
    var x0 = Math.max(bb[0], bx.x0), x1 = Math.min(bb[1], bx.x1), y0 = Math.max(bb[2], bx.y0), y1 = Math.min(bb[3], bx.y1);
    if (x0 > x1 || y0 > y1) return false;
    var nx = Math.max(1, Math.ceil((x1 - x0) / VICE_STEP)), ny = Math.max(1, Math.ceil((y1 - y0) / VICE_STEP));
    for (var j = 0; j <= ny; j++) { var dy = y0 + (y1 - y0) * j / ny - p.y;
      for (var i = 0; i <= nx; i++) { var dx = x0 + (x1 - x0) * i / nx - p.x;
        var h = kind < 0 ? cylLow(dx, dy, A, r, t0, t1) : bodyLow(kind, dx, dy, A, r, L);
        if (h === h && p.z + h < bx.z1 - 1e-6 && p.z + h > bx.z0) return true; } }
    return false;
  }
  function viceHit(st, s, p, ax, jaws) {
    jaws = jaws || vice(st); if (!jaws.length) return null;
    var L = bodyLen(s), kind = kindOf(s), hr = holderR(s);
    for (var n = 0; n < jaws.length; n++) {
      if (boxHit(jaws[n], p, ax, kind, s.toolR, 0, L, L)) return 'tool';
      if (s.stick > 0 && boxHit(jaws[n], p, ax, -1, hr, s.stick, s.stick + HEAD_LEN, 0)) return 'holder';
    }
    return null;
  }

  return { VICE: VICE, HEAD_LEN: HEAD_LEN, grid: grid, field: field, disc: disc, axis: axis, isBall: isBall,
           stamp: stamp, probe: probe, holderHits: holderHits, vice: vice, viceHit: viceHit };
})();
if (typeof module !== 'undefined') module.exports = TNC_STOCK;
