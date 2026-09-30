/*
 * TNC_FX - machining visual effects for the TNC 426 simulator.
 * Metal chips, sparks, coolant jet + splash + mist, smoke, fire, crash burst.
 *
 * Two back ends, same public API (create/update/crash/set/setMaterial/resize/
 * clear/dispose/stats/object3d):
 *   - createQuarks: chips/sparks/coolant/smoke/fire spawned onto
 *     window.QUARKS (three.quarks) ParticleSystems, one BatchedRenderer draw
 *     call per shared material. Per-particle motion (gravity, drag, surface
 *     bounce/rest, the coolant jet's ballistic arc, smoke growth, flame
 *     ramp) is done with small custom Behavior objects (see "QUARKS back
 *     end" below) - three.quarks owns the instancing/GPU upload, we own the
 *     physics, exactly like the legacy pools did with raw typed arrays.
 *   - createLegacy: the original CPU-typed-array / procedural-shader engine,
 *     used whenever window.QUARKS isn't present (used to be the only path;
 *     kept verbatim as the fallback and reference).
 *
 * World: millimetres, Z up.
 *
 * MIT License - Copyright (c) 2026 TNC 426 Simulator contributors
 * (written from scratch for this project; no third-party code vendored)
 */
var TNC_FX = (function () {
  'use strict';

  var G = 9810;                 // gravity, mm/s^2
  var TAU = Math.PI * 2;

  function rnd(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  // Tunable knobs for the QUARKS back end, kept as data so the look can be
  // retuned later without touching the spawn/behavior code below. Pool caps
  // mirror the legacy pool sizes; opts.maxChips etc still override maxChips.
  var Q_EFFECTS = {
    maxChips: 1800, maxSparks: 900, maxDrops: 2400, maxSoft: 700, maxGlow: 700,
    rate: { chip: 70, spark: 3.5, smoke: 12, fire: 130, jet: 800 },
    chip:  { life: [3.5, 6.5], drag: 3.5, restKick: [250, 800], kickPad: 1.2 },
    spark: { drag: 2.5 },
    jet:   { life: 0.11, jitter: 22 },
    splash:{ life: [0.22, 0.6], drag: 1.5 },
    soft:  { drag: 0.8 },
    crash: { sparks: 420, chipsHeavy: 16, chipsShatter: 45, smoke: 22 }
  };

  /* ---------------------------------------------------------------- shaders */
  // MODE 0 soft puff (smoke / mist / flame / flash), 1 chip, 2 droplet streak, 3 spark streak.
  var VS = [
    'attribute vec3 aVel;',       // streak modes: velocity (mm/s). chip mode: (angle, flip phase, kind)
    'attribute vec3 aColor;',
    'attribute float aSize;',     // world mm
    'attribute float aAlpha;',
    'uniform float uScale;',      // framebuffer px per (mm / mm-depth)
    'uniform float uStretch;',    // seconds of motion blur for streaks
    'uniform float uMinPx;',
    'uniform float uMaxPx;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'varying vec4 vShape;',
    'void main() {',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  float depth = max(-mv.z, 1.0);',
    '  float base = aSize * uScale / depth;',
    '  float a = aAlpha;',
    '  if (base < uMinPx) { a *= max(base / uMinPx, 0.35); base = uMinPx; }',
    '  base = min(base, uMaxPx);',
    '#if MODE == 1',
    '  gl_Position = projectionMatrix * mv;',
    '  gl_PointSize = base;',
    '  vShape = vec4(aVel, base);',
    '#else',
    '  vec4 mt = modelViewMatrix * vec4(position - aVel * uStretch, 1.0);',
    '  float dt = max(-mt.z, 1.0);',
    '  vec2 d = (mv.xy / depth - mt.xy / dt) * uScale + vec2(1e-4, 0.0);',
    '  float full = length(d);',
    '  float len = min(full, uMaxPx - base);',
    '  float ps = base + len;',
    '  vec3 mid = mix(mv.xyz, mt.xyz, 0.5 * len / full);',
    '  gl_Position = projectionMatrix * vec4(mid, 1.0);',
    '  gl_PointSize = ps;',
    '  vShape = vec4(atan(d.y, d.x), 0.5 * len / ps, 0.5 * base / ps, 0.0);',
    '#endif',
    '  vColor = aColor;',
    '  vAlpha = a;',
    '}'
  ].join('\n');

  var FS = [
    'varying vec3 vColor;',
    'varying float vAlpha;',
    'varying vec4 vShape;',
    'void main() {',
    '  vec2 p = gl_PointCoord - 0.5; p.y = -p.y;',
    '  float c = cos(vShape.x), s = sin(vShape.x);',
    '  vec2 q = vec2(p.x * c + p.y * s, -p.x * s + p.y * c);',
    '#if MODE == 1',
    // chip: aluminium curl (comma) or crash debris chunk, tumbling = squash + glint
    '  q *= 2.0;',
    '  float sq = 0.28 + 0.72 * abs(cos(vShape.y));',
    '  q.y /= sq;',
    '  float glint = pow(abs(sin(vShape.y * 1.7 + vShape.x * 0.5)), 14.0);',
    '  float m; float shade;',
    '  if (vShape.z > 0.5) {',
    '    vec2 b = abs(q);',
    '    m = step(b.x, 0.85) * step(b.y, 0.62) * step(b.x + b.y, 1.15);',
    '    shade = 0.72 + 0.28 * q.y - 0.12 * q.x;',
    '  } else if (vShape.w < 7.0) {',
    '    m = step(length(q * vec2(0.8, 1.0)), 0.95);',
    '    shade = 0.8 + 0.2 * q.y;',
    '  } else {',
    '    vec2 r = q - vec2(0.0, -0.1);',
    '    float rad = length(r);',
    '    float t = (atan(r.y, r.x) + 3.14159) / 6.28318;',
    '    float th = mix(0.07, 0.3, clamp((t - 0.12) / 0.74, 0.0, 1.0));',
    '    m = step(abs(rad - 0.6), th) * step(0.12, t) * step(t, 0.86);',
    '    shade = 0.62 + 0.38 * t + 0.25 * (rad - 0.6) / th;',
    '  }',
    '  if (m < 0.5) discard;',
    '  gl_FragColor = vec4(vColor * shade + vec3(0.42) * glint, vAlpha);',
    '#else',
    '  float hl = vShape.y, rr = vShape.z;',
    '  float dd = length(vec2(max(abs(q.x) - hl, 0.0), q.y)) / rr;',
    '  if (dd > 1.0) discard;',
    '  float along = hl > 0.001 ? clamp(q.x / (hl + rr) * 0.5 + 0.5, 0.0, 1.0) : 1.0;',
    '#if MODE == 0',
    '  float f = 1.0 - dd * dd; f *= f;',
    '#ifdef PREMUL',   // emissive-over: adds light and partly occludes what is behind (keeps fire saturated on bright parts)
    '  gl_FragColor = vec4(vColor * vAlpha * f * 1.6, vAlpha * f * 0.75);',
    '#else',
    '  gl_FragColor = vec4(vColor, vAlpha * f);',
    '#endif',
    '#elif MODE == 2',
    '  float f = smoothstep(1.0, 0.45, dd);',
    '  float hi = pow(1.0 - dd, 3.0) * 0.45;',
    '  gl_FragColor = vec4(vColor * (0.78 + 0.22 * along) + hi, vAlpha * f * (0.5 + 0.5 * along));',
    '#else',
    '  float core = exp(-dd * dd * 5.0);',
    '  vec3 col = mix(vColor, vec3(1.0, 0.97, 0.85), core * core * 0.7);',
    '  gl_FragColor = vec4(col, vAlpha * core * (0.2 + 0.8 * along));',
    '#endif',
    '#endif',
    '}'
  ].join('\n');

  /* ------------------------------------------------------------------ pool */
  function Pool(THREE, root, scaleU, n, mode, additive, stretch, minPx, maxPx, order) {
    this.n = n; this.count = 0; this.shown = -1;
    this.p = new Float32Array(n * 3);   // position   (GPU)
    this.g = new Float32Array(n * 3);   // aVel       (GPU)
    this.c = new Float32Array(n * 3);   // aColor     (GPU)
    this.s = new Float32Array(n);       // aSize      (GPU)
    this.a = new Float32Array(n);       // aAlpha     (GPU)
    this.v = new Float32Array(n * 3);   // physical velocity
    this.e = new Float32Array(n * 4);   // per-effect scratch
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.k = new Uint8Array(n);         // kind / state
    var geo = new THREE.BufferGeometry();
    function attr(name, arr, sz) {
      var at = new THREE.BufferAttribute(arr, sz);
      at.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(name, at);
      return at;
    }
    this.attrs = [attr('position', this.p, 3), attr('aVel', this.g, 3), attr('aColor', this.c, 3),
      attr('aSize', this.s, 1), attr('aAlpha', this.a, 1)];
    geo.setDrawRange(0, 0);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      defines: additive === 2 ? { MODE: mode, PREMUL: 1 } : { MODE: mode },
      uniforms: {
        uScale: scaleU,
        uStretch: { value: stretch },
        uMinPx: { value: minPx },
        uMaxPx: { value: maxPx }
      },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthTest: true,
      depthWrite: mode === 1,
      blending: additive === 2 ? THREE.CustomBlending : (additive ? THREE.AdditiveBlending : THREE.NormalBlending),
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor
    });
    this.pts = new THREE.Points(geo, this.mat);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = order;
    this.pts.visible = false;
    root.add(this.pts);
  }
  // Returns a slot index (recycles a random live slot when full) - caller fills every field.
  Pool.prototype.add = function (x, y, z, vx, vy, vz, life, size, r, g, b, alpha, kind) {
    var i = this.count < this.n ? this.count++ : (Math.random() * this.n) | 0;
    var i3 = i * 3, i4 = i * 4;
    this.p[i3] = x; this.p[i3 + 1] = y; this.p[i3 + 2] = z;
    this.v[i3] = vx; this.v[i3 + 1] = vy; this.v[i3 + 2] = vz;
    this.g[i3] = vx; this.g[i3 + 1] = vy; this.g[i3 + 2] = vz;
    this.c[i3] = r; this.c[i3 + 1] = g; this.c[i3 + 2] = b;
    this.e[i4] = this.e[i4 + 1] = this.e[i4 + 2] = this.e[i4 + 3] = 0;
    this.s[i] = this.s0[i] = size; this.a[i] = alpha;
    this.age[i] = 0; this.life[i] = life; this.k[i] = kind || 0;
    return i;
  };
  Pool.prototype.kill = function (i) {
    var j = --this.count;
    if (i === j) return;
    var i3 = i * 3, j3 = j * 3, i4 = i * 4, j4 = j * 4, t;
    for (t = 0; t < 3; t++) {
      this.p[i3 + t] = this.p[j3 + t]; this.g[i3 + t] = this.g[j3 + t];
      this.c[i3 + t] = this.c[j3 + t]; this.v[i3 + t] = this.v[j3 + t];
    }
    for (t = 0; t < 4; t++) this.e[i4 + t] = this.e[j4 + t];
    this.s[i] = this.s[j]; this.a[i] = this.a[j]; this.s0[i] = this.s0[j];
    this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.k[i] = this.k[j];
  };
  Pool.prototype.upload = function () {
    var n = this.count;
    if (n === 0 && this.shown === 0) return;          // nothing live, nothing to upload
    this.geo.setDrawRange(0, n);
    this.pts.visible = n > 0;
    this.shown = n;
    if (n === 0) return;
    for (var i = 0; i < this.attrs.length; i++) {
      var at = this.attrs[i];
      // r159+ dropped BufferAttribute.updateRange (a single {offset,count})
      // in favour of updateRanges (a list) via addUpdateRange(); the old
      // single-range object no longer exists so setting .offset on it threw
      // ("Cannot set properties of undefined"), silently caught by ui.js's
      // per-frame try/catch -- nothing ever got uploaded to the GPU.
      if (at.updateRange) {
        at.updateRange.offset = 0;
        at.updateRange.count = n * at.itemSize;
      }
      if (typeof at.clearUpdateRanges === 'function') {
        at.clearUpdateRanges();
        at.addUpdateRange(0, n * at.itemSize);
      }
      at.needsUpdate = true;
    }
  };
  Pool.prototype.dispose = function () { this.geo.dispose(); this.mat.dispose(); };

  // hot metal colour ramp: t 0 = white-yellow, 0.35 = orange, 1 = dull red
  function heat(t, out, o) {
    var r, g, b, u;
    if (t < 0.35) { u = t / 0.35; r = 1; g = 0.95 - 0.37 * u; b = 0.72 - 0.56 * u; }
    else { u = (t - 0.35) / 0.65; r = 1 - 0.3 * u; g = 0.58 - 0.47 * u; b = 0.16 - 0.14 * u; }
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
  }

  /* --------------------------------------------------------- LEGACY back end
   * CPU typed arrays + procedural shaders. Unchanged from the original
   * single-implementation version of this file; used as the fallback when
   * window.QUARKS is missing. */
  function createLegacy(THREE, scene, opts) {
    opts = opts || {};
    var root = new THREE.Group();
    root.name = 'TNC_FX';
    scene.add(root);

    // material tint: multiplies chip / spark base colours so a preset from
    // materials.js (aluminium, steel, titanium, ...) reads correctly here
    // too, without this module knowing anything about the preset list.
    var chipTint = { r: 1, g: 1, b: 1 }, sparkTint = { r: 1, g: 1, b: 1 };
    function hexOf(v, d) {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') { var n = parseInt(v.replace('#', ''), 16); return isNaN(n) ? d : n; }
      return d;
    }
    function setTint(out, hex) { out.r = ((hex >> 16) & 255) / 255; out.g = ((hex >> 8) & 255) / 255; out.b = (hex & 255) / 255; }

    var scaleU = { value: 800 / (2 * Math.tan(22.5 * Math.PI / 180)) };
    //                         n                   mode add   stretch minPx maxPx order
    var chips  = new Pool(THREE, root, scaleU, opts.maxChips || 1800, 1, false, 0,     1.6, 48,  1);
    var drops  = new Pool(THREE, root, scaleU, 2400,               2, false, 0.011, 1.2, 64,  2);
    var sparks = new Pool(THREE, root, scaleU, 900,                3, true,  0.018, 1.8, 110, 5);
    var soft   = new Pool(THREE, root, scaleU, 700,                0, false, 0,     1.0, 256, 3);
    var glow   = new Pool(THREE, root, scaleU, 700,                0, 2,     0.012, 1.0, 256, 4);
    var pools = [chips, drops, sparks, soft, glow];

    // Crash flash light: lives in the scene permanently at intensity 0 so that
    // flashing it never changes the light count (no shader recompiles / hitches).
    var LK = (+THREE.REVISION >= 155) ? Math.PI : 1;   // r155+: physical units; decay 0 ~ the r128 falloff inside 600
    var light = new THREE.PointLight(0xffb060, 0, 600, LK > 1 ? 0 : 2);
    root.add(light);

    // Coolant nozzle (segmented "Loc-Line" hose + orange tip), follows the tool.
    var nozzle = null, nozzleGeos = [], nozzleMats = [];
    if (opts.nozzle !== false) {
      nozzle = new THREE.Group();
      var segGeo = new THREE.CylinderGeometry(2.4, 3.3, 5.6, 12);
      var tipGeo = new THREE.CylinderGeometry(1.1, 2.4, 6, 12);
      var hoseMat = new THREE.MeshLambertMaterial({ color: 0x2f6db3 });
      var tipMat = new THREE.MeshLambertMaterial({ color: 0xe0782a });
      nozzleGeos.push(segGeo, tipGeo); nozzleMats.push(hoseMat, tipMat);
      var tip = new THREE.Mesh(tipGeo, tipMat); tip.position.y = -3; nozzle.add(tip);
      for (var sgi = 0; sgi < 9; sgi++) {
        var seg = new THREE.Mesh(segGeo, hoseMat);
        seg.position.y = -8.5 - sgi * 5.4;
        nozzle.add(seg);
      }
      nozzle.visible = false;
      root.add(nozzle);
    }
    var Y = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3();

    var en = { chips: true, sparks: true, coolant: true, smoke: false, fire: false };
    var acc = { chip: 0, spark: 0, cool: 0, smoke: 0, fire: 0 };
    var frame = 0, flashAge = 9;

    var fx = { surfaceAt: null };

    // surface height at (x,y); NaN = off the part.
    function surf(x, y, st) {
      var f = fx.surfaceAt;
      if (typeof f !== 'function') return st;
      var z = f(x, y);
      return (typeof z === 'number' && z === z && z > -1e9 && z < 1e9) ? z : NaN;
    }

    /* --------------------------------------------------------- spawners */
    // point on the cutter periphery: side of the feed direction (random), a bit forward.
    var per = { x: 0, y: 0, ox: 0, oy: 0 };
    function periphery(s, rFrac) {
      var dx = (s.dir && s.dir.x) || 0, dy = (s.dir && s.dir.y) || 0, dl = Math.sqrt(dx * dx + dy * dy);
      var ox, oy;
      if (dl > 0.1) {
        dx /= dl; dy /= dl;
        var side = Math.random() < 0.5 ? 1 : -1;
        var fw = rnd(-0.15, 0.7);
        ox = -dy * side + dx * fw; oy = dx * side + dy * fw;
      } else {
        var an = Math.random() * TAU; ox = Math.cos(an); oy = Math.sin(an);
      }
      var ol = Math.sqrt(ox * ox + oy * oy) || 1;
      ox /= ol; oy /= ol;
      var R = (s.toolR || 3) * rFrac;
      per.ox = ox; per.oy = oy; per.x = s.pos.x + ox * R; per.y = s.pos.y + oy * R;
      return per;
    }

    function spawnChip(s, st, sgn, R, pre) {
      var o = periphery(s, 0.9);
      var z = s.pos.z + rnd(0.2, Math.max(0.4, Math.min(4, st - s.pos.z)));
      var sz = surf(o.x, o.y, st);
      if (sz === sz && z < sz + 0.1) z = sz + 0.1;
      // tangential direction of cutter rotation: M3 = clockwise seen from above (omega along -Z)
      var tx = o.oy * sgn, ty = -o.ox * sgn;
      var vPer = TAU * R * Math.abs(s.spindle) / 60000 * 1000; // mm/s
      var fast = Math.random() < 0.4;
      var spd = fast ? clamp(vPer * rnd(0.3, 0.8), 350, 1600) : rnd(50, 260);
      var rad = spd * rnd(0.05, 0.35);
      var up = fast ? rnd(150, 750) : rnd(120, 420);
      var gr = rnd(0.58, 0.86);
      var size = clamp(0.7 + R * 0.07, 0.8, 2.0) * rnd(0.75, 1.25);
      var i = chips.add(o.x, o.y, z, tx * spd + o.ox * rad, ty * spd + o.oy * rad, up,
        rnd(3.5, 6.5), size, gr * 0.97 * chipTint.r, gr * 0.99 * chipTint.g, gr * 1.03 * chipTint.b, 1, 0);
      var i3 = i * 3, i4 = i * 4;
      chips.g[i3] = Math.random() * TAU; chips.g[i3 + 1] = Math.random() * TAU; chips.g[i3 + 2] = 0;
      chips.e[i4] = rnd(-30, 30); chips.e[i4 + 1] = rnd(-40, 40);
      advance(chips, i, pre * 0.5, G);
    }

    function spawnSpark(x, y, z, vx, vy, vz, life, size) {
      var i = sparks.add(x, y, z, vx, vy, vz, life, size, 1, 0.95, 0.72, 1, 0);
      return i;
    }

    function cuttingSparks(s, sgn) {
      var o = periphery(s, 1.0);
      var n = 1 + ((Math.random() * 3) | 0);
      var tx = o.oy * sgn, ty = -o.ox * sgn;
      for (var j = 0; j < n; j++) {
        var spd = rnd(700, 2000);
        spawnSpark(o.x, o.y, s.pos.z + rnd(0.3, 2),
          tx * spd + o.ox * spd * rnd(0, 0.3) + rnd(-150, 150),
          ty * spd + o.oy * spd * rnd(0, 0.3) + rnd(-150, 150),
          rnd(150, 800), rnd(0.12, 0.32), rnd(0.5, 0.75));
      }
    }

    // coolant geometry: nozzle tip N, aim point A (at the cutter, facing the nozzle)
    var cool = { nx: 0, ny: 0, nz: 0, ax: 0, ay: 0, az: 0 };
    function coolGeom(s) {
      var R = s.toolR || 3, hx = 0.78, hy = 0.625, off = R + 36;
      cool.nx = s.pos.x + hx * off; cool.ny = s.pos.y + hy * off; cool.nz = s.pos.z + 60;
      cool.ax = s.pos.x + hx * R * 0.9; cool.ay = s.pos.y + hy * R * 0.9; cool.az = s.pos.z + 3;
    }

    // Jet droplets live in the nozzle's frame: the stream is re-evaluated every frame
    // from the current nozzle/aim points (ballistic arc that ends on the cutter), so
    // it stays attached to the tool at any feed / sim speed. v = small jitter velocity.
    var JET_T = 0.11;
    function spawnJet(pre) {
      var j = 22, b = rnd(0.9, 1.0);
      var i = drops.add(cool.nx, cool.ny, cool.nz, rnd(-j, j), rnd(-j, j), rnd(-j, j),
        JET_T * rnd(0.97, 1.03), rnd(1.2, 1.8), 0.72 * b, 0.86 * b, 1.0 * b, 0.36, 0);
      drops.age[i] = pre || 0;
      jetPlace(i);
    }
    function jetPlace(i) {
      var i3 = i * 3, t = drops.age[i], T = drops.life[i], u = t / T;
      var sag = 0.5 * G * t * (T - t), V = drops.v;
      drops.p[i3] = cool.nx + (cool.ax - cool.nx) * u + V[i3] * t;
      drops.p[i3 + 1] = cool.ny + (cool.ay - cool.ny) * u + V[i3 + 1] * t;
      drops.p[i3 + 2] = cool.nz + (cool.az - cool.nz) * u + V[i3 + 2] * t + sag;
      drops.g[i3] = (cool.ax - cool.nx) / T + V[i3];
      drops.g[i3 + 1] = (cool.ay - cool.ny) / T + V[i3 + 1];
      drops.g[i3 + 2] = (cool.az - cool.nz) / T + V[i3 + 2] + 0.5 * G * (T - 2 * t);
    }

    // Spread a frame's spawns over the frame interval (keeps streams continuous at low fps).
    function advance(pool, i, pre, grav) {
      if (!(pre > 0)) return;
      var i3 = i * 3;
      pool.v[i3 + 2] -= grav * pre;
      pool.p[i3] += pool.v[i3] * pre; pool.p[i3 + 1] += pool.v[i3 + 1] * pre; pool.p[i3 + 2] += pool.v[i3 + 2] * pre;
      pool.age[i] = pre;
    }

    function splash(x, y, z, s, st, sgn, cutting) {
      var px = s.pos.x, py = s.pos.y;
      var ox = x - px, oy = y - py, ol = Math.sqrt(ox * ox + oy * oy) || 1;
      ox /= ol; oy /= ol;
      var tx = oy * sgn, ty = -ox * sgn;
      var n = cutting ? 2 : 1;
      for (var j = 0; j < n; j++) {
        var ts = s.spindle ? rnd(120, 650) : 0, rs = rnd(80, 420);
        var a = Math.random() * TAU, rr = rnd(0, 120);
        var b = rnd(0.85, 1.0);
        drops.add(x, y, z, tx * ts + ox * rs + Math.cos(a) * rr, ty * ts + oy * rs + Math.sin(a) * rr, rnd(40, 420),
          rnd(0.22, 0.6), rnd(0.45, 1.0), 0.78 * b, 0.9 * b, 1.0 * b, 0.55, 1);
      }
      if (Math.random() < (cutting ? 0.06 : 0.015)) {
        var m = Math.random() * TAU, ms = rnd(30, 110);
        soft.add(x, y, z + rnd(0, 2), Math.cos(m) * ms, Math.sin(m) * ms, rnd(15, 60),
          rnd(0.6, 1.1), rnd(3, 5), 0.86, 0.92, 1.0, 0, 1);
      }
    }

    function spawnSmoke(s, dark) {
      var R = s.toolR || 3, an = Math.random() * TAU, r = R * rnd(0.3, 1.2);
      var gr = dark ? rnd(0.2, 0.3) : rnd(0.5, 0.66);
      var i = soft.add(s.pos.x + Math.cos(an) * r, s.pos.y + Math.sin(an) * r, s.pos.z + rnd(0, 2.5),
        rnd(-8, 8), rnd(-8, 8), dark ? rnd(40, 90) : rnd(16, 38),
        dark ? rnd(1.2, 2.0) : rnd(2.2, 3.6), (4 + R * 0.6) * rnd(0.8, 1.2) * (dark ? 1.4 : 1),
        gr * 1.02, gr, gr * 0.97, 0, dark ? 2 : 0);
      soft.e[i * 4] = rnd(3.5, 5.5);           // growth factor
    }

    function spawnFlame(s) {
      var R = s.toolR || 3, an = Math.random() * TAU, r = R * rnd(0.6, 1.2);
      var core = Math.random() < 0.35;               // small bright licks at the base
      var i = glow.add(s.pos.x + Math.cos(an) * r, s.pos.y + Math.sin(an) * r, s.pos.z + rnd(0, 1.5),
        rnd(-12, 12), rnd(-12, 12), core ? rnd(20, 50) : rnd(30, 90),
        core ? rnd(0.12, 0.22) : rnd(0.18, 0.36), (3 + R * 0.45) * rnd(0.8, 1.2) * (core ? 0.55 : 1),
        1, 0.9, 0.55, 0.5, 0);
      glow.e[i * 4] = core ? 0.45 : 1;               // colour-ramp speed
    }

    /* ----------------------------------------------------------- update */
    fx.update = function (dt, s) {
      dt = +dt || 0;
      if (dt > 0.1) dt = 0.1;
      if (!(dt > 0)) return;
      s = s || {};
      frame++;
      var st = (typeof s.stockTop === 'number' && isFinite(s.stockTop)) ? s.stockTop : 0;
      var hasPos = !!(s.pos && isFinite(s.pos.x) && isFinite(s.pos.y) && isFinite(s.pos.z));
      var spin = +s.spindle || 0, sgn = spin < 0 ? -1 : 1;
      var R = Math.max(0.2, +s.toolR || 3);
      var speed = clamp(+s.speed || 1, 1, 1000);
      var mul = Math.min(Math.pow(speed, 0.45), 5);      // sub-linear, capped
      var active = !!s.running && hasPos;
      var cutting = active && !!s.cutting && spin !== 0;
      var coolOn = active && !!s.coolant && spin !== 0 && en.coolant;
      if (hasPos) {
        coolGeom(s);
      }

      var i, i3, i4, t, k;

      /* chips */
      var P = chips.p, V = chips.v, E = chips.e, Gv = chips.g, drag = Math.exp(-3.5 * dt);
      var toolX = hasPos ? s.pos.x : 1e9, toolY = hasPos ? s.pos.y : 1e9, toolZ = hasPos ? s.pos.z : 0;
      var kickR2 = (R + 1.2) * (R + 1.2);
      for (i = chips.count - 1; i >= 0; i--) {
        chips.age[i] += dt;
        var left = chips.life[i] - chips.age[i];
        if (left <= 0) { chips.kill(i); continue; }
        var al = left < 0.8 ? left / 0.8 : 1;
        chips.a[i] = al; chips.s[i] = chips.s0[i] * (0.55 + 0.45 * al);
        i3 = i * 3; i4 = i * 4;
        if (chips.k[i] === 1) {                           // resting
          if (spin !== 0) {
            var kx = P[i3] - toolX, ky = P[i3 + 1] - toolY, kd = kx * kx + ky * ky;
            if (kd < kickR2 && P[i3 + 2] > toolZ - 1 && P[i3 + 2] < toolZ + 60) {
              kd = Math.sqrt(kd) || 1; kx /= kd; ky /= kd;
              var ks = rnd(250, 800);
              V[i3] = ky * sgn * ks + kx * 150; V[i3 + 1] = -kx * sgn * ks + ky * 150; V[i3 + 2] = rnd(150, 450);
              E[i4] = rnd(-30, 30); E[i4 + 1] = rnd(-40, 40); E[i4 + 2] = 0;
              chips.k[i] = 0;
            }
          }
          if (chips.k[i] === 1 && ((i + frame) & 7) === 0) {
            var rz = surf(P[i3], P[i3 + 1], st);
            if (rz !== rz || rz < P[i3 + 2] - 0.3) { chips.k[i] = 0; V[i3] = V[i3 + 1] = V[i3 + 2] = 0; E[i4 + 2] = 1; }
          }
          continue;
        }
        V[i3 + 2] -= G * dt;
        V[i3] *= drag; V[i3 + 1] *= drag; V[i3 + 2] *= drag;
        var ox = P[i3], oy = P[i3 + 1], oz = P[i3 + 2];
        var nx = ox + V[i3] * dt, ny = oy + V[i3 + 1] * dt, nz = oz + V[i3 + 2] * dt;
        Gv[i3] += E[i4] * dt; Gv[i3 + 1] += E[i4 + 1] * dt;
        var sz = surf(nx, ny, st);
        if (sz !== sz) {                                  // off the part: keep falling
          if (nz < st - 200) { chips.kill(i); continue; }
        } else if (nz < sz) {
          if (oz >= sz - 0.05) {                          // came down onto the surface
            if (V[i3 + 2] < -260 && E[i4 + 2] < 1) {
              nz = sz + 0.01; V[i3 + 2] *= -0.25; V[i3] *= 0.45; V[i3 + 1] *= 0.45;
              E[i4] *= 0.5; E[i4 + 1] *= 0.5; E[i4 + 2] = 1;
            } else { nz = sz + 0.03; chips.k[i] = 1; V[i3] = V[i3 + 1] = V[i3 + 2] = 0; }
          } else {                                        // hit a wall from inside a pocket
            nx = ox; ny = oy; V[i3] *= -0.3; V[i3 + 1] *= -0.3;
            var so = surf(ox, oy, st);
            if (so === so && nz < so) { nz = so + 0.03; chips.k[i] = 1; V[i3] = V[i3 + 1] = V[i3 + 2] = 0; }
          }
        }
        P[i3] = nx; P[i3 + 1] = ny; P[i3 + 2] = nz;
      }

      /* sparks */
      P = sparks.p; V = sparks.v; Gv = sparks.g; drag = Math.exp(-2.5 * dt);
      for (i = sparks.count - 1; i >= 0; i--) {
        sparks.age[i] += dt;
        t = sparks.age[i] / sparks.life[i];
        if (t >= 1) { sparks.kill(i); continue; }
        i3 = i * 3;
        heat(t, sparks.c, i3);
        sparks.c[i3] *= sparkTint.r; sparks.c[i3 + 1] *= sparkTint.g; sparks.c[i3 + 2] *= sparkTint.b;
        sparks.a[i] = Math.pow(1 - t, 1.3);
        sparks.s[i] = sparks.s0[i] * (1 - 0.4 * t);
        V[i3 + 2] -= G * 0.6 * dt;
        V[i3] *= drag; V[i3 + 1] *= drag; V[i3 + 2] *= drag;
        P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
        if (V[i3 + 2] < 0) {
          var ssz = surf(P[i3], P[i3 + 1], st);
          if (ssz === ssz && P[i3 + 2] < ssz && P[i3 + 2] > ssz - 6) {
            P[i3 + 2] = ssz + 0.01; V[i3 + 2] *= -0.35; V[i3] *= 0.6; V[i3 + 1] *= 0.6;
          }
        }
        Gv[i3] = V[i3]; Gv[i3 + 1] = V[i3 + 1]; Gv[i3 + 2] = V[i3 + 2];
      }

      /* coolant droplets: kind 0 = jet, 1 = splash */
      P = drops.p; V = drops.v; Gv = drops.g;
      var dragS = Math.exp(-1.5 * dt);
      for (i = drops.count - 1; i >= 0; i--) {
        drops.age[i] += dt;
        i3 = i * 3;
        k = drops.k[i];
        if (k === 0) {
          if (drops.age[i] < drops.life[i]) jetPlace(i);
          var dz = surf(P[i3], P[i3 + 1], st);
          var hitS = dz === dz && P[i3 + 2] < dz;
          if (drops.age[i] >= drops.life[i] || hitS) {
            var hx = P[i3], hy = P[i3 + 1], hz = hitS ? dz + 0.05 : P[i3 + 2];
            drops.kill(i);
            if (hasPos) splash(hx, hy, hz, s, st, sgn, cutting);
            continue;
          }
          // slight break-up of the jet towards the end
          var tt = drops.age[i] / drops.life[i];
          drops.a[i] = 0.3 + 0.12 * tt;
          continue;
        } else {
          t = drops.age[i] / drops.life[i];
          if (t >= 1) { drops.kill(i); continue; }
          V[i3 + 2] -= G * dt;
          V[i3] *= dragS; V[i3 + 1] *= dragS; V[i3 + 2] *= dragS;
          P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
          drops.a[i] = 0.55 * (1 - t * t);
          if (V[i3 + 2] < 0) {
            var sd = surf(P[i3], P[i3 + 1], st);
            if (sd === sd && P[i3 + 2] < sd) {
              if (drops.s0[i] > 0.7 && Math.random() < 0.3) { P[i3 + 2] = sd + 0.02; V[i3 + 2] *= -0.3; V[i3] *= 0.5; V[i3 + 1] *= 0.5; drops.s0[i] *= 0.6; drops.s[i] = drops.s0[i]; }
              else { drops.kill(i); continue; }
            } else if (sd !== sd && P[i3 + 2] < st - 200) { drops.kill(i); continue; }
          }
          Gv[i3] = V[i3] * 0.3; Gv[i3 + 1] = V[i3 + 1] * 0.3; Gv[i3 + 2] = V[i3 + 2] * 0.3;
          continue;
        }
        Gv[i3] = V[i3]; Gv[i3 + 1] = V[i3 + 1]; Gv[i3 + 2] = V[i3 + 2];
      }

      /* soft: 0 smoke, 1 mist, 2 crash smoke */
      P = soft.p; V = soft.v; E = soft.e;
      drag = Math.exp(-0.8 * dt);
      for (i = soft.count - 1; i >= 0; i--) {
        soft.age[i] += dt;
        t = soft.age[i] / soft.life[i];
        if (t >= 1) { soft.kill(i); continue; }
        i3 = i * 3; k = soft.k[i];
        if (k === 1) {
          V[i3] *= Math.exp(-2.5 * dt); V[i3 + 1] *= Math.exp(-2.5 * dt); V[i3 + 2] *= Math.exp(-2.5 * dt);
          soft.s[i] = soft.s0[i] * (1 + 2.4 * t);
          soft.a[i] = 0.16 * Math.min(1, t * 6) * (1 - t);
        } else {
          V[i3 + 2] += (k === 2 ? 30 : 12) * dt;           // buoyancy
          V[i3] *= drag; V[i3 + 1] *= drag;
          V[i3] += rnd(-20, 20) * dt; V[i3 + 1] += rnd(-20, 20) * dt;
          soft.s[i] = soft.s0[i] * (1 + (E[i * 4] - 1) * Math.sqrt(t));
          soft.a[i] = (k === 2 ? 0.45 : 0.4) * Math.min(1, t * 5) * (1 - t) * (1 - t);
        }
        P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
      }

      /* glow: 0 flame, 1 flash */
      P = glow.p; V = glow.v; Gv = glow.g;
      for (i = glow.count - 1; i >= 0; i--) {
        glow.age[i] += dt;
        t = glow.age[i] / glow.life[i];
        if (t >= 1) { glow.kill(i); continue; }
        i3 = i * 3;
        if (glow.k[i] === 1) {
          glow.a[i] = 0.85 * (1 - t) * (1 - t);
          glow.s[i] = glow.s0[i] * (0.6 + 0.6 * t);
        } else {
          V[i3 + 2] += 180 * dt;
          var ht = t * glow.e[i * 4];
          glow.c[i3] = 1 - 0.4 * ht; glow.c[i3 + 1] = 0.62 - 0.52 * ht; glow.c[i3 + 2] = Math.max(0.02, 0.2 - 0.22 * ht);
          glow.a[i] = (glow.e[i * 4] < 1 ? 0.6 : 0.42) * Math.min(1, t * 8) * (1 - t);
          glow.s[i] = glow.s0[i] * (0.7 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.4))) * (1 - 0.5 * t) * rnd(0.85, 1.15);
          P[i3] += V[i3] * dt; P[i3 + 1] += V[i3 + 1] * dt; P[i3 + 2] += V[i3 + 2] * dt;
          Gv[i3] = V[i3]; Gv[i3 + 1] = V[i3 + 1]; Gv[i3 + 2] = V[i3 + 2];
        }
      }

      /* spawn (after the simulation step, so a spawn pre-advanced by a fraction of dt sits where it belongs) */
      if (cutting) {
        if (en.chips) {
          acc.chip += dt * 70 * clamp(Math.sqrt(R / 4), 0.6, 2) * mul;
          while (acc.chip >= 1) { acc.chip -= 1; spawnChip(s, st, sgn, R, Math.random() * dt); }
        }
        if (en.sparks) {
          acc.spark += dt * 3.5 * mul;
          while (acc.spark >= 1) { acc.spark -= 1; cuttingSparks(s, sgn); }
        }
        if (en.smoke) {
          acc.smoke += dt * 12 * Math.min(Math.pow(speed, 0.3), 2.5);
          while (acc.smoke >= 1) { acc.smoke -= 1; spawnSmoke(s, false); }
        }
        if (en.fire) {
          acc.fire += dt * 130 * Math.min(Math.pow(speed, 0.3), 2.5);
          while (acc.fire >= 1) { acc.fire -= 1; spawnFlame(s); }
        }
      } else { acc.chip = acc.spark = acc.smoke = acc.fire = 0; }
      if (coolOn) {
        acc.cool += dt * 800;
        while (acc.cool >= 1) { acc.cool -= 1; spawnJet(Math.random() * dt); }
      } else acc.cool = 0;

      if (nozzle) {
        nozzle.visible = hasPos && en.coolant && !!s.coolant;
        if (nozzle.visible) {
          nozzle.position.set(cool.nx, cool.ny, cool.nz);
          tmpV.set(cool.ax - cool.nx, cool.ay - cool.ny, cool.az - cool.nz).normalize();
          nozzle.quaternion.setFromUnitVectors(Y, tmpV);
        }
      }

      /* crash light */
      if (flashAge < 9) {
        flashAge += dt;
        light.intensity = flashAge < 0.35 ? LK * 7 * Math.exp(-flashAge / 0.09) : 0;
        if (flashAge >= 0.35) flashAge = 9;
      }

      for (i = 0; i < pools.length; i++) pools[i].upload();
    };

    /* ------------------------------------------------------------- crash */
    fx.crash = function (pos) {
      if (!pos || !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) return;
      var x = pos.x, y = pos.y, z = pos.z, j, a, sp, el, ce;
      if (en.sparks) {
        for (j = 0; j < 420; j++) {
          a = Math.random() * TAU;
          el = Math.pow(Math.random(), 0.6) * 1.35 - 0.15;          // elevation, biased upward
          ce = Math.cos(el);
          sp = rnd(600, 4600) * (Math.random() < 0.15 ? 1.4 : 1);
          spawnSpark(x + rnd(-2, 2), y + rnd(-2, 2), z + rnd(0, 6),
            Math.cos(a) * ce * sp, Math.sin(a) * ce * sp, Math.sin(el) * sp,
            rnd(0.3, 1.15), rnd(0.8, 1.5));
        }
        glow.add(x, y, z + 4, 0, 0, 0, 0.25, 55, 1, 0.82, 0.55, 0.85, 1);
        glow.add(x, y, z + 4, 0, 0, 0, 0.12, 22, 1, 1, 0.9, 1, 1);
        light.position.set(x, y, z + 15);
        light.intensity = 7 * LK; flashAge = 0;
      }
      if (en.chips) {
        for (j = 0; j < 16; j++) {                 // heavy debris chunks
          a = Math.random() * TAU; sp = rnd(250, 1300);
          var gr = rnd(0.45, 0.62);
          var i = chips.add(x + rnd(-2, 2), y + rnd(-2, 2), z + rnd(0.5, 5), Math.cos(a) * sp, Math.sin(a) * sp,
            rnd(350, 1400), rnd(1.2, 1.5), rnd(1.8, 3.6), gr * chipTint.r, gr * 1.01 * chipTint.g, gr * 1.05 * chipTint.b, 1, 0);
          chips.g[i * 3] = Math.random() * TAU; chips.g[i * 3 + 1] = Math.random() * TAU; chips.g[i * 3 + 2] = 1;
          chips.e[i * 4] = rnd(-40, 40); chips.e[i * 4 + 1] = rnd(-50, 50);
        }
        for (j = 0; j < 45; j++) {                 // shattered chips
          a = Math.random() * TAU; sp = rnd(300, 1800);
          var g2 = rnd(0.62, 0.9);
          var i2 = chips.add(x + rnd(-2, 2), y + rnd(-2, 2), z + rnd(0.5, 4), Math.cos(a) * sp, Math.sin(a) * sp,
            rnd(300, 1200), rnd(1.1, 1.5), rnd(1, 2.2), g2 * chipTint.r, g2 * chipTint.g, g2 * 1.03 * chipTint.b, 1, 0);
          chips.g[i2 * 3] = Math.random() * TAU; chips.g[i2 * 3 + 1] = Math.random() * TAU; chips.g[i2 * 3 + 2] = 0;
          chips.e[i2 * 4] = rnd(-40, 40); chips.e[i2 * 4 + 1] = rnd(-50, 50);
        }
      }
      if (en.smoke) {
        var fake = { pos: { x: x, y: y, z: z + 2 }, toolR: 6 };
        for (j = 0; j < 22; j++) spawnSmoke(fake, true);
      }
    };

    fx.set = function (o) {
      if (!o) return;
      for (var key in en) if (Object.prototype.hasOwnProperty.call(o, key)) en[key] = !!o[key];
    };

    // Addition (not in the original spec): lets materials.js (or anything
    // else) tell the effects which alloy is on the machine right now, so
    // chips and sparks pick up its colour instead of a fixed aluminium grey
    // and steel orange. preset = {chipColor, sparkColor} (hex number or
    // "#rrggbb" string); either field is optional.
    fx.setMaterial = function (preset) {
      if (!preset) return;
      setTint(chipTint, hexOf(preset.chipColor, 0xb8bec8));
      setTint(sparkTint, hexOf(preset.sparkColor, 0xffffff));
    };

    fx.resize = function (h, fovDeg, pr) {
      h = +h || 800; fovDeg = +fovDeg || 45; pr = +pr || 1;
      scaleU.value = h * pr / (2 * Math.tan(fovDeg * Math.PI / 360));
    };

    fx.clear = function () {
      for (var i = 0; i < pools.length; i++) { pools[i].count = 0; pools[i].upload(); }
      acc.chip = acc.spark = acc.cool = acc.smoke = acc.fire = 0;
      light.intensity = 0; flashAge = 9;
    };

    fx.dispose = function () {
      if (root.parent) root.parent.remove(root);
      for (var i = 0; i < pools.length; i++) pools[i].dispose();
      for (i = 0; i < nozzleGeos.length; i++) nozzleGeos[i].dispose();
      for (i = 0; i < nozzleMats.length; i++) nozzleMats[i].dispose();
      pools.length = 0;
      fx.update = fx.crash = function () {};
    };

    // Addition (not in the spec): live particle counts, handy for a debug HUD.
    fx.stats = function () {
      return { chips: chips.count, sparks: sparks.count, coolant: drops.count, smoke: soft.count, glow: glow.count };
    };

    fx.object3d = root;   // addition: the group holding everything (e.g. to toggle visibility)
    return fx;
  }

  /* --------------------------------------------------------- QUARKS back end
   * Same spawn geometry / physics decisions as the legacy pools above, but
   * the particles are window.QUARKS (three.quarks) ParticleSystems rendered
   * through one shared BatchedRenderer. three.quarks owns per-particle GPU
   * buffers + instanced draw calls; small custom Behavior objects (one per
   * pool) own the physics, using the exact same closures over `s` / `cool` /
   * `surf()` the legacy pools used. */
  function createQuarks(THREE, Q, scene, opts) {
    opts = opts || {};
    var EF = Q_EFFECTS;
    var root = new THREE.Group();
    root.name = 'TNC_FX';
    scene.add(root);

    var renderer = new Q.BatchedRenderer();
    root.add(renderer);

    // material tint: same hook as the legacy back end (materials.js calls
    // fx.setMaterial() with a preset's chip/spark colours).
    var chipTint = { r: 1, g: 1, b: 1 }, sparkTint = { r: 1, g: 1, b: 1 };
    function hexOf(v, d) {
      if (typeof v === 'number') return v;
      if (typeof v === 'string') { var n = parseInt(v.replace('#', ''), 16); return isNaN(n) ? d : n; }
      return d;
    }
    function setTint(out, hex) { out.r = ((hex >> 16) & 255) / 255; out.g = ((hex >> 8) & 255) / 255; out.b = (hex & 255) / 255; }

    // One soft round sprite, procedurally drawn (no network, no asset file);
    // tinted per pool by vertex colour + blending mode.
    var dotTex = (function () {
      var cv = document.createElement('canvas');
      cv.width = cv.height = 64;
      var c2 = cv.getContext('2d');
      var g = c2.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c2.fillStyle = g;
      c2.fillRect(0, 0, 64, 64);
      var tex = new THREE.CanvasTexture(cv);
      tex.needsUpdate = true;
      return tex;
    })();

    var ownMats = [];
    function mat(blending) {
      var m = new THREE.MeshBasicMaterial({
        map: dotTex, transparent: true, depthWrite: false, depthTest: true,
        side: THREE.DoubleSide, blending: blending
      });
      ownMats.push(m);
      return m;
    }

    function makeSystem(order, blending) {
      var sys = new Q.ParticleSystem({
        material: mat(blending),
        worldSpace: true,
        looping: true,
        autoDestroy: false,
        emissionOverTime: new Q.ConstantValue(0),   // we spawn manually; no automatic emission
        emissionBursts: [],
        behaviors: []
      });
      sys.renderOrder = order;
      root.add(sys.emitter);
      renderer.addSystem(sys);
      return sys;
    }

    var maxChips = opts.maxChips || EF.maxChips;
    var chipsSys  = makeSystem(1, THREE.NormalBlending);
    var dropsSys  = makeSystem(2, THREE.NormalBlending);
    var sparksSys = makeSystem(5, THREE.AdditiveBlending);
    var softSys   = makeSystem(3, THREE.NormalBlending);
    var glowSys   = makeSystem(4, THREE.AdditiveBlending);
    var systems = [chipsSys, dropsSys, sparksSys, softSys, glowSys];

    // Crash flash light: always in the scene at intensity 0, same trick as
    // the legacy back end (no shader recompiles from toggling a light count).
    var LK = (+THREE.REVISION >= 155) ? Math.PI : 1;
    var light = new THREE.PointLight(0xffb060, 0, 600, LK > 1 ? 0 : 2);
    root.add(light);

    // Coolant nozzle mesh: identical to the legacy back end (plain THREE
    // meshes, nothing quarks-specific).
    var nozzle = null, nozzleGeos = [], nozzleMats = [];
    if (opts.nozzle !== false) {
      nozzle = new THREE.Group();
      var segGeo = new THREE.CylinderGeometry(2.4, 3.3, 5.6, 12);
      var tipGeo = new THREE.CylinderGeometry(1.1, 2.4, 6, 12);
      var hoseMat = new THREE.MeshLambertMaterial({ color: 0x2f6db3 });
      var tipMat = new THREE.MeshLambertMaterial({ color: 0xe0782a });
      nozzleGeos.push(segGeo, tipGeo); nozzleMats.push(hoseMat, tipMat);
      var tip = new THREE.Mesh(tipGeo, tipMat); tip.position.y = -3; nozzle.add(tip);
      for (var sgi = 0; sgi < 9; sgi++) {
        var seg = new THREE.Mesh(segGeo, hoseMat);
        seg.position.y = -8.5 - sgi * 5.4;
        nozzle.add(seg);
      }
      nozzle.visible = false;
      root.add(nozzle);
    }
    var Y = new THREE.Vector3(0, 1, 0), tmpV = new THREE.Vector3();

    var en = { chips: true, sparks: true, coolant: true, smoke: false, fire: false };
    var acc = { chip: 0, spark: 0, cool: 0, smoke: 0, fire: 0 };
    var flashAge = 9;

    var fx = { surfaceAt: null };

    function surf(x, y, st) {
      var f = fx.surfaceAt;
      if (typeof f !== 'function') return st;
      var z = f(x, y);
      return (typeof z === 'number' && z === z && z > -1e9 && z < 1e9) ? z : NaN;
    }

    // Per-frame state the behaviors read (mutated once at the top of
    // fx.update, same values the legacy per-particle loops closed over).
    var ctx = { st: 0, hasPos: false, spin: 0, sgn: 1, R: 3, cutting: false, s: null,
      toolX: 1e9, toolY: 1e9, toolZ: 0, kickR2: 0 };

    // Places a particle at an absolute (x,y,z) for THIS frame, compensating
    // for the position += velocity*dt integration three.quarks performs
    // right after behaviors run, so the final on-screen position is exactly
    // (x,y,z) regardless of what velocity is left on the particle (which
    // still matters for e.g. later frames / rendering).
    function place(p, dt, x, y, z) {
      p.position.set(x - p.velocity.x * dt, y - p.velocity.y * dt, z - p.velocity.z * dt);
    }
    function kill(p) { p.age = p.life + 1; }

    function spawnInto(sys, maxN) {
      var n = sys.particleNum, particle;
      if (n < maxN) {
        sys.particleNum = n + 1;
        while (sys.particles.length < sys.particleNum) sys.particles.push(new Q.SpriteParticle());
        particle = sys.particles[n];
      } else {
        particle = sys.particles[(Math.random() * maxN) | 0];
      }
      particle.reset();
      particle.rotation = 0; particle.uvTile = 0; particle.speedModifier = 1;
      return particle;
    }

    /* --------------------------------------------------------- spawners */
    var per = { x: 0, y: 0, ox: 0, oy: 0 };
    function periphery(s, rFrac) {
      var dx = (s.dir && s.dir.x) || 0, dy = (s.dir && s.dir.y) || 0, dl = Math.sqrt(dx * dx + dy * dy);
      var ox, oy;
      if (dl > 0.1) {
        dx /= dl; dy /= dl;
        var side = Math.random() < 0.5 ? 1 : -1;
        var fw = rnd(-0.15, 0.7);
        ox = -dy * side + dx * fw; oy = dx * side + dy * fw;
      } else {
        var an = Math.random() * TAU; ox = Math.cos(an); oy = Math.sin(an);
      }
      var ol = Math.sqrt(ox * ox + oy * oy) || 1;
      ox /= ol; oy /= ol;
      var R = (s.toolR || 3) * rFrac;
      per.ox = ox; per.oy = oy; per.x = s.pos.x + ox * R; per.y = s.pos.y + oy * R;
      return per;
    }

    function advanceParticle(p, pre, grav) {
      if (!(pre > 0)) return;
      p.velocity.z -= grav * pre;
      p.position.x += p.velocity.x * pre; p.position.y += p.velocity.y * pre; p.position.z += p.velocity.z * pre;
      p.age = pre;
    }

    function spawnChip(s, st, sgn, R, pre) {
      var o = periphery(s, 0.9);
      var z = s.pos.z + rnd(0.2, Math.max(0.4, Math.min(4, st - s.pos.z)));
      var sz = surf(o.x, o.y, st);
      if (sz === sz && z < sz + 0.1) z = sz + 0.1;
      var tx = o.oy * sgn, ty = -o.ox * sgn;
      var vPer = TAU * R * Math.abs(s.spindle) / 60000 * 1000;
      var fast = Math.random() < 0.4;
      var spd = fast ? clamp(vPer * rnd(0.3, 0.8), 350, 1600) : rnd(50, 260);
      var rad = spd * rnd(0.05, 0.35);
      var up = fast ? rnd(150, 750) : rnd(120, 420);
      var gr = rnd(0.58, 0.86);
      var size = clamp(0.7 + R * 0.07, 0.8, 2.0) * rnd(0.75, 1.25);
      var p = spawnInto(chipsSys, maxChips);
      p._rest = false; p._bounced = false; p._s0 = size; p._spin = rnd(-6, 6);
      p.position.set(o.x, o.y, z);
      p.velocity.set(tx * spd + o.ox * rad, ty * spd + o.oy * rad, up);
      p.life = rnd(EF.chip.life[0], EF.chip.life[1]); p.age = 0;
      p.size.set(size, size, size);
      p.color.set(gr * 0.97 * chipTint.r, gr * 0.99 * chipTint.g, gr * 1.03 * chipTint.b, 1);
      p.rotation = Math.random() * TAU;
      advanceParticle(p, pre * 0.5, G);
    }

    function spawnSpark(x, y, z, vx, vy, vz, life, size) {
      var p = spawnInto(sparksSys, EF.maxSparks);
      p.position.set(x, y, z); p.velocity.set(vx, vy, vz);
      p.life = life; p.age = 0; p._s0 = size;
      p.size.set(size, size, size);
      p.color.set(1, 0.95, 0.72, 1);
      return p;
    }

    function cuttingSparks(s, sgn) {
      var o = periphery(s, 1.0);
      var n = 1 + ((Math.random() * 3) | 0);
      var tx = o.oy * sgn, ty = -o.ox * sgn;
      for (var j = 0; j < n; j++) {
        var spd = rnd(700, 2000);
        spawnSpark(o.x, o.y, s.pos.z + rnd(0.3, 2),
          tx * spd + o.ox * spd * rnd(0, 0.3) + rnd(-150, 150),
          ty * spd + o.oy * spd * rnd(0, 0.3) + rnd(-150, 150),
          rnd(150, 800), rnd(0.12, 0.32), rnd(0.5, 0.75));
      }
    }

    var cool = { nx: 0, ny: 0, nz: 0, ax: 0, ay: 0, az: 0 };
    function coolGeom(s) {
      var R = s.toolR || 3, hx = 0.78, hy = 0.625, off = R + 36;
      cool.nx = s.pos.x + hx * off; cool.ny = s.pos.y + hy * off; cool.nz = s.pos.z + 60;
      cool.ax = s.pos.x + hx * R * 0.9; cool.ay = s.pos.y + hy * R * 0.9; cool.az = s.pos.z + 3;
    }

    var JEV = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    function jetEval(T, t, jx, jy, jz) {
      var sag = 0.5 * G * t * (T - t), u = t / T;
      JEV.x = cool.nx + (cool.ax - cool.nx) * u + jx * t;
      JEV.y = cool.ny + (cool.ay - cool.ny) * u + jy * t;
      JEV.z = cool.nz + (cool.az - cool.nz) * u + jz * t + sag;
      JEV.vx = (cool.ax - cool.nx) / T + jx;
      JEV.vy = (cool.ay - cool.ny) / T + jy;
      JEV.vz = (cool.az - cool.nz) / T + jz + 0.5 * G * (T - 2 * t);
      return JEV;
    }

    function spawnJet(pre) {
      var j = EF.jet.jitter;
      var p = spawnInto(dropsSys, EF.maxDrops);
      p._kind = 0; p._jx = rnd(-j, j); p._jy = rnd(-j, j); p._jz = rnd(-j, j);
      p._s0 = rnd(1.2, 1.8);
      p.life = EF.jet.life * rnd(0.97, 1.03); p.age = pre || 0;
      var b = rnd(0.9, 1.0);
      p.color.set(0.72 * b, 0.86 * b, 1.0 * b, 0.36);
      p.size.set(p._s0, p._s0, p._s0);
      var ev = jetEval(p.life, p.age, p._jx, p._jy, p._jz);
      p.position.set(ev.x, ev.y, ev.z);
      p.velocity.set(ev.vx, ev.vy, ev.vz);
    }

    function splash(x, y, z, s, cutting, sgn) {
      var px = s.pos.x, py = s.pos.y;
      var ox = x - px, oy = y - py, ol = Math.sqrt(ox * ox + oy * oy) || 1;
      ox /= ol; oy /= ol;
      var tx = oy * sgn, ty = -ox * sgn;
      var n = cutting ? 2 : 1;
      for (var j = 0; j < n; j++) {
        var ts = s.spindle ? rnd(120, 650) : 0, rs = rnd(80, 420);
        var a = Math.random() * TAU, rr = rnd(0, 120);
        var b = rnd(0.85, 1.0);
        var p = spawnInto(dropsSys, EF.maxDrops);
        p._kind = 1; p._s0 = rnd(0.45, 1.0);
        p.position.set(x, y, z);
        p.velocity.set(tx * ts + ox * rs + Math.cos(a) * rr, ty * ts + oy * rs + Math.sin(a) * rr, rnd(40, 420));
        p.life = rnd(EF.splash.life[0], EF.splash.life[1]); p.age = 0;
        p.size.set(p._s0, p._s0, p._s0);
        p.color.set(0.78 * b, 0.9 * b, 1.0 * b, 0.55);
      }
      if (Math.random() < (cutting ? 0.06 : 0.015)) {
        var m = Math.random() * TAU, ms = rnd(30, 110);
        var sp = spawnInto(softSys, EF.maxSoft);
        sp._kind = 1; sp._s0 = rnd(3, 5);
        sp.position.set(x, y, z + rnd(0, 2));
        sp.velocity.set(Math.cos(m) * ms, Math.sin(m) * ms, rnd(15, 60));
        sp.life = rnd(0.6, 1.1); sp.age = 0;
        sp.size.set(sp._s0, sp._s0, sp._s0);
        sp.color.set(0.86, 0.92, 1.0, 0);
      }
    }

    function spawnSmoke(s, dark) {
      var R = s.toolR || 3, an = Math.random() * TAU, r = R * rnd(0.3, 1.2);
      var gr = dark ? rnd(0.2, 0.3) : rnd(0.5, 0.66);
      var p = spawnInto(softSys, EF.maxSoft);
      p._kind = dark ? 2 : 0;
      p._growth = rnd(3.5, 5.5);
      p._s0 = (4 + R * 0.6) * rnd(0.8, 1.2) * (dark ? 1.4 : 1);
      p.position.set(s.pos.x + Math.cos(an) * r, s.pos.y + Math.sin(an) * r, s.pos.z + rnd(0, 2.5));
      p.velocity.set(rnd(-8, 8), rnd(-8, 8), dark ? rnd(40, 90) : rnd(16, 38));
      p.life = dark ? rnd(1.2, 2.0) : rnd(2.2, 3.6); p.age = 0;
      p.size.set(p._s0, p._s0, p._s0);
      p.color.set(gr * 1.02, gr, gr * 0.97, 0);
    }

    function spawnFlame(s) {
      var R = s.toolR || 3, an = Math.random() * TAU, r = R * rnd(0.6, 1.2);
      var core = Math.random() < 0.35;
      var p = spawnInto(glowSys, EF.maxGlow);
      p._kind = 0; p._rampSpeed = core ? 0.45 : 1;
      p._s0 = (3 + R * 0.45) * rnd(0.8, 1.2) * (core ? 0.55 : 1);
      p.position.set(s.pos.x + Math.cos(an) * r, s.pos.y + Math.sin(an) * r, s.pos.z + rnd(0, 1.5));
      p.velocity.set(rnd(-12, 12), rnd(-12, 12), core ? rnd(20, 50) : rnd(30, 90));
      p.life = core ? rnd(0.12, 0.22) : rnd(0.18, 0.36); p.age = 0;
      p.size.set(p._s0, p._s0, p._s0);
      p.color.set(1, 0.9, 0.55, 0.5);
    }

    /* --------------------------------------------------------- behaviors
     * One per pool; mirrors the corresponding per-particle loop of the
     * legacy back end almost line for line, just addressed through
     * particle.position/velocity/age/life/size/color instead of typed
     * arrays. See place()/kill() above for the two bits of glue this needs. */
    var noop = function () {};
    function behavior(type, update) {
      return { type: type, update: update, initialize: noop, frameUpdate: noop, reset: noop,
        clone: function () { return this; }, toJSON: function () { return {}; } };
    }

    var chipBehavior = behavior('tncChip', function (p, dt) {
      var left = p.life - p.age, al = left < 0.8 ? Math.max(left, 0) / 0.8 : 1;
      p.color.w = al;
      var sz = p._s0 * (0.55 + 0.45 * al); p.size.set(sz, sz, sz);
      p.rotation += p._spin * dt;
      if (p._rest) {
        if (ctx.spin !== 0) {
          var kx = p.position.x - ctx.toolX, ky = p.position.y - ctx.toolY, kd = kx * kx + ky * ky;
          if (kd < ctx.kickR2 && p.position.z > ctx.toolZ - 1 && p.position.z < ctx.toolZ + 60) {
            kd = Math.sqrt(kd) || 1; kx /= kd; ky /= kd;
            var ks = rnd(EF.chip.restKick[0], EF.chip.restKick[1]);
            p.velocity.set(ky * ctx.sgn * ks + kx * 150, -kx * ctx.sgn * ks + ky * 150, rnd(150, 450));
            p._bounced = false; p._rest = false;
          }
        }
        if (p._rest && Math.random() < 0.125) {
          var rz = surf(p.position.x, p.position.y, ctx.st);
          if (rz !== rz || rz < p.position.z - 0.3) { p._rest = false; p.velocity.set(0, 0, 0); p._bounced = true; }
        }
        if (p._rest) return;
      }
      p.velocity.z -= G * dt;
      var drag = Math.exp(-EF.chip.drag * dt);
      p.velocity.x *= drag; p.velocity.y *= drag; p.velocity.z *= drag;
      var ox = p.position.x, oy = p.position.y, oz = p.position.z;
      var nx = ox + p.velocity.x * dt, ny = oy + p.velocity.y * dt, nz = oz + p.velocity.z * dt;
      var szf = surf(nx, ny, ctx.st);
      if (szf !== szf) {
        if (nz < ctx.st - 200) { kill(p); place(p, dt, nx, ny, nz); return; }
      } else if (nz < szf) {
        if (oz >= szf - 0.05) {
          if (p.velocity.z < -260 && !p._bounced) {
            nz = szf + 0.01; p.velocity.z *= -0.25; p.velocity.x *= 0.45; p.velocity.y *= 0.45; p._bounced = true;
          } else { nz = szf + 0.03; p._rest = true; p.velocity.set(0, 0, 0); }
        } else {
          nx = ox; ny = oy; p.velocity.x *= -0.3; p.velocity.y *= -0.3;
          var so = surf(ox, oy, ctx.st);
          if (so === so && nz < so) { nz = so + 0.03; p._rest = true; p.velocity.set(0, 0, 0); }
        }
      }
      place(p, dt, nx, ny, nz);
    });

    var HC = [0, 0, 0];
    var sparkBehavior = behavior('tncSpark', function (p, dt) {
      var t = p.age / p.life;
      heat(t, HC, 0);
      p.color.set(HC[0] * sparkTint.r, HC[1] * sparkTint.g, HC[2] * sparkTint.b, Math.pow(1 - t, 1.3));
      var sz = p._s0 * (1 - 0.4 * t); p.size.set(sz, sz, sz);
      p.velocity.z -= G * 0.6 * dt;
      var drag = Math.exp(-EF.spark.drag * dt);
      p.velocity.x *= drag; p.velocity.y *= drag; p.velocity.z *= drag;
      var nx = p.position.x + p.velocity.x * dt, ny = p.position.y + p.velocity.y * dt, nz = p.position.z + p.velocity.z * dt;
      if (p.velocity.z < 0) {
        var ssz = surf(nx, ny, ctx.st);
        if (ssz === ssz && nz < ssz && nz > ssz - 6) { nz = ssz + 0.01; p.velocity.z *= -0.35; p.velocity.x *= 0.6; p.velocity.y *= 0.6; }
      }
      place(p, dt, nx, ny, nz);
    });

    var dropsBehavior = behavior('tncDrops', function (p, dt) {
      if (p._kind === 0) {                              // jet: ballistic arc pinned to nozzle -> aim
        var T = p.life, tNew = p.age + dt;
        if (tNew < T) {
          var ev = jetEval(T, tNew, p._jx, p._jy, p._jz);
          var dz = surf(ev.x, ev.y, ctx.st);
          if (dz === dz && ev.z < dz) {
            if (ctx.hasPos) splash(ev.x, ev.y, dz + 0.05, ctx.s, ctx.cutting, ctx.sgn);
            kill(p); place(p, dt, ev.x, ev.y, dz + 0.05); return;
          }
          p.velocity.set(ev.vx, ev.vy, ev.vz);
          p.color.w = 0.3 + 0.12 * (tNew / T);
          place(p, dt, ev.x, ev.y, ev.z);
          return;
        }
        if (ctx.hasPos) splash(p.position.x, p.position.y, p.position.z, ctx.s, ctx.cutting, ctx.sgn);
        kill(p);
        return;
      }
      // splash droplet
      var t = p.age / p.life;
      if (t >= 1) return;
      var dragS = Math.exp(-EF.splash.drag * dt);
      p.velocity.z -= G * dt;
      p.velocity.x *= dragS; p.velocity.y *= dragS; p.velocity.z *= dragS;
      var nx = p.position.x + p.velocity.x * dt, ny = p.position.y + p.velocity.y * dt, nz = p.position.z + p.velocity.z * dt;
      p.color.w = 0.55 * (1 - t * t);
      if (p.velocity.z < 0) {
        var sd = surf(nx, ny, ctx.st);
        if (sd === sd && nz < sd) {
          if (p._s0 > 0.7 && Math.random() < 0.3) {
            nz = sd + 0.02; p.velocity.z *= -0.3; p.velocity.x *= 0.5; p.velocity.y *= 0.5;
            p._s0 *= 0.6; p.size.set(p._s0, p._s0, p._s0);
          } else { kill(p); place(p, dt, nx, ny, nz); return; }
        } else if (sd !== sd && nz < ctx.st - 200) { kill(p); place(p, dt, nx, ny, nz); return; }
      }
      place(p, dt, nx, ny, nz);
    });

    var softBehavior = behavior('tncSoft', function (p, dt) {
      var t = p.age / p.life;
      if (t >= 1) return;
      if (p._kind === 1) {                              // mist puff
        var decay = Math.exp(-2.5 * dt);
        p.velocity.x *= decay; p.velocity.y *= decay; p.velocity.z *= decay;
        var sz = p._s0 * (1 + 2.4 * t); p.size.set(sz, sz, sz);
        p.color.w = 0.16 * Math.min(1, t * 6) * (1 - t);
      } else {                                          // cutting / crash smoke
        p.velocity.z += (p._kind === 2 ? 30 : 12) * dt;
        var drag = Math.exp(-EF.soft.drag * dt);
        p.velocity.x *= drag; p.velocity.y *= drag;
        p.velocity.x += rnd(-20, 20) * dt; p.velocity.y += rnd(-20, 20) * dt;
        var sz2 = p._s0 * (1 + (p._growth - 1) * Math.sqrt(t)); p.size.set(sz2, sz2, sz2);
        p.color.w = (p._kind === 2 ? 0.45 : 0.4) * Math.min(1, t * 5) * (1 - t) * (1 - t);
      }
      var nx = p.position.x + p.velocity.x * dt, ny = p.position.y + p.velocity.y * dt, nz = p.position.z + p.velocity.z * dt;
      place(p, dt, nx, ny, nz);
    });

    var glowBehavior = behavior('tncGlow', function (p, dt) {
      var t = p.age / p.life;
      if (t >= 1) return;
      if (p._kind === 1) {                              // crash flash, stationary
        p.color.w = 0.85 * (1 - t) * (1 - t);
        var sz = p._s0 * (0.6 + 0.6 * t); p.size.set(sz, sz, sz);
        return;
      }
      p.velocity.z += 180 * dt;
      var ht = t * p._rampSpeed;
      p.color.set(1 - 0.4 * ht, 0.62 - 0.52 * ht, Math.max(0.02, 0.2 - 0.22 * ht),
        (p._rampSpeed < 1 ? 0.6 : 0.42) * Math.min(1, t * 8) * (1 - t));
      var sz2 = p._s0 * (0.7 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.4))) * (1 - 0.5 * t) * rnd(0.85, 1.15);
      p.size.set(sz2, sz2, sz2);
      var nx = p.position.x + p.velocity.x * dt, ny = p.position.y + p.velocity.y * dt, nz = p.position.z + p.velocity.z * dt;
      place(p, dt, nx, ny, nz);
    });

    chipsSys.behaviors.push(chipBehavior);
    sparksSys.behaviors.push(sparkBehavior);
    dropsSys.behaviors.push(dropsBehavior);
    softSys.behaviors.push(softBehavior);
    glowSys.behaviors.push(glowBehavior);

    /* ----------------------------------------------------------- update */
    fx.update = function (dt, s) {
      dt = +dt || 0;
      if (dt > 0.1) dt = 0.1;
      if (!(dt > 0)) return;
      s = s || {};
      var st = (typeof s.stockTop === 'number' && isFinite(s.stockTop)) ? s.stockTop : 0;
      var hasPos = !!(s.pos && isFinite(s.pos.x) && isFinite(s.pos.y) && isFinite(s.pos.z));
      var spin = +s.spindle || 0, sgn = spin < 0 ? -1 : 1;
      var R = Math.max(0.2, +s.toolR || 3);
      var speed = clamp(+s.speed || 1, 1, 1000);
      var mul = Math.min(Math.pow(speed, 0.45), 5);
      var active = !!s.running && hasPos;
      var cutting = active && !!s.cutting && spin !== 0;
      var coolOn = active && !!s.coolant && spin !== 0 && en.coolant;
      if (hasPos) coolGeom(s);

      ctx.st = st; ctx.hasPos = hasPos; ctx.spin = spin; ctx.sgn = sgn; ctx.R = R;
      ctx.cutting = cutting; ctx.s = s;
      ctx.toolX = hasPos ? s.pos.x : 1e9; ctx.toolY = hasPos ? s.pos.y : 1e9; ctx.toolZ = hasPos ? s.pos.z : 0;
      var kickR = R + EF.chip.kickPad; ctx.kickR2 = kickR * kickR;

      // advance particles that existed at the start of this frame
      for (var qi = 0; qi < systems.length; qi++) systems[qi].update(dt);

      // spawn (after the step, like the legacy back end)
      if (cutting) {
        if (en.chips) {
          acc.chip += dt * EF.rate.chip * clamp(Math.sqrt(R / 4), 0.6, 2) * mul;
          while (acc.chip >= 1) { acc.chip -= 1; spawnChip(s, st, sgn, R, Math.random() * dt); }
        }
        if (en.sparks) {
          acc.spark += dt * EF.rate.spark * mul;
          while (acc.spark >= 1) { acc.spark -= 1; cuttingSparks(s, sgn); }
        }
        if (en.smoke) {
          acc.smoke += dt * EF.rate.smoke * Math.min(Math.pow(speed, 0.3), 2.5);
          while (acc.smoke >= 1) { acc.smoke -= 1; spawnSmoke(s, false); }
        }
        if (en.fire) {
          acc.fire += dt * EF.rate.fire * Math.min(Math.pow(speed, 0.3), 2.5);
          while (acc.fire >= 1) { acc.fire -= 1; spawnFlame(s); }
        }
      } else { acc.chip = acc.spark = acc.smoke = acc.fire = 0; }
      if (coolOn) {
        acc.cool += dt * EF.rate.jet;
        while (acc.cool >= 1) { acc.cool -= 1; spawnJet(Math.random() * dt); }
      } else acc.cool = 0;

      if (nozzle) {
        nozzle.visible = hasPos && en.coolant && !!s.coolant;
        if (nozzle.visible) {
          nozzle.position.set(cool.nx, cool.ny, cool.nz);
          tmpV.set(cool.ax - cool.nx, cool.ay - cool.ny, cool.az - cool.nz).normalize();
          nozzle.quaternion.setFromUnitVectors(Y, tmpV);
        }
      }

      if (flashAge < 9) {
        flashAge += dt;
        light.intensity = flashAge < 0.35 ? LK * 7 * Math.exp(-flashAge / 0.09) : 0;
        if (flashAge >= 0.35) flashAge = 9;
      }

      // sync GPU buffers after spawning, so new particles show up this frame
      for (var bi = 0; bi < renderer.batches.length; bi++) renderer.batches[bi].update();
    };

    /* ------------------------------------------------------------- crash */
    fx.crash = function (pos) {
      if (!pos || !isFinite(pos.x) || !isFinite(pos.y) || !isFinite(pos.z)) return;
      var x = pos.x, y = pos.y, z = pos.z, j, a, sp, el, ce;
      if (en.sparks) {
        for (j = 0; j < EF.crash.sparks; j++) {
          a = Math.random() * TAU;
          el = Math.pow(Math.random(), 0.6) * 1.35 - 0.15;
          ce = Math.cos(el);
          sp = rnd(600, 4600) * (Math.random() < 0.15 ? 1.4 : 1);
          spawnSpark(x + rnd(-2, 2), y + rnd(-2, 2), z + rnd(0, 6),
            Math.cos(a) * ce * sp, Math.sin(a) * ce * sp, Math.sin(el) * sp,
            rnd(0.3, 1.15), rnd(0.8, 1.5));
        }
        var g1 = spawnInto(glowSys, EF.maxGlow);
        g1._kind = 1; g1._s0 = 55; g1.position.set(x, y, z + 4); g1.velocity.set(0, 0, 0);
        g1.life = 0.25; g1.age = 0; g1.size.set(55, 55, 55); g1.color.set(1, 0.82, 0.55, 0.85);
        var g2 = spawnInto(glowSys, EF.maxGlow);
        g2._kind = 1; g2._s0 = 22; g2.position.set(x, y, z + 4); g2.velocity.set(0, 0, 0);
        g2.life = 0.12; g2.age = 0; g2.size.set(22, 22, 22); g2.color.set(1, 1, 0.9, 1);
        light.position.set(x, y, z + 15);
        light.intensity = 7 * LK; flashAge = 0;
      }
      if (en.chips) {
        for (j = 0; j < EF.crash.chipsHeavy; j++) {
          a = Math.random() * TAU; sp = rnd(250, 1300);
          var gr = rnd(0.45, 0.62);
          var p = spawnInto(chipsSys, maxChips);
          p._rest = false; p._bounced = false; p._s0 = rnd(1.8, 3.6); p._spin = rnd(-10, 10);
          p.position.set(x + rnd(-2, 2), y + rnd(-2, 2), z + rnd(0.5, 5));
          p.velocity.set(Math.cos(a) * sp, Math.sin(a) * sp, rnd(350, 1400));
          p.life = rnd(1.2, 1.5); p.age = 0;
          p.size.set(p._s0, p._s0, p._s0);
          p.color.set(gr * chipTint.r, gr * 1.01 * chipTint.g, gr * 1.05 * chipTint.b, 1);
          p.rotation = Math.random() * TAU;
        }
        for (j = 0; j < EF.crash.chipsShatter; j++) {
          a = Math.random() * TAU; sp = rnd(300, 1800);
          var g2c = rnd(0.62, 0.9);
          var p2 = spawnInto(chipsSys, maxChips);
          p2._rest = false; p2._bounced = false; p2._s0 = rnd(1, 2.2); p2._spin = rnd(-10, 10);
          p2.position.set(x + rnd(-2, 2), y + rnd(-2, 2), z + rnd(0.5, 4));
          p2.velocity.set(Math.cos(a) * sp, Math.sin(a) * sp, rnd(300, 1200));
          p2.life = rnd(1.1, 1.5); p2.age = 0;
          p2.size.set(p2._s0, p2._s0, p2._s0);
          p2.color.set(g2c * chipTint.r, g2c * chipTint.g, g2c * 1.03 * chipTint.b, 1);
          p2.rotation = Math.random() * TAU;
        }
      }
      if (en.smoke) {
        var fake = { pos: { x: x, y: y, z: z + 2 }, toolR: 6 };
        for (j = 0; j < EF.crash.smoke; j++) spawnSmoke(fake, true);
      }
    };

    fx.set = function (o) {
      if (!o) return;
      for (var key in en) if (Object.prototype.hasOwnProperty.call(o, key)) en[key] = !!o[key];
    };

    fx.setMaterial = function (preset) {
      if (!preset) return;
      setTint(chipTint, hexOf(preset.chipColor, 0xb8bec8));
      setTint(sparkTint, hexOf(preset.sparkColor, 0xffffff));
    };

    // three.quarks billboards are real world-mm sized quads, so perspective
    // foreshortening already matches the legacy shader's uScale math for
    // free; nothing to recompute here besides keeping the hook present.
    fx.resize = function () {};

    fx.clear = function () {
      for (var i = 0; i < systems.length; i++) systems[i].particleNum = 0;
      for (var bi = 0; bi < renderer.batches.length; bi++) renderer.batches[bi].update();
      acc.chip = acc.spark = acc.cool = acc.smoke = acc.fire = 0;
      light.intensity = 0; flashAge = 9;
    };

    fx.dispose = function () {
      var i;
      for (i = 0; i < renderer.batches.length; i++) {
        var b = renderer.batches[i];
        if (b.dispose) b.dispose();
        if (b.material && b.material.dispose) b.material.dispose();
      }
      for (i = 0; i < systems.length; i++) systems[i].dispose();
      for (i = 0; i < ownMats.length; i++) ownMats[i].dispose();
      if (root.parent) root.parent.remove(root);
      dotTex.dispose();
      for (i = 0; i < nozzleGeos.length; i++) nozzleGeos[i].dispose();
      for (i = 0; i < nozzleMats.length; i++) nozzleMats[i].dispose();
      systems.length = 0;
      fx.update = fx.crash = function () {};
    };

    fx.stats = function () {
      return { chips: chipsSys.particleNum, sparks: sparksSys.particleNum, coolant: dropsSys.particleNum,
        smoke: softSys.particleNum, glow: glowSys.particleNum };
    };

    fx.object3d = root;
    return fx;
  }

  /* ---------------------------------------------------------------- create */
  function create(THREE, scene, opts) {
    var Q = (typeof window !== 'undefined') ? window.QUARKS : null;
    var fx = null;
    if (Q && Q.ParticleSystem && Q.BatchedRenderer && Q.SpriteParticle && Q.ConstantValue) {
      try { fx = createQuarks(THREE, Q, scene, opts); }
      catch (err) {
        fx = null;
        try { if (typeof console !== 'undefined' && console.warn) console.warn('TNC_FX: three.quarks back end failed, falling back to the built-in renderer.', err); } catch (e2) {}
      }
    }
    if (!fx) fx = createLegacy(THREE, scene, opts);
    api.instance = fx;   // addition: last-created instance, so a sibling plugin (materials.js)
                          // can reach fx.setMaterial() without ui.js having to hand it out
    return fx;
  }

  var api = { create: create };
  return api;
})();
if (typeof module !== 'undefined') module.exports = TNC_FX;
