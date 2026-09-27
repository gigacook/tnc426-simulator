/* ==========================================================================
 * TNC 426 simulator -- tools3d.js
 * Builds recognisable 3-D tool + holder models for the TNC.TOOLS table.
 * Plain browser JS (ES5-ish), classic global THREE (r128), no modules.
 * Exposes a single global: TNC_TOOLS3D  { build, dispose }
 *
 * Convention: the returned group's origin is the TOOL TIP, +Z runs up the
 * tool axis toward the spindle. gaugeZ = tool.l is where the holder meets
 * the spindle face (HEIDENHAIN gauge length).
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

  function mat(hex, rough, metal) {
    return new THREE.MeshStandardMaterial({
      color: hex,
      roughness: (rough === undefined) ? 0.45 : rough,
      metalness: (metal === undefined) ? 0.85 : metal
    });
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

  function disposeObj(obj) {
    obj.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach(function (m) { m.dispose(); });
        else o.material.dispose();
      }
    });
  }

  /* ---------------------------------------------------------------- holders */

  // SK40 / DIN 69871 steep-taper holder with an ER collet chuck, for shank
  // tools. `gripZ` = local z (holder-local, base at 0) where the collet
  // grips the tool shank -- that is where the cutter's shank should stop.
  /* steep-taper holder sizes: ISO 50 / SK50 (the operator's machine) and SK40 */
  var HOLDERS = {
    ISO50: { label: 'ISO 50 (SK50) · ER COLLET CHUCK', flangeR: 50, taperR0: 34.9, taperR1: 22, taperLen: 70, bodyMin: 26, bodyLen: 44, flangeLen: 11, noseMin: 30 },
    SK40:  { label: 'SK40 DIN 69871 · ER COLLET CHUCK', flangeR: 31.75, taperR0: 27.3, taperR1: 12.3, taperLen: 48, bodyMin: 17, bodyLen: 34, flangeLen: 8, noseMin: 24 }
  };
  var style = 'ISO50';
  function setHolder(s) { if (HOLDERS[s]) style = s; }
  /* holder height below the gauge line (spindle face): nut + body + flange */
  function holderStack(r) { var H = HOLDERS[style]; return Math.max((r || 3) * 3.2, H.noseMin) + H.bodyLen + H.flangeLen; }

  function holderSK40Collet(THREE_, opts) {
    var r = opts.r, gaugeZ = opts.gaugeZ, holdMat = mat(COL.holder, 0.5, 0.75), H = HOLDERS[style];
    var colletMat = mat(COL.collet, 0.4, 0.7);
    var grp = new THREE.Group(); grp.name = 'holder';

    var noseR = Math.max(r * 2.0, 9);          // ER nut nose radius
    var noseLen = Math.max(r * 3.2, H.noseMin);
    var bodyR = Math.max(noseR * 1.35, H.bodyMin);
    var bodyLen = H.bodyLen;
    var flangeR = H.flangeR;                    // SK40 Ø63.5 · ISO 50 Ø100
    var flangeLen = H.flangeLen;
    var taperR0 = H.taperR0, taperR1 = H.taperR1; // 7:24 taper
    var taperLen = H.taperLen;

    var stackSum = noseLen + bodyLen + flangeLen + taperLen;
    var maxStack = (opts.maxStack !== undefined) ? opts.maxStack : stackSum;
    var scale = Math.min(1, Math.max(0.12, maxStack / stackSum));
    noseLen *= scale; bodyLen *= scale; flangeLen *= scale; taperLen *= scale;

    var gripZ = gaugeZ - noseLen - bodyLen - flangeLen - taperLen; // bottom of holder stack
    var z = gripZ;

    var nose = mesh(frustum(noseR * 0.72, noseR, noseLen, 16), colletMat);
    nose.position.z = z; nose.name = 'collet-nut'; grp.add(nose); z += noseLen;

    var body = mesh(frustum(bodyR, bodyR, bodyLen, 20), holdMat);
    body.position.z = z; grp.add(body); z += bodyLen;

    var flange = mesh(frustum(flangeR, flangeR, flangeLen, 24), holdMat);
    flange.position.z = z; grp.add(flange); z += flangeLen;

    var taper = mesh(frustum(taperR1, taperR0, taperLen, 24), mat(COL.holderHi, 0.5, 0.75));
    // wide end (spindle face) should sit at the TOP (toward gaugeZ), narrow toward tool
    taper.geometry.dispose();
    taper.geometry = frustum(taperR1, taperR0, taperLen, 24);
    taper.position.z = z; grp.add(taper); z += taperLen; // z now == gaugeZ

    // retention knob
    var knob = mesh(frustum(6, 4, 14, 12), holdMat);
    knob.position.z = z; grp.add(knob);

    return { obj: grp, gripZ: gripZ };
  }

  // Shell-mill arbor for the face mill: stub arbor + pull bolt shoulder,
  // same SK40 taper stack on top.
  function holderShellArbor(THREE_, opts) {
    var gaugeZ = opts.gaugeZ, bodyMat = mat(COL.holder, 0.5, 0.78);
    var grp = new THREE.Group(); grp.name = 'holder';

    var hubR = 26, hubLen = 22;
    var flangeR = 31.75, flangeLen = 8;
    var taperR0 = flangeR * 0.86, taperR1 = 12.3, taperLen = 48;

    var stackSum = hubLen + flangeLen + taperLen;
    var maxStack = (opts.maxStack !== undefined) ? opts.maxStack : stackSum;
    var scale = Math.min(1, Math.max(0.12, maxStack / stackSum));
    hubLen *= scale; flangeLen *= scale; taperLen *= scale;

    var gripZ = gaugeZ - hubLen - flangeLen - taperLen;
    var z = gripZ;

    var hub = mesh(frustum(hubR, hubR, hubLen, 24), bodyMat);
    hub.position.z = z; hub.name = 'arbor'; grp.add(hub); z += hubLen;

    // centre pull bolt boss visible through the arbor bore
    var boss = mesh(frustum(6, 6, hubLen + 4, 10), mat(COL.brass, 0.35, 0.7));
    boss.position.z = z - hubLen - 2; grp.add(boss);

    var flange = mesh(frustum(flangeR, flangeR, flangeLen, 24), bodyMat);
    flange.position.z = z; grp.add(flange); z += flangeLen;

    var taper = mesh(frustum(taperR1, taperR0, taperLen, 24), mat(COL.holderHi, 0.5, 0.75));
    taper.position.z = z; grp.add(taper); z += taperLen;

    var knob = mesh(frustum(6, 4, 14, 12), bodyMat);
    knob.position.z = z; grp.add(knob);

    return { obj: grp, gripZ: gripZ };
  }

  // The touch probe's own dedicated body (not a generic SK40 stack, though
  // it still terminates the same way at gaugeZ so it sits in the spindle).
  function holderProbeBody(THREE_, opts) {
    var gaugeZ = opts.gaugeZ;
    var grp = new THREE.Group(); grp.name = 'holder';
    var bodyMat = mat(0xd7d2c4, 0.6, 0.2);   // ceramic/plastic probe housing
    var steelMat = mat(COL.holder, 0.5, 0.78);

    var housingR = 21, housingLen = 62;
    var flangeR = 31.75, flangeLen = 8;
    var taperR0 = flangeR * 0.86, taperR1 = 12.3, taperLen = 48;

    var stackSum = housingLen + flangeLen + taperLen;
    var maxStack = (opts.maxStack !== undefined) ? opts.maxStack : stackSum;
    var scale = Math.min(1, Math.max(0.12, maxStack / stackSum));
    housingLen *= scale; flangeLen *= scale; taperLen *= scale;

    var gripZ = gaugeZ - housingLen - flangeLen - taperLen;
    var z = gripZ;

    var housing = mesh(frustum(housingR, housingR, housingLen, 20), bodyMat);
    housing.position.z = z; housing.name = 'probe-housing'; grp.add(housing);
    var band = mesh(frustum(housingR + 0.6, housingR + 0.6, 6, 20), mat(0xff5347, 0.5, 0.1));
    band.position.z = z + housingLen * 0.5; grp.add(band);
    z += housingLen;

    var flange = mesh(frustum(flangeR, flangeR, flangeLen, 24), steelMat);
    flange.position.z = z; grp.add(flange); z += flangeLen;

    var taper = mesh(frustum(taperR1, taperR0, taperLen, 24), mat(COL.holderHi, 0.5, 0.75));
    taper.position.z = z; grp.add(taper); z += taperLen;

    var knob = mesh(frustum(6, 4, 14, 12), steelMat);
    knob.position.z = z; grp.add(knob);

    return { obj: grp, gripZ: gripZ };
  }

  // Offset boring-head body: a stepped cylinder with a radial slide/knob.
  function holderBoreHead(THREE_, opts) {
    var gaugeZ = opts.gaugeZ;
    var grp = new THREE.Group(); grp.name = 'holder';
    var bodyMat = mat(COL.holder, 0.5, 0.78);

    var headR = 30, headLen = 46;
    var flangeR = 31.75, flangeLen = 8;
    var taperR0 = flangeR * 0.86, taperR1 = 12.3, taperLen = 48;

    var stackSum = headLen + flangeLen + taperLen;
    var maxStack = (opts.maxStack !== undefined) ? opts.maxStack : stackSum;
    var scale = Math.min(1, Math.max(0.12, maxStack / stackSum));
    headLen *= scale; flangeLen *= scale; taperLen *= scale;

    var gripZ = gaugeZ - headLen - flangeLen - taperLen;
    var z = gripZ;

    var head = mesh(frustum(headR, headR, headLen, 24), bodyMat);
    head.position.z = z; head.name = 'bore-head-body'; grp.add(head);
    // graduated adjustment knob on the side
    var knobGeo = new THREE.CylinderGeometry(7, 7, 16, 16);
    knobGeo.rotateZ(Math.PI / 2);
    knobGeo.translate(headR + 6, 0, z + headLen * 0.55);
    var adjKnob = mesh(knobGeo, mat(COL.brass, 0.4, 0.6));
    grp.add(adjKnob);
    z += headLen;

    var flange = mesh(frustum(flangeR, flangeR, flangeLen, 24), bodyMat);
    flange.position.z = z; grp.add(flange); z += flangeLen;

    var taper = mesh(frustum(taperR1, taperR0, taperLen, 24), mat(COL.holderHi, 0.5, 0.75));
    taper.position.z = z; grp.add(taper); z += taperLen;

    var knob = mesh(frustum(6, 4, 14, 12), bodyMat);
    knob.position.z = z; grp.add(knob);

    return { obj: grp, gripZ: gripZ };
  }

  /* ---------------------------------------------------------------- cutters */

  function shankCutter(THREE_, r, l, gripZ, opts) {
    opts = opts || {};
    var grp = new THREE.Group(); grp.name = 'cutter';
    var cutMat = mat(opts.color || COL.carbide, opts.rough, opts.metal);
    var shankMat = mat(COL.hss, 0.35, 0.7);

    var fluteLen = opts.fluteLen || Math.min(l * 0.42, Math.max(r * 4.5, 14));
    var shankR = opts.shankR || r;
    var shankTop = gripZ;               // shank rises to where the holder grips it

    // flute body (solid cylinder) + helical groove tubes for the look
    var body = mesh(frustum(r, r, fluteLen, 18), cutMat);
    grp.add(body);
    addFlutes(THREE_, grp, r, 0, fluteLen, opts.flutes || 2, 0.05, shankMat);

    // shank from end of flutes up to the collet grip line
    if (shankTop > fluteLen) {
      var shank = mesh(frustum(shankR, shankR, shankTop - fluteLen, 16), shankMat);
      shank.position.z = fluteLen; grp.add(shank);
    }
    return { obj: grp, fluteLen: fluteLen };
  }

  function buildSpotDrill(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var tipMat = mat(COL.carbide);
    var pointLen = r / Math.tan(45 * Math.PI / 180); // 90 deg included -> half-angle 45
    var tip = mesh(tipCone(r, pointLen, 16), tipMat);
    grp.add(tip);
    var bodyLen = Math.max(6, r * 2.5);
    var body = mesh(frustum(r, r, bodyLen, 16), tipMat);
    body.position.z = pointLen; grp.add(body);
    var shankTop = gripZ;
    var top = pointLen + bodyLen;
    if (shankTop > top) {
      var shank = mesh(frustum(r * 0.9, r * 0.9, shankTop - top, 14), mat(COL.hss, 0.35, 0.7));
      shank.position.z = top; grp.add(shank);
    }
    return grp;
  }

  function buildTwistDrill(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var body = mat(COL.hss, 0.4, 0.55);
    var pointLen = r / Math.tan(59 * Math.PI / 180); // 118 deg included -> half 59
    var tip = mesh(tipCone(r, pointLen, 18), body);
    grp.add(tip);
    var fluteLen = Math.min(tool.l * 0.55, Math.max(r * 7, 20));
    var shaft = mesh(frustum(r, r, fluteLen, 18), body);
    shaft.position.z = pointLen; grp.add(shaft);
    addFlutes(THREE, grp, r, pointLen, fluteLen, 2, 0.09, mat(0x7d828a, 0.5, 0.4));
    var necked = mesh(frustum(r * 0.86, r * 0.86, 4, 14), body);
    necked.position.z = pointLen + fluteLen; grp.add(necked);
    var shankTop = gripZ, top = pointLen + fluteLen + 4;
    if (shankTop > top) {
      var shank = mesh(frustum(r * 0.9, r * 0.9, shankTop - top, 14), mat(COL.hss, 0.3, 0.7));
      shank.position.z = top; grp.add(shank);
    }
    return grp;
  }

  function buildTap(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var tapMat = mat(COL.blackox, 0.55, 0.4);
    var chamferLen = Math.max(2.5, r * 0.9);
    var chamfer = mesh(tipCone(r * 0.55, chamferLen, 14), tapMat);
    chamfer.geometry.dispose(); chamfer.geometry = frustum(r * 0.55, r, chamferLen, 14);
    grp.add(chamfer);
    var threadLen = Math.min(tool.l * 0.5, Math.max(r * 4, 18));
    var body = mesh(frustum(r, r, threadLen, 16), tapMat);
    body.position.z = chamferLen; grp.add(body);
    // thread ridges: shallow torus rings
    var turns = Math.max(6, Math.round(threadLen / (r * 0.35)));
    for (var i = 0; i < turns; i++) {
      var tz = chamferLen + (i + 0.5) * (threadLen / turns);
      var ring = mesh(new THREE.TorusGeometry(r * 1.02, r * 0.06, 5, 14), tapMat);
      ring.position.z = tz; grp.add(ring);
    }
    var top = chamferLen + threadLen, shankTop = gripZ;
    if (shankTop > top) {
      var shank = mesh(frustum(r * 0.82, r * 0.82, shankTop - top, 12), mat(COL.steel, 0.4, 0.6));
      shank.position.z = top; grp.add(shank);
      // square drive at very top
      var sq = new THREE.BoxGeometry(r * 1.0, r * 1.0, Math.min(6, shankTop - top));
      sq.translate(0, 0, shankTop - Math.min(6, shankTop - top) / 2);
      grp.add(mesh(sq, mat(COL.steel, 0.4, 0.6)));
    }
    return grp;
  }

  function buildEndmill(tool, gripZ, flutes) {
    var r = tool.r;
    var res = shankCutter(THREE, r, tool.l, gripZ, {
      color: COL.tin, flutes: flutes || (r > 4 ? 4 : 2), fluteLen: Math.min(tool.l * 0.4, Math.max(r * 3.2, 10))
    });
    return res.obj;
  }

  function buildFacemill(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var bodyMat = mat(COL.steel, 0.45, 0.75);
    var discLen = Math.max(18, r * 0.5);
    var body = mesh(frustum(r * 0.94, r, discLen, 32), bodyMat);
    grp.add(body);
    var nInserts = 6;
    var insMat = mat(COL.insert, 0.3, 0.3);
    for (var i = 0; i < nInserts; i++) {
      var a = (i / nInserts) * Math.PI * 2;
      var ins = new THREE.BoxGeometry(6, 8, 3);
      ins.translate(Math.cos(a) * r * 0.97, Math.sin(a) * r * 0.97, discLen * 0.5);
      var m = mesh(ins, insMat);
      m.rotation.z = a;
      grp.add(m);
    }
    var shankTop = gripZ, top = discLen;
    if (shankTop > top) {
      var hub = mesh(frustum(r * 0.28, r * 0.28, shankTop - top, 20), bodyMat);
      hub.position.z = top; grp.add(hub);
    }
    return grp;
  }

  function buildBoreHead(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var bodyMat = mat(COL.steel, 0.45, 0.75);
    var bodyLen = Math.max(20, tool.l * 0.18);
    var body = mesh(frustum(9, 9, bodyLen, 18), bodyMat);
    grp.add(body);
    // single radial insert holder arm reaching out to r
    var arm = new THREE.BoxGeometry(r * 1.9, 7, 7);
    arm.translate(r * 0.5, 0, bodyLen * 0.75);
    grp.add(mesh(arm, bodyMat));
    var insert = new THREE.BoxGeometry(6, 6, 3);
    insert.translate(r * 0.98, 0, bodyLen * 0.75 - 3);
    grp.add(mesh(insert, mat(COL.insert, 0.3, 0.3)));
    var shankTop = gripZ, top = bodyLen;
    if (shankTop > top) {
      var shank = mesh(frustum(9, 9, shankTop - top, 16), bodyMat);
      shank.position.z = top; grp.add(shank);
    }
    return grp;
  }

  function buildChamfer(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var cutMat = mat(COL.carbide);
    var coneLen = r; // 90deg included, half-angle 45
    var cone = mesh(tipCone(r, coneLen, 18), cutMat);
    grp.add(cone);
    addFlutes(THREE, grp, r * 0.7, coneLen * 0.15, coneLen * 0.8, 4, 0.25, mat(0x7d828a, 0.5, 0.4));
    var neckLen = Math.max(4, r);
    var neck = mesh(frustum(r * 0.35, r * 0.35, neckLen, 14), mat(COL.hss, 0.35, 0.7));
    neck.position.z = coneLen; grp.add(neck);
    var top = coneLen + neckLen, shankTop = gripZ;
    if (shankTop > top) {
      var shank = mesh(frustum(r * 0.5, r * 0.5, shankTop - top, 14), mat(COL.hss, 0.3, 0.7));
      shank.position.z = top; grp.add(shank);
    }
    return grp;
  }

  function buildReamer(tool, gripZ) {
    var r = tool.r;
    var res = shankCutter(THREE, r, tool.l, gripZ, {
      color: COL.hss, rough: 0.3, metal: 0.6, flutes: 6,
      fluteLen: Math.min(tool.l * 0.45, Math.max(r * 5, 16))
    });
    // slight lead chamfer at the very tip
    var chLen = Math.max(1.5, r * 0.35);
    var ch = mesh(tipCone(r, chLen, 16), mat(COL.hss, 0.3, 0.6));
    ch.geometry.dispose(); ch.geometry = frustum(r * 0.8, r, chLen, 16);
    res.obj.add(ch);
    return res.obj;
  }

  function buildProbe(tool, gripZ) {
    var r = tool.r, grp = new THREE.Group(); grp.name = 'cutter';
    var stemMat = mat(0xb9bec4, 0.4, 0.7);
    var ballMat = new THREE.MeshStandardMaterial({ color: COL.ruby, roughness: 0.15, metalness: 0.1 });
    var ball = mesh(new THREE.SphereGeometry(r, 20, 16), ballMat);
    ball.position.z = r; ball.name = 'stylus-ball'; grp.add(ball);
    var stemLen = Math.max(20, tool.l * 0.35);
    var stem = mesh(frustum(1.6, 2.4, stemLen, 12), stemMat);
    stem.position.z = r; grp.add(stem);
    var top = r + stemLen, shankTop = gripZ;
    if (shankTop > top) {
      var body = mesh(frustum(9, 9, shankTop - top, 16), mat(0xd7d2c4, 0.6, 0.15));
      body.position.z = top; grp.add(body);
    }
    return grp;
  }

  function buildFallback(tool, gripZ) {
    var r = tool.r || 4, grp = new THREE.Group(); grp.name = 'cutter';
    var m = mat(0xffb03a, 0.5, 0.5);
    var top = fluteLenFor(-1, r, tool.l || 60);
    var body = mesh(frustum(r, r, top, 14), m);
    grp.add(body);
    if (gripZ > top) {
      var shank = mesh(frustum(r * 0.8, r * 0.8, gripZ - top, 12), mat(COL.steel));
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
