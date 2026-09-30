/* ============================================================
   TNC_VIZ — understanding aids in the 3-D view (plugin on the TNC_UI bus)
   1. Axis vectors: X (red), Y (green), Z (blue) legs from the program zero to the
      tool tip, each labelled with its value; A / B as arcs at the tool (TNC 430).
   2. Pick: a click (not a drag) in the view drops a green light and glow on the
      surface and shows that point's program coordinates. Click again = move it,
      Esc or a click on the marker's spot again = remove.
   TNC_VIZ.set({vectors:bool, pick:bool})
   ============================================================ */
var TNC_VIZ = (function () {
  'use strict';
  var api = { set: function () {} };
  if (typeof window === 'undefined') return api;
  (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push(function (ui) {
    var THREE = ui.THREE, camera = ui.camera, renderer = ui.renderer, host = document.getElementById('gfx');
    var opts = { vectors: true, pick: true };
    try { var sv = JSON.parse(localStorage.getItem('tnc.viz') || 'null'); if (sv) { opts.vectors = sv.vectors !== false; opts.pick = sv.pick !== false; } } catch (e) {}
    var root = null, stock = null;
    var css = document.createElement('style');
    css.textContent = '.vlab{position:absolute;pointer-events:none;font-family:var(--mono,monospace);font-size:13px;font-weight:600;padding:1px 6px;border-radius:3px;background:rgba(4,8,14,.78);white-space:nowrap;transform:translate(-50%,-120%);z-index:4}' +
      '.vlab.x{color:#ff8a7e;border:1px solid #ff6b5e}.vlab.y{color:#8fe28f;border:1px solid #6fcf6f}.vlab.z{color:#8fb8ff;border:1px solid #6fa8ff}.vlab.r{color:#ffd27a;border:1px solid #ffb03a}' +
      '.vlab.pick{color:#b8ffcf;border:1px solid #3dff8a;box-shadow:0 0 12px 3px rgba(61,255,138,.55),inset 0 0 6px rgba(61,255,138,.35);font-size:14px;text-shadow:0 0 6px #3dff8a}';
    document.head.appendChild(css);

    function lab(cls) { var d = document.createElement('div'); d.className = 'vlab ' + cls; d.hidden = true; host.appendChild(d); return d; }
    function seg(color, dashed) {
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      var m = dashed ? new THREE.LineDashedMaterial({ color: color, dashSize: 3, gapSize: 2, depthTest: false, transparent: true, opacity: .75 })
                     : new THREE.LineBasicMaterial({ color: color, depthTest: false, transparent: true, opacity: .95 });
      var l = new THREE.Line(g, m); l.renderOrder = 9; l.frustumCulled = false; return l;
    }
    function setSeg(l, a, b) { var p = l.geometry.attributes.position.array; p[0] = a.x; p[1] = a.y; p[2] = a.z; p[3] = b.x; p[4] = b.y; p[5] = b.z;
      l.geometry.attributes.position.needsUpdate = true; if (l.computeLineDistances) l.computeLineDistances(); }
    function arc(color, n) { var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 3), 3));
      var l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: color, depthTest: false, transparent: true, opacity: .95 })); l.renderOrder = 9; l.frustumCulled = false; return l; }

    var vg = new THREE.Group(), lx = seg(0xff6b5e), ly = seg(0x7ddc7d), lz = seg(0x6fa8ff), lr = seg(0xffffff, true), aA = arc(0xffb03a, 32), aB = arc(0xffd27a, 32);
    [lx, ly, lz, lr, aA, aB].forEach(function (o) { vg.add(o); });
    var LX = lab('x'), LY = lab('y'), LZ = lab('z'), LA = lab('r'), LB = lab('r');

    /* pick marker: glow sprite + green point light + label */
    var glowTex = (function () { var c = document.createElement('canvas'); c.width = c.height = 64; var x = c.getContext('2d');
      var g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(210,255,225,1)'); g.addColorStop(.3, 'rgba(61,255,138,.85)'); g.addColorStop(1, 'rgba(61,255,138,0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
    var mk = new THREE.Group(), spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, depthTest: false, transparent: true, blending: THREE.AdditiveBlending }));
    spr.scale.set(12, 12, 1); spr.renderOrder = 10; mk.add(spr);
    var dot = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0x3dff8a, depthTest: false })); dot.renderOrder = 10; mk.add(dot);
    var gl = new THREE.PointLight(0x3dff8a, 0, 90, 0); mk.add(gl); mk.visible = false;
    var LP = lab('pick'), pick = null;

    ui.on('scene', function (e) {
      root = e.partRoot; stock = e.stock; if (!root) return;
      root.add(vg); root.add(mk); mk.visible = false; pick = null; LP.hidden = true;
    });

    function toScreen(p, el) {
      var v = root ? root.localToWorld(new THREE.Vector3(p.x, p.y, p.z)) : new THREE.Vector3(p.x, p.y, p.z);
      v.project(camera); var w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
      if (v.z > 1 || v.z < -1) { el.hidden = true; return; }
      el.hidden = false; el.style.left = ((v.x + 1) / 2 * w) + 'px'; el.style.top = ((1 - v.y) / 2 * h) + 'px';
    }
    var f3 = function (v) { return (v >= 0 ? '+' : '') + v.toFixed(3); };
    function arcPts(l, c, r, axis, deg) {
      var p = l.geometry.attributes.position.array, n = p.length / 3 - 1;
      for (var i = 0; i <= n; i++) { var t = deg * Math.PI / 180 * i / n;
        // A: about X, the tip swings from -Z toward +Y; B: about Y, the tip swings from -Z toward +X
        var q = axis === 'A' ? { x: c.x, y: c.y + r * Math.sin(t), z: c.z - r * Math.cos(t) } : { x: c.x + r * Math.sin(t), y: c.y, z: c.z - r * Math.cos(t) };
        p[i * 3] = q.x; p[i * 3 + 1] = q.y; p[i * 3 + 2] = q.z; }
      l.geometry.attributes.position.needsUpdate = true;
    }

    ui.on('tick', function () {
      var S = ui.state, p = S.pos, show = opts.vectors && root && p && !document.body.classList.contains('focus-novec');
      vg.visible = !!show; [LX, LY, LZ, LA, LB].forEach(function (l) { if (!show) l.hidden = true; });
      if (show) {
        var o = { x: 0, y: 0, z: 0 }, px = { x: p.x, y: 0, z: 0 }, pxy = { x: p.x, y: p.y, z: 0 };
        setSeg(lx, o, px); setSeg(ly, px, pxy); setSeg(lz, pxy, p); setSeg(lr, o, p);
        LX.textContent = 'X ' + f3(p.x); LY.textContent = 'Y ' + f3(p.y); LZ.textContent = 'Z ' + f3(p.z);
        toScreen({ x: p.x / 2, y: 0, z: 0 }, LX); toScreen({ x: p.x, y: p.y / 2, z: 0 }, LY); toScreen({ x: p.x, y: p.y, z: p.z / 2 }, LZ);
        var s = S.seg, A = null, B = null;
        if (s && s.a && s.a.a != null) { var u = Math.max(0, Math.min(1, (S.t - s.t0) / Math.max(1e-9, s.t1 - s.t0)));
          A = s.a.a + ((s.b.a || 0) - s.a.a) * u; B = s.a.b + ((s.b.b || 0) - s.a.b) * u; }
        aA.visible = aB.visible = A !== null;
        if (A !== null) {
          arcPts(aA, p, 26, 'A', A); arcPts(aB, p, 34, 'B', B);
          LA.textContent = 'A ' + A.toFixed(2) + '°'; LB.textContent = 'B ' + B.toFixed(2) + '°';
          toScreen({ x: p.x, y: p.y + 26 * Math.sin(A * Math.PI / 360), z: p.z - 26 * Math.cos(A * Math.PI / 360) }, LA);
          toScreen({ x: p.x + 34 * Math.sin(B * Math.PI / 360), y: p.y, z: p.z - 34 * Math.cos(B * Math.PI / 360) }, LB);
        } else { LA.hidden = LB.hidden = true; }
      }
      if (pick && mk.visible) {
        toScreen({ x: pick.x, y: pick.y, z: pick.z + 3 }, LP);
        var k = 0.55 + 0.45 * Math.sin(performance.now() / 220); spr.material.opacity = 0.6 + 0.4 * k; gl.intensity = (3 + 3 * k) * Math.PI;
      }
    });

    /* click (not drag) = pick */
    var down = null, rc = new THREE.Raycaster();
    renderer.domElement.addEventListener('pointerdown', function (e) { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', function (e) {
      if (!down || !opts.pick || !root) { down = null; return; }
      var moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null; if (moved > 4) return;
      var r = renderer.domElement.getBoundingClientRect();
      rc.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
      var hits = rc.intersectObjects(root.children, true).filter(function (h) {
        var o = h.object; while (o) { if (o === vg || o === mk) return false; o = o.parent; } return h.object.isMesh; });
      var wp = hits.length ? hits[0].point : null;
      if (!wp && stock) { var pl = new THREE.Plane(new THREE.Vector3(0, 0, 1), -stock.z1), q = new THREE.Vector3(); if (rc.ray.intersectPlane(pl, q)) wp = q; }
      if (!wp) return;
      var lp = root.worldToLocal(wp.clone());
      if (pick && Math.hypot(lp.x - pick.x, lp.y - pick.y, lp.z - pick.z) < 2) { clearPick(); return; }
      pick = { x: lp.x, y: lp.y, z: lp.z }; mk.position.set(lp.x, lp.y, lp.z); mk.visible = true;
      LP.textContent = 'X ' + f3(lp.x) + '   Y ' + f3(lp.y) + '   Z ' + f3(lp.z); LP.hidden = false;
      if (ui.say) ui.say('POINT X' + f3(lp.x) + ' Y' + f3(lp.y) + ' Z' + f3(lp.z));
    });
    function clearPick() { pick = null; mk.visible = false; LP.hidden = true; gl.intensity = 0; }
    addEventListener('keydown', function (e) { if (e.key === 'Escape' && pick) clearPick(); });

    /* toggles in the Effects & view menu */
    function btn(id, label, key) {
      var anchor = document.getElementById('b-sound'); if (!anchor) return;
      var b = document.createElement('button'); b.className = 'tb fx'; b.id = id; b.textContent = label; b.dataset.on = opts[key] ? '1' : '0';
      b.onclick = function () { opts[key] = !opts[key]; b.dataset.on = opts[key] ? '1' : '0'; if (key === 'pick' && !opts.pick) clearPick(); save(); if (ui.say) ui.say(label.toUpperCase() + (opts[key] ? ' ON' : ' OFF')); };
      anchor.parentNode.insertBefore(b, anchor.nextSibling);
    }
    function save() { try { localStorage.setItem('tnc.viz', JSON.stringify(opts)); } catch (e) {} }
    btn('b-pick', 'Click to pick', 'pick'); btn('b-vec', 'Axis vectors', 'vectors');
    api.set = function (o) { for (var k in o) opts[k] = !!o[k]; if (!opts.pick) clearPick(); save(); };
  });
  return api;
})();
if (typeof module !== 'undefined') module.exports = TNC_VIZ;
