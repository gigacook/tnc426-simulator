/* ==========================================================================
 * TNC 426 simulator -- tools3d.js
 * Builds recognisable 3-D tool + holder models for the TNC.TOOLS table.
 * Plain browser JS (ES5-ish), classic global THREE (r128), no modules.
 * Exposes a single global: TNC_TOOLS3D  { build, dispose }
 *
 * Convention: the returned group's origin is the TOOL TIP, +Z runs up the
 * tool axis toward the spindle. gaugeZ = tool.l is where the holder meets
 * the spindle face (HEIDENHAIN gauge length).
 *
 * Visual approach: geometry + procedural canvas textures only (no network,
 * no new libraries). MeshPhysicalMaterial everywhere -- a strict superset of
 * MeshStandardMaterial, so plain color/roughness/metalness parts behave
 * exactly as before -- with a touch of clearcoat/anisotropy on ground steel
 * and clearcoat on the ruby stylus and TiN coating. Small lathe-profile
 * chamfers on OD transitions catch specular highlights the way a real
 * deburred edge does; a V-groove flange, faceted+knurled ER nut and
 * laser-etched labels round out the "real machined part" read.
 * ========================================================================== */

var TNC_TOOLS3D = (function () {
  'use strict';

  /* ---------------------------------------------------------------- colours */

  var COL = {
    carbide:   0x9aa3ad,   // cemented-carbide grey
    hss:       0xc9cdd2,   // brighter HSS grey
    tin:       0xcfa23a,   // TiN gold coating
    blackox:   0x2b2b2e,   // black-oxide (taps)
    steel:     0x707680,   // tool-steel body / holder
    holder:    0x545a63,   // SK40 body (darker machined steel)
    holderHi:  0x6c7280,
    insert:    0xd8d3c8,   // carbide insert
    ruby:      0xb3112c,   // probe stylus ball
    collet:    0x3f4650,
    brass:     0x9c7a3c
  };

  /* ---------------------------------------------------------------- materials
   * MeshPhysicalMaterial throughout: a strict superset of MeshStandardMaterial
   * (plain color/roughness/metalness behaves identically), while `extra`
   * unlocks physical-only fields (clearcoat, anisotropy, map, flatShading...)
   * wherever they earn their keep. */
  function mat(hex, rough, metal, extra) {
    var p = {
      color: hex,
      roughness: (rough === undefined) ? 0.45 : rough,
      metalness: (metal === undefined) ? 0.85 : metal
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) p[k] = extra[k];
    return new THREE.MeshPhysicalMaterial(p);
  }

  // Ground/turned steel: faint clearcoat + a little anisotropy so the
  // highlight stretches with the (circumferential) machining marks instead
  // of sitting as a flat isotropic speck -- r186 supports `anisotropy`
  // directly on the material, no map required. `tex`, if given, is reused
  // as both the colour multiplier and the roughness variation (one canvas,
  // two channels of use).
  function steelMat(hex, rough, tex) {
    var extra = { clearcoat: 0.16, clearcoatRoughness: 0.32, anisotropy: 0.35, anisotropyRotation: Math.PI / 2 };
    if (tex) { extra.map = tex; extra.roughnessMap = tex; }
    return mat(hex, (rough === undefined) ? 0.4 : rough, 0.82, extra);
  }

  /* ---------------------------------------------------------------- geo helpers */

  // Cylinder/frustum spanning z:[0,h], radius r0 at z=0 -> r1 at z=h, centred on Z.
  function frustum(r0, r1, h, segs) {
    var g = new THREE.CylinderGeometry(r1, r0, h, segs || 20, 1);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, h / 2);
    return g;
  }

  // Cone with apex at z=0 (tip) opening upward to radius r at z=h.
  function tipCone(r, h, segs) {
    var g = new THREE.ConeGeometry(r, h, segs || 20, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, h / 2);
    return g;
  }

  function disc(r0, r1, h, segs) { return frustum(r0, r1, h, segs); }

  function mesh(geo, material) {
    var m = new THREE.Mesh(geo, material);
    return m;
  }

  // Arbitrary [radius,z] lathe profile, revolved around the tool axis (Z,
  // z ascending from the first point). Used for chamfers, grooves and
  // faceted (flatShaded, low-segment) parts that a straight frustum can't
  // express without a boolean library.
  function latheZ(points, segs) {
    var pts = [];
    for (var i = 0; i < points.length; i++) pts.push(new THREE.Vector2(Math.max(0.02, points[i][0]), points[i][1]));
    // close the solid: run the profile in from the axis and back to it, or the part is an open tube you see through
    if (pts[0].x > 0.03) pts.unshift(new THREE.Vector2(0.02, pts[0].y));
    if (pts[pts.length - 1].x > 0.03) pts.push(new THREE.Vector2(0.02, pts[pts.length - 1].y));
    var g = new THREE.LatheGeometry(pts, segs || 24);
    g.rotateX(Math.PI / 2);
    return g;
  }

  // Like frustum(), but with a small 45-degree-ish chamfer lathed into both
  // end edges -- the single biggest cheap realism win: a bare edge scatters
  // light evenly and reads as "rendered", a chamfered one catches a thin
  // bright highlight line the way a deburred machined part does.
  function chamferedCyl(r0, r1, h, ch, segs) {
    segs = segs || 20;
    ch = Math.max(0, Math.min(ch, h * 0.45, Math.min(r0, r1) * 0.9));
    if (ch < 0.05 || h <= 0) return frustum(r0, r1, h, segs);
    function radAt(z) { return r0 + (r1 - r0) * (z / h); }
    return latheZ([
      [Math.max(0.02, radAt(0) - ch), 0],
      [radAt(ch), ch],
      [radAt(h - ch), h - ch],
      [Math.max(0.02, radAt(h) - ch), h]
    ], segs);
  }

  // Open cylindrical patch (a curved "sticker") for etched-label decals: a
  // thin arc, thetaLength radians wide, sitting just proud of radius r.
  function curvedPatch(r, z0, h, thetaStart, thetaLength, segs) {
    var g = new THREE.CylinderGeometry(r, r, h, segs || 16, 1, true, thetaStart, thetaLength);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, z0 + h / 2);
    return g;
  }

  // Helix curve for flute tubes -- built as a sampled CatmullRomCurve3
  // (THREE.Curve is an ES6 class in the r128 UMD build and cannot be
  // subclassed with the old prototype pattern, so we sample points instead).
  function helixCurve(r, turns, h, phase, samples) {
    samples = samples || Math.max(8, Math.round(16 * turns));
    var pts = [];
    for (var i = 0; i <= samples; i++) {
      var t = i / samples;
      var a = phase + t * turns * Math.PI * 2;
      pts.push(new THREE.Vector3(r * Math.cos(a), r * Math.sin(a), t * h));
    }
    return new THREE.CatmullRomCurve3(pts);
  }

  // Adds `nFlutes` helical flute tubes (grooves) on a shank of radius r,
  // from z=z0 to z=z0+len, to `group` using `material`.
  function addFlutes(THREE_, group, r, z0, len, nFlutes, turnsPerLen, material) {
    nFlutes = nFlutes || 2;
    var turns = Math.max(0.6, len * (turnsPerLen || 0.045));
    var tubeR = Math.max(0.12, r * 0.16);
    var tubularSegs = Math.max(8, Math.round(24 * turns));
    for (var i = 0; i < nFlutes; i++) {
      var phase = (i * 2 * Math.PI) / nFlutes;
      var curve = helixCurve(r * 0.86, turns, len, phase);
      var g = new THREE.TubeGeometry(curve, tubularSegs, tubeR, 5, false);
      g.translate(0, 0, z0);
      var f = mesh(g, material);
      group.add(f);
    }
  }

  // Box with chamfered edges (bevelled vertical edges; enough to catch the highlight on an insert)
  function chamferedBox(w, h, d, c) {
    var sh = new THREE.Shape(), x = w / 2, y = h / 2;
    sh.moveTo(-x + c, -y); sh.lineTo(x - c, -y); sh.lineTo(x, -y + c); sh.lineTo(x, y - c); sh.lineTo(x - c, y);
    sh.lineTo(-x + c, y); sh.lineTo(-x, y - c); sh.lineTo(-x, -y + c); sh.lineTo(-x + c, -y);
    var g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelThickness: c * 0.6, bevelSize: c * 0.6, bevelSegments: 1 });
    g.translate(0, 0, -d / 2); return g;
  }

  // Real fluted body: a cross-section (N lands + N curved gullets) swept up Z with a helix twist.
  // opts: helix (deg, 0 = straight flutes), core (web radius share), land (share of each pitch that is full Ø),
  //       point (half-angle deg: 59 = 118° drill point, 0 = flat end), segs (profile points per flute).
  function flutedGeo(r, len, n, opts) {
    opts = opts || {};
    var helix = (opts.helix === undefined ? 30 : opts.helix) * Math.PI / 180, core = opts.core || 0.58, land = opts.land || 0.32;
    var per = opts.segs || 16, M = n * per, pitch = 2 * Math.PI / n;
    var ptLen = opts.point ? r / Math.tan(opts.point * Math.PI / 180) : 0;
    var rings = Math.min(160, Math.max(12, Math.ceil(len / Math.max(0.25, r * 0.12)))) + 1;
    var twist = Math.tan(helix) / r;                      // rad per mm: the flute winds at the helix angle on the OD
    function rho(a) {                                     // profile radius at angle a: land at full Ø, gullet dips to the core
      var u = ((a % pitch) + pitch) % pitch / pitch;
      if (u < land) return r;
      var v = (u - land) / (1 - land);                    // 0..1 across the gullet: steep cutting face, long heel
      var d = v < 0.35 ? Math.sin(v / 0.35 * Math.PI / 2) : Math.cos((v - 0.35) / 0.65 * Math.PI / 2);
      return r - (r - r * core) * Math.pow(Math.max(0, d), 0.8);
    }
    var pos = [], uv = [], idx = [];
    for (var k = 0; k < rings; k++) {
      var z = len * k / (rings - 1), cap = ptLen && z < ptLen ? Math.max(0.02, z * Math.tan(opts.point * Math.PI / 180)) : Infinity;
      for (var j = 0; j < M; j++) {
        var a = j / M * 2 * Math.PI, rr = Math.min(rho(a), cap), ang = a + z * twist;
        pos.push(rr * Math.cos(ang), rr * Math.sin(ang), z);
        uv.push(j / M, z / len);                            // turned/brushed textures run along the axis
      }
    }
    for (k = 0; k < rings - 1; k++) for (j = 0; j < M; j++) {
      var a0 = k * M + j, a1 = k * M + (j + 1) % M, b0 = a0 + M, b1 = a1 + M;
      idx.push(a0, a1, b1, a0, b1, b0);
    }
    var c0 = pos.length / 3; pos.push(0, 0, 0); var c1 = c0 + 1; pos.push(0, 0, len); uv.push(0, 0, 0, 1);   // end caps (flat end / shank side)
    for (j = 0; j < M; j++) { idx.push(c0, (j + 1) % M, j); idx.push(c1, (rings - 1) * M + j, (rings - 1) * M + (j + 1) % M); }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  // Estimated cutter length (tip to end of flutes/body) per tool type -- used
  // to size the holder so it never overlaps the cutting portion, and so the
  // whole stack's top lands exactly at gaugeZ (= tool.l).
  function fluteLenFor(t, r, l) {
    switch (t) {
      case 1:  return r / Math.tan(45 * Math.PI / 180) + Math.max(6, r * 2.5);
      case 2:  return r / Math.tan(59 * Math.PI / 180) + Math.min(l * 0.55, Math.max(r * 7, 20)) + 4;
      case 3:  return Math.max(2.5, r * 0.9) + Math.min(l * 0.5, Math.max(r * 4, 18));
      case 4:  case 5: case 9: return Math.min(l * 0.4, Math.max(r * 3.2, 10));
      case 6:  return Math.max(18, r * 0.5);
      case 7:  return Math.max(20, l * 0.18);
      case 8:  return r + Math.max(4, r);
      case 42: return Math.min(l * 0.45, Math.max(r * 5, 16)) + Math.max(1.5, r * 0.35);
      case 11: return r + Math.max(20, l * 0.35);
      default: return Math.max(10, l * 0.4);
    }
  }

  var TEX_PROPS = ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'alphaMap', 'bumpMap', 'emissiveMap',
    'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap', 'anisotropyMap', 'aoMap'];

  function disposeObj(obj) {
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          TEX_PROPS.forEach(function (p) { if (m[p] && m[p].isTexture) m[p].dispose(); });
          m.dispose();
        });
      }
    });
  }

  /* ---------------------------------------------------------------- procedural textures
   * Small canvas textures (<=256px) for a machined-metal look: fine "turned"
   * axial feed marks, a black-oxide mottle, a knurl grip and laser-etched
   * labels. Cheap to build (this only ever runs at TOOL CALL, never per
   * frame) and disposed with the rest of the group via TEX_PROPS above. */

  function mkCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // Fine axial "turned" surface: closely-spaced horizontal brightness bands
  // -- the helical feed marks a lathe/grinder leaves -- tiled along V (the
  // cylinder's height direction) so it repeats correctly at any part length.
  function turnedTexture(baseL) {
    baseL = (baseL === undefined) ? 0.72 : baseL;
    var w = 32, h = 256;
    var cv = mkCanvas(w, h), cx = cv.getContext('2d');
    var img = cx.createImageData(w, h);
    for (var y = 0; y < h; y++) {
      var band = Math.sin(y * 1.35) * 0.10;
      var fine = Math.sin(y * 0.5 + Math.sin(y * 0.09) * 2.5) * 0.06;
      var n = (Math.random() - 0.5) * 0.05;
      var v = baseL + band + fine + n;
      v = Math.max(0.05, Math.min(0.98, v));
      var g = Math.round(v * 255);
      for (var x = 0; x < w; x++) { var idx = (y * w + x) * 4; img.data[idx] = g; img.data[idx + 1] = g; img.data[idx + 2] = g; img.data[idx + 3] = 255; }
    }
    cx.putImageData(img, 0, 0);
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 6);
    tex.needsUpdate = true;
    return tex;
  }

  // Black-oxide mottle: dark, low-contrast blotches for tap/black-oxide parts.
  function blackOxideTexture() {
    var w = 64, h = 64;
    var cv = mkCanvas(w, h), cx = cv.getContext('2d');
    cx.fillStyle = 'rgb(40,40,43)'; cx.fillRect(0, 0, w, h);
    for (var i = 0; i < 220; i++) {
      var vx = Math.random() * w, vy = Math.random() * h, rr = 0.5 + Math.random() * 1.6;
      var v = 30 + Math.round(Math.random() * 22);
      cx.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 2) + ',' + (0.3 + Math.random() * 0.3) + ')';
      cx.beginPath(); cx.arc(vx, vy, rr, 0, Math.PI * 2); cx.fill();
    }
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 4);
    tex.needsUpdate = true;
    return tex;
  }

  // Diamond-crosshatch knurl for the ER collet nut's grip band.
  function knurlTexture() {
    var w = 128, h = 64;
    var cv = mkCanvas(w, h), cx = cv.getContext('2d');
    cx.fillStyle = 'rgb(150,152,157)'; cx.fillRect(0, 0, w, h);
    cx.strokeStyle = 'rgba(68,70,75,0.9)'; cx.lineWidth = 1.4;
    var step = 8;
    cx.beginPath();
    for (var i = -h; i < w + h; i += step) { cx.moveTo(i, 0); cx.lineTo(i + h, h); }
    cx.stroke();
    cx.beginPath();
    for (var j = -h; j < w + h; j += step) { cx.moveTo(j, 0); cx.lineTo(j - h, h); }
    cx.stroke();
    var tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 1.4);
    tex.needsUpdate = true;
    return tex;
  }

  // Two drive-key slots + an orientation notch as a dark decal band (no CSG
  // available to actually remove material, so the recess is faked with a
  // mostly-transparent texture over a ring sitting at the flange's groove
  // root -- reads correctly at a glance, which is all this needs to do).
  function flangeSlotsTexture() {
    var w = 256, h = 64;
    var cv = mkCanvas(w, h), cx = cv.getContext('2d');
    cx.clearRect(0, 0, w, h);
    cx.fillStyle = 'rgba(24,24,27,0.85)';
    cx.fillRect(w * 0.06, h * 0.15, w * 0.10, h * 0.7);
    cx.fillRect(w * 0.56, h * 0.15, w * 0.10, h * 0.7);
    cx.fillStyle = 'rgba(14,14,16,0.9)';
    cx.fillRect(w * 0.85, h * 0.3, w * 0.045, h * 0.4);
    var tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    return tex;
  }

  // Laser-etched label: dark strokes on a transparent canvas, mounted on a
  // curvedPatch just proud of the part's surface.
  function labelTexture(text, w, h) {
    w = w || 256; h = h || 56;
    var cv = mkCanvas(w, h), cx = cv.getContext('2d');
    cx.clearRect(0, 0, w, h);
    cx.font = 'bold ' + Math.round(h * 0.58) + 'px Arial,Helvetica,sans-serif';
    cx.textAlign = 'center'; cx.textBaseline = 'middle';
    cx.fillStyle = 'rgba(0,0,0,0.62)';
    cx.fillText(text, w / 2, h / 2 + 1);
    var tex = new THREE.CanvasTexture(cv);
    tex.needsUpdate = true;
    return tex;
  }

  function labelDecal(text, r, zCenter, h, thetaStart, thetaLength, segs) {
    var lt = labelTexture(text);
    var lp = curvedPatch(r, zCenter - h / 2, h, thetaStart, thetaLength, segs || 20);
    var lmat = new THREE.MeshStandardMaterial({ map: lt, transparent: true, roughness: 0.5, metalness: 0.4, depthWrite: false });
    return mesh(lp, lmat);
  }

  /* ---------------------------------------------------------------- holders */

  // SK40 / DIN 69871 steep-taper holder with an ER collet chuck, for shank
  // tools. `gripZ` = local z (holder-local, base at 0) where the collet
  // grips the tool shank -- that is where the cutter's shank should stop.
  /* steep-taper holder sizes: ISO 50 / SK50 (the operator's machine) and SK40 */
  var HOLDERS = {
    ISO50: { label: 'ISO 50 (SK50) DIN 69871 · ER32 · A 100', A: 100, flangeR: 50, taperR0: 34.9, taperR1: 22, taperLen: 70, bodyMin: 26, bodyLen: 49, flangeLen: 11, noseMin: 40 },
    SK40:  { label: 'SK40 DIN 69871 · ER32 · A 70', A: 70, flangeR: 31.75, taperR0: 27.3, taperR1: 12.3, taperLen: 48, bodyMin: 17, bodyLen: 32, flangeLen: 8, noseMin: 30 }
  };
  var style = 'ISO50';
  function setHolder(s) { if (HOLDERS[s]) style = s; }
  /* holder height below the gauge line (spindle face): nut + body + flange */
  /* gauge line (spindle face) to collet nose: the standard A dimension */
  function holderStack(r) { return HOLDERS[style].A; }

  // V-flange (DIN 69871 gripper groove) + 7:24 taper + retention knob,
  // shared by every steep-taper holder variant below. Appends from z (the
  // flange's bottom) up through the taper to gaugeZ; the knob extends a
  // little further (it sits inside the spindle taper bore, out of sight).
  // Returns the new z, which equals gaugeZ.
  function addFlangeTaperKnob(grp, z, flangeR, flangeLen, taperR0, taperR1, taperLen, holdMat, taperMat, knobMat, slotsTex, labelStr) {
    if (flangeLen > 0.3) {
      var g = flangeR * 0.12; // V-groove depth (gripper groove the change-arm claw engages)
      var fpts = [
        [flangeR * 0.95, 0],
        [flangeR, flangeLen * 0.16],
        [flangeR, flangeLen * 0.34],
        [flangeR - g, flangeLen * 0.5],
        [flangeR, flangeLen * 0.66],
        [flangeR, flangeLen * 0.84],
        [flangeR * 0.97, flangeLen]
      ];
      var flange = mesh(latheZ(fpts, 28), holdMat);
      flange.position.z = z; flange.name = 'flange'; grp.add(flange);
      if (slotsTex) {
        var slotMat = new THREE.MeshStandardMaterial({ map: slotsTex, color: 0x9aa0aa, roughness: 0.55, metalness: 0.7, transparent: true, depthWrite: false });
        var band = mesh(frustum(flangeR - g + 0.05, flangeR - g + 0.05, flangeLen * 0.3, 28), slotMat);
        band.position.z = z + flangeLen * 0.35; grp.add(band);
      }
      if (labelStr) grp.add(labelDecal(labelStr, flangeR + 0.05, z + flangeLen * 0.5, Math.min(7, flangeLen * 0.7), 1.25, 1.7, 20));
      z += flangeLen;
    }
    var gaugeZ = z;   // flange top = spindle face (gauge line); the 7:24 taper goes up into the spindle from here
    var taper = mesh(chamferedCyl(taperR0, taperR1, taperLen, Math.min(1.1, taperLen * 0.05), 28), taperMat);
    taper.position.z = z; taper.name = 'taper'; grp.add(taper);
    z += taperLen;
    // retention knob: shouldered pull stud with a small groove near the tip
    var kpts = [[0.02, 0], [6.2, 0], [6.2, 3.5], [4.6, 4.2], [4.6, 8.5], [3.6, 9.2], [3.6, 12.5], [2.2, 14]];
    var knob = mesh(latheZ(kpts, 16), knobMat);
    knob.position.z = z; knob.name = 'retention-knob'; grp.add(knob);
    return gaugeZ;
  }

  function holderSK40Collet(THREE_, opts) {
    var r = opts.r, gaugeZ = opts.gaugeZ, H = HOLDERS[style];
    var tex = turnedTexture(0.70);
    var holdMat = steelMat(COL.holder, 0.42, tex);
    var taperMat = steelMat(COL.holderHi, 0.40, tex);
    var knobMat = steelMat(COL.holder, 0.38, null);
    var colletMat = steelMat(COL.holderHi, 0.36, tex);   // ER nut: plain ground steel, lead-in cone at the front
    var slotsTex = flangeSlotsTexture();
    var shortLabel = (style === 'SK40' ? 'SK40' : 'ISO50') + ' ER32';
    var grp = new THREE.Group(); grp.name = 'holder';

    var noseR = Math.max(25, r + 6);           // ER32 clamping nut: Ø50 whatever the tool (standard nut OD)
    var noseLen = Math.max(r * 3.2, H.noseMin);
    var bodyR = Math.max(noseR * 1.35, H.bodyMin);
    var bodyLen = H.bodyLen;
    var flangeR = H.flangeR;                    // SK40 Ø63.5 · ISO 50 Ø100
    var flangeLen = H.flangeLen;
    var taperR0 = H.taperR0, taperR1 = H.taperR1; // 7:24 taper
    var taperLen = H.taperLen;

    var stackSum = noseLen + bodyLen + flangeLen;
    var maxStack = (opts.maxStack !== undefined) ? opts.maxStack : stackSum;
    var scale = Math.min(1, Math.max(0.12, maxStack / stackSum));
    noseLen *= scale; bodyLen *= scale; flangeLen *= scale; taperLen *= scale;

    var gripZ = gaugeZ - noseLen - bodyLen - flangeLen; // bottom of holder stack
    var z = gripZ;

    // ER collet nut: 12-flat faceted body (flatShaded) with a knurl band
    var nose = mesh(latheZ([[r + 0.6, 0], [noseR * 0.78, 0], [noseR * 0.9, 3], [noseR, 6], [noseR, noseLen - 1.5], [noseR - 1.5, noseLen]], 48), colletMat);
    nose.position.z = z; nose.name = 'collet-nut'; grp.add(nose); z += noseLen;

    var body = mesh(chamferedCyl(bodyR, bodyR, bodyLen, Math.min(1, bodyLen * 0.06), 24), holdMat);
    body.position.z = z; body.name = 'body'; grp.add(body); z += bodyLen;

    addFlangeTaperKnob(grp, z, flangeR, flangeLen, taperR0, taperR1, taperLen, holdMat, taperMat, knobMat, slotsTex, shortLabel);

    return { obj: grp, gripZ: gripZ };
  }

  // Shell-mill arbor for the face mill: stub arbor + pull bolt shoulder,
  // same SK40 taper stack on top.
  function holderShellArbor(THREE_, opts) {
    var gaugeZ = opts.gaugeZ;
    var tex = turnedTexture(0.66);
    var bodyMat = steelMat(COL.holder, 0.42, tex);
    var taperMat = steelMat(COL.holderHi, 0.40, tex);
    var knobMat = steelMat(COL.holder, 0.38, null);
    var slotsTex = flangeSlotsTexture();
    var grp = new THREE.Group(); grp.name = 'holder';

    var hubR = 26, hubLen = 22;
    var flangeR = 31.75, flangeLen = 8;
    var taperR0 = flangeR * 0.86, taperR1 = 12.3, taperLen = 48;

    var stackSum = hubLen + flangeLen;
    var maxStack = (opts.maxStack !== undefined) ? opts.maxStack : stackSum;
    var scale = Math.min(1, Math.max(0.12, maxStack / stackSum));
    hubLen *= scale; flangeLen *= scale; taperLen *= scale;

    var gripZ = gaugeZ - hubLen - flangeLen;
    var z = gripZ;

    var hub = mesh(chamferedCyl(hubR, hubR, hubLen, Math.min(1, hubLen * 0.08), 24), bodyMat);
    hub.position.z = z; hub.name = 'arbor'; grp.add(hub);

    // centre pull bolt boss visible through the arbor bore
    var boss = mesh(frustum(6, 6, hubLen + 4, 10), mat(COL.brass, 0.32, 0.72, { clearcoat: 0.2 }));
    boss.position.z = z - hubLen - 2; grp.add(boss);
    z += hubLen;

    addFlangeTaperKnob(grp, z, flangeR, flangeLen, taperR0, taperR1, taperLen, bodyMat, taperMat, knobMat, slotsTex, 'SHELL MILL');

    return { obj: grp, gripZ: gripZ };
  }

  // The touch probe's own dedicated body (not a generic SK40 stack, though
  // it still terminates the same way at gaugeZ so it sits in the spindle).
  function holderProbeBody(THREE_, opts) {
    var gaugeZ = opts.gaugeZ;
    var grp = new THREE.Group(); grp.name = 'holder';
    var bodyMat = mat(0xd7d2c4, 0.58, 0.18);   // ceramic/plastic probe housing
    var tex = turnedTexture(0.62);
    var steelMatL = steelMat(COL.holder, 0.42, tex);
    var taperMat = steelMat(COL.holderHi, 0.40, tex);
    var knobMat = steelMat(COL.holder, 0.38, null);
    var slotsTex = flangeSlotsTexture();

    var housingR = 21, housingLen = 62;
    var flangeR = 31.75, flangeLen = 8;
    var taperR0 = flangeR * 0.86, taperR1 = 12.3, taperLen = 48;

    var stackSum = housingLen + flangeLen;
    var maxStack = (opts.maxStack !== undefined) ? opts.maxStack : stackSum;
    var scale = Math.min(1, Math.max(0.12, maxStack / stackSum));
    housingLen *= scale; flangeLen *= scale; taperLen *= scale;

    var gripZ = gaugeZ - housingLen - flangeLen;
    var z = gripZ;

    var housing = mesh(chamferedCyl(housingR, housingR, housingLen, Math.min(1.2, housingLen * 0.05), 20), bodyMat);
    housing.position.z = z; housing.name = 'probe-housing'; grp.add(housing);
    var band = mesh(frustum(housingR + 0.6, housingR + 0.6, 6, 20), mat(0xff5347, 0.45, 0.08));
    band.position.z = z + housingLen * 0.5; grp.add(band);
    z += housingLen;

    addFlangeTaperKnob(grp, z, flangeR, flangeLen, taperR0, taperR1, taperLen, steelMatL, taperMat, knobMat, slotsTex, 'TS 640');

    return { obj: grp, gripZ: gripZ };
  }

  // Offset boring-head body: a stepped cylinder with a radial slide/knob.
  function holderBoreHead(THREE_, opts) {
    var gaugeZ = opts.gaugeZ;
    var grp = new THREE.Group(); grp.name = 'holder';
    var tex = turnedTexture(0.62);
    var bodyMat = steelMat(COL.holder, 0.42, tex);
    var taperMat = steelMat(COL.holderHi, 0.40, tex);
    var knobMat = steelMat(COL.holder, 0.38, null);
    var slotsTex = flangeSlotsTexture();

    var headR = 30, headLen = 46;
    var flangeR = 31.75, flangeLen = 8;
    var taperR0 = flangeR * 0.86, taperR1 = 12.3, taperLen = 48;

    var stackSum = headLen + flangeLen;
    var maxStack = (opts.maxStack !== undefined) ? opts.maxStack : stackSum;
    var scale = Math.min(1, Math.max(0.12, maxStack / stackSum));
    headLen *= scale; flangeLen *= scale; taperLen *= scale;

    var gripZ = gaugeZ - headLen - flangeLen;
    var z = gripZ;

    var head = mesh(chamferedCyl(headR, headR, headLen, Math.min(1, headLen * 0.05), 24), bodyMat);
    head.position.z = z; head.name = 'bore-head-body'; grp.add(head);
    // graduated adjustment knob on the side
    var knobGeo = new THREE.CylinderGeometry(7, 7, 16, 16);
    knobGeo.rotateZ(Math.PI / 2);
    knobGeo.translate(headR + 6, 0, z + headLen * 0.55);
    var adjKnob = mesh(knobGeo, mat(COL.brass, 0.38, 0.62, { clearcoat: 0.15 }));
    grp.add(adjKnob);
    z += headLen;

    addFlangeTaperKnob(grp, z, flangeR, flangeLen, taperR0, taperR1, taperLen, bodyMat, taperMat, knobMat, slotsTex, 'BORE HEAD');

    return { obj: grp, gripZ: gripZ };
  }

  /* ---------------------------------------------------------------- cutters */

  function shankCutter(THREE_, r, l, gripZ, opts) {
    opts = opts || {};
    var grp = new THREE.Group(); grp.name = 'cutter';
    var cutMat = mat(opts.color || COL.carbide, (opts.rough === undefined) ? 0.4 : opts.rough, (opts.metal === undefined) ? 0.62 : opts.metal, opts.matExtra);
    var shankTex = turnedTexture(0.74);
    var shankMat = steelMat(COL.hss, 0.32, shankTex);

    var fluteLen = opts.fluteLen || Math.min(l * 0.42, Math.max(r * 4.5, 14));
    var shankR = opts.shankR || r;
    var shankTop = gripZ;               // shank rises to where the holder grips it

    // flute body (solid cylinder, chamfered edge) + helical groove tubes for the look
    var body = mesh(flutedGeo(r, fluteLen, opts.flutes || 2, { helix: opts.helix === undefined ? 35 : opts.helix, core: opts.core || 0.6, segs: opts.flutes > 3 ? 12 : 18 }), cutMat);
    body.name = 'flutes'; grp.add(body);

    // shank from end of flutes up to the collet grip line
    if (shankTop > fluteLen) {
      var shank = mesh(chamferedCyl(shankR, shankR, shankTop - fluteLen, Math.min(0.6, shankR * 0.12), 18), shankMat);
      shank.position.z = fluteLen; shank.name = 'shank'; grp.add(shank);
      if (opts.label) {
        var midZ = fluteLen + (shankTop - fluteLen) * 0.5;
        var lh = Math.min(8, (shankTop - fluteLen) * 0.6);
        if (lh > 2) grp.add(labelDecal(opts.label, shankR + 0.05, midZ, lh, 0.9, 1.1, 16));
      }
    }
    return { obj: grp, fluteLen: fluteLen };
  }

  function buildSpotDrill(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var tipMat = mat(COL.carbide, 0.35, 0.55, { clearcoat: 0.08 });
    var pointLen = r / Math.tan(45 * Math.PI / 180); // 90 deg included -> half-angle 45
    var tip = mesh(tipCone(r, pointLen, 16), tipMat);
    grp.add(tip);
    var bodyLen = Math.max(6, r * 2.5);
    var body = mesh(chamferedCyl(r, r, bodyLen, Math.min(0.5, r * 0.12), 16), tipMat);
    body.position.z = pointLen; grp.add(body);
    var shankTop = gripZ;
    var top = pointLen + bodyLen;
    if (shankTop > top) {
      var shank = mesh(chamferedCyl(r * 0.9, r * 0.9, shankTop - top, Math.min(0.5, r * 0.1), 14), steelMat(COL.hss, 0.3, turnedTexture(0.76)));
      shank.position.z = top; grp.add(shank);
    }
    return grp;
  }

  function buildTwistDrill(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var tex = turnedTexture(0.78);
    var body = steelMat(COL.hss, 0.3, tex);
    var pointLen = r / Math.tan(59 * Math.PI / 180); // 118 deg included -> half 59
    var fluteLen = Math.min(tool.l * 0.55, Math.max(r * 7, 20));
    var ground = mat(COL.hss, 0.22, 0.9, { clearcoat: 0.1 });                    // ground HSS: the flutes are ground, not turned
    var fl = mesh(flutedGeo(r, pointLen + fluteLen, 2, { helix: 30, core: 0.3, land: 0.42, point: 59, segs: 22 }), ground);
    fl.name = 'flutes'; grp.add(fl);
    var necked = mesh(chamferedCyl(r * 0.86, r * 0.86, 4, 0.4, 14), body);
    necked.position.z = pointLen + fluteLen; grp.add(necked);
    var shankTop = gripZ, top = pointLen + fluteLen + 4;
    if (shankTop > top) {
      var shank = mesh(chamferedCyl(r * 0.9, r * 0.9, shankTop - top, Math.min(0.5, r * 0.1), 14), steelMat(COL.hss, 0.28, tex));
      shank.position.z = top; grp.add(shank);
    }
    return grp;
  }

  function buildTap(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var boTex = blackOxideTexture();
    var tapMat = mat(COL.blackox, 0.62, 0.32, { map: boTex, roughnessMap: boTex });
    var chamferLen = Math.max(2.5, r * 0.9);
    var chamfer = mesh(frustum(r * 0.55, r, chamferLen, 14), tapMat);
    grp.add(chamfer);
    var threadLen = Math.min(tool.l * 0.5, Math.max(r * 4, 18));
    var body = mesh(chamferedCyl(r, r, threadLen, Math.min(0.4, r * 0.08), 16), tapMat);
    body.position.z = chamferLen; grp.add(body);
    // thread ridges: shallow torus rings (one geometry, reused per ring)
    var turns = Math.max(6, Math.round(threadLen / (r * 0.35)));
    var ringGeo = new THREE.TorusGeometry(r * 1.02, r * 0.06, 5, 14);
    for (var i = 0; i < turns; i++) {
      var tz = chamferLen + (i + 0.5) * (threadLen / turns);
      var ring = mesh(ringGeo, tapMat);
      ring.position.z = tz; grp.add(ring);
    }
    var top = chamferLen + threadLen, shankTop = gripZ;
    if (shankTop > top) {
      var shankMat = steelMat(COL.steel, 0.4, turnedTexture(0.68));
      var shank = mesh(chamferedCyl(r * 0.82, r * 0.82, shankTop - top, Math.min(0.4, r * 0.1), 12), shankMat);
      shank.position.z = top; grp.add(shank);
      // square drive at very top
      var sqH = Math.min(6, shankTop - top);
      var sq = new THREE.BoxGeometry(r * 1.0, r * 1.0, sqH);
      sq.translate(0, 0, shankTop - sqH / 2);
      grp.add(mesh(sq, shankMat));
    }
    return grp;
  }

  function buildEndmill(tool, gripZ, flutes) {
    var r = tool.r, nf = flutes || (r > 4 ? 4 : 2);
    var diaStr = (Math.round(r * 20) / 10).toString();
    var res = shankCutter(THREE, r, tool.l, gripZ, {
      color: COL.tin, rough: 0.32, metal: 0.72, matExtra: { clearcoat: 0.3, clearcoatRoughness: 0.18 },
      flutes: nf, fluteLen: Math.min(tool.l * 0.4, Math.max(r * 3.2, 10)),
      label: 'HM Ø' + diaStr + ' Z' + nf
    });
    return res.obj;
  }

  function buildFacemill(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var tex = turnedTexture(0.60);
    var bodyMat = steelMat(COL.steel, 0.4, tex);
    var discLen = Math.max(18, r * 0.5);
    var nInserts = Math.max(4, Math.min(10, Math.round(r / 5)));                 // Ø50: 5 inserts
    var land = 0.62, pitch = 2 * Math.PI / nInserts;
    var body = mesh(flutedGeo(r * 0.93, discLen, nInserts, { helix: 0, core: 0.72, land: land, segs: 16 }), bodyMat);   // chip pockets
    body.name = 'body'; body.position.z = 0.8; grp.add(body);   // inserts stand 0.8 mm proud of the body face
    // square 45° inserts (SEKT-style), seated on each pocket's cutting face, corner at the cutter Ø at z = 0
    var s = Math.max(6, Math.min(12.7, r * 0.3)), th = s * 0.38;
    var insMat = mat(0x3b3e44, 0.3, 0.55, { clearcoat: 0.35, clearcoatRoughness: 0.2 });   // TiAlN-coated carbide: dark anthracite
    var screwMat = mat(0x8a8f96, 0.3, 0.9);
    var insGeo = chamferedBox(s, s, th, s * 0.06);
    var screwGeo = new THREE.CylinderGeometry(s * 0.17, s * 0.17, th * 0.3, 12); screwGeo.rotateX(Math.PI / 2);
    screwGeo.translate(0, 0, th / 2 + th * 0.15);
    for (var i = 0; i < nInserts; i++) {
      var a = i * pitch + land * pitch + 0.01;
      var seat = new THREE.Group();
      seat.rotation.z = a;                                   // local X = radial, local Y = tangential (into the pocket)
      var ins = new THREE.Group(); ins.add(mesh(insGeo, insMat)); ins.add(mesh(screwGeo, screwMat));
      ins.rotation.set(-Math.PI / 2, 0, Math.PI / 4);        // Euler XYZ = Rx·Rz: turned 45° in its own plane (lead angle), then face -> tangential
      var hd = s * Math.SQRT1_2;
      ins.position.set(r - hd, th / 2, hd);
      seat.add(ins); grp.add(seat);
    }
    var shankTop = gripZ, top = discLen;
    if (shankTop > top) {
      var hub = mesh(chamferedCyl(r * 0.28, r * 0.28, shankTop - top, Math.min(0.5, r * 0.05), 20), bodyMat);
      hub.position.z = top; grp.add(hub);
    }
    return grp;
  }

  function buildBoreHead(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var bodyMat = steelMat(COL.steel, 0.4, turnedTexture(0.6));
    var bodyLen = Math.max(20, tool.l * 0.18);
    var body = mesh(chamferedCyl(9, 9, bodyLen, 0.5, 18), bodyMat);
    grp.add(body);
    // single radial insert holder arm reaching out to r
    var arm = new THREE.BoxGeometry(r * 1.9, 7, 7);
    arm.translate(r * 0.5, 0, bodyLen * 0.75);
    grp.add(mesh(arm, bodyMat));
    var insert = new THREE.BoxGeometry(6, 6, 3);
    insert.translate(r * 0.98, 0, bodyLen * 0.75 - 3);
    grp.add(mesh(insert, mat(COL.insert, 0.28, 0.25, { clearcoat: 0.08 })));
    var shankTop = gripZ, top = bodyLen;
    if (shankTop > top) {
      var shank = mesh(chamferedCyl(9, 9, shankTop - top, 0.5, 16), bodyMat);
      shank.position.z = top; grp.add(shank);
    }
    return grp;
  }

  function buildChamfer(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var cutMat = mat(COL.carbide, 0.35, 0.55, { clearcoat: 0.06 });
    var coneLen = r; // 90deg included, half-angle 45
    var cone = mesh(flutedGeo(r, coneLen, 4, { helix: 0, core: 0.55, land: 0.3, point: 45, segs: 14 }), cutMat);   // 90° countersink with 4 straight flutes
    cone.name = 'flutes'; grp.add(cone);
    var neckLen = Math.max(4, r);
    var neckTex = turnedTexture(0.75);
    var neck = mesh(chamferedCyl(r * 0.35, r * 0.35, neckLen, Math.min(0.3, r * 0.08), 14), steelMat(COL.hss, 0.3, neckTex));
    neck.position.z = coneLen; grp.add(neck);
    var top = coneLen + neckLen, shankTop = gripZ;
    if (shankTop > top) {
      var shank = mesh(chamferedCyl(r * 0.5, r * 0.5, shankTop - top, Math.min(0.3, r * 0.08), 14), steelMat(COL.hss, 0.28, neckTex));
      shank.position.z = top; grp.add(shank);
    }
    return grp;
  }

  function buildReamer(tool, gripZ) {
    var r = tool.r;
    var res = shankCutter(THREE, r, tool.l, gripZ, {
      color: COL.hss, rough: 0.3, metal: 0.6, matExtra: { clearcoat: 0.12 }, flutes: 6, helix: 0, core: 0.8,
      fluteLen: Math.min(tool.l * 0.45, Math.max(r * 5, 16))
    });
    // slight lead chamfer at the very tip
    var chLen = Math.max(1.5, r * 0.35);
    var ch = mesh(frustum(r * 0.8, r, chLen, 16), mat(COL.hss, 0.3, 0.6));
    res.obj.add(ch);
    return res.obj;
  }

  function buildProbe(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var stemMat = mat(0xb9bec4, 0.32, 0.75, { clearcoat: 0.15 });
    var ballMat = mat(COL.ruby, 0.1, 0.05, { clearcoat: 1.0, clearcoatRoughness: 0.05, ior: 1.77 });
    var ball = mesh(new THREE.SphereGeometry(r, 24, 18), ballMat);
    ball.position.z = r; ball.name = 'stylus-ball'; grp.add(ball);
    var stemLen = Math.max(20, tool.l * 0.35);
    var stem = mesh(frustum(1.6, 2.4, stemLen, 12), stemMat);
    stem.position.z = r; grp.add(stem);
    var top = r + stemLen, shankTop = gripZ;
    if (shankTop > top) {
      var body = mesh(chamferedCyl(9, 9, shankTop - top, 0.5, 16), mat(0xd7d2c4, 0.55, 0.12));
      body.position.z = top; grp.add(body);
    }
    return grp;
  }

  function buildFallback(tool, gripZ) {
    var r = tool.r || 4, grp = new THREE.Group(); grp.name = 'cutter';
    var m = mat(0xffb03a, 0.5, 0.5);
    var top = fluteLenFor(-1, r, tool.l || 60);
    var body = mesh(chamferedCyl(r, r, top, Math.min(0.5, r * 0.1), 14), m);
    grp.add(body);
    if (gripZ > top) {
      var shank = mesh(chamferedCyl(r * 0.8, r * 0.8, gripZ - top, Math.min(0.4, r * 0.08), 12), mat(COL.steel));
      shank.position.z = top; grp.add(shank);
    }
    return grp;
  }

  /* ---------------------------------------------------------------- dispatch */

  // tool number -> { cutterFn, holderFn }
  var TABLE = {
    1:  { cutter: buildSpotDrill,                       holder: holderSK40Collet },
    2:  { cutter: buildTwistDrill,                      holder: holderSK40Collet },
    3:  { cutter: buildTap,                              holder: holderSK40Collet },
    4:  { cutter: function (t, g) { return buildEndmill(t, g, 2); }, holder: holderSK40Collet },
    5:  { cutter: function (t, g) { return buildEndmill(t, g, 4); }, holder: holderSK40Collet },
    9:  { cutter: function (t, g) { return buildEndmill(t, g, 2); }, holder: holderSK40Collet },
    6:  { cutter: buildFacemill,                         holder: holderShellArbor },
    7:  { cutter: buildBoreHead,                         holder: holderBoreHead },
    8:  { cutter: buildChamfer,                          holder: holderSK40Collet },
    11: { cutter: buildProbe,                             holder: holderProbeBody },
    42: { cutter: buildReamer,                            holder: holderSK40Collet }
  };

  function build(THREE_, tool) {
    if (typeof THREE_ !== 'undefined') { /* THREE global already used directly below */ }
    var group = new THREE.Group();
    group.name = 'tool';

    if (!tool) {
      // No tool loaded: empty spindle nose only (still a valid holder-less group).
      var gaugeZ0 = 0;
      return { group: group, holder: null, cutter: null, gaugeZ: gaugeZ0 };
    }

    var r = Math.max(0.2, tool.r || 3);
    var l = Math.max(1, tool.l || 60);   // gaugeZ MUST equal tool.l -- never overridden
    var entry = TABLE[tool.t] || { cutter: buildFallback, holder: holderSK40Collet };

    var flute = fluteLenFor(tool.t, r, l);
    var holderBudget = Math.max(4, l - flute);
    var holderRes = entry.holder(THREE, { r: r, gaugeZ: l, maxStack: holderBudget });
    var cutter = entry.cutter({ r: r, l: l, t: tool.t, name: tool.name }, holderRes.gripZ);
    cutter.name = 'cutter';
    holderRes.obj.name = 'holder';

    group.add(holderRes.obj);
    group.add(cutter);

    return { group: group, holder: holderRes.obj, cutter: cutter, gaugeZ: l };
  }

  function dispose(group) {
    if (!group) return;
    disposeObj(group);
  }

  return { build: build, dispose: dispose, setHolder: setHolder, holderStack: holderStack, holderLabel: function () { return HOLDERS[style].label; }, get holder() { return style; } };
})();

if (typeof module !== 'undefined') module.exports = TNC_TOOLS3D;
