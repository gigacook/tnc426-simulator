/* ==========================================================================
 * TNC 426 simulator -- callouts.js
 * Thin leader-line callouts with labels that face the camera, stay a
 * constant on-screen size, and always render on top of the 3-D scene.
 *
 * DESIGN CHOICE: labels + leader lines are an HTML/SVG overlay positioned
 * over the renderer's canvas (not THREE.Sprite canvas textures), because:
 *   - crispness: real DOM text is crisp at any devicePixelRatio for free;
 *     a sprite needs a texture re-rasterised per DPR/zoom to stay sharp.
 *   - "render on top" / "never hides behind geometry": trivial with a
 *     DOM layer above the <canvas> (z-index), no depthTest tricks needed.
 *   - "constant on-screen size": trivial -- CSS pixels don't shrink when
 *     the 3-D camera zooms out; a Sprite needs per-frame scale-by-distance
 *     bookkeeping to fake the same thing.
 *   - performance: a handful of DOM nodes updated per frame (left/top only,
 *     no layout thrash) is cheaper than re-rendering canvas textures.
 * The only 3-D math done here is projecting each anchor point to screen
 * space every update() -- everything else is ordinary DOM/SVG.
 *
 * Plain browser JS (ES5-ish), classic global THREE (r128), no modules.
 * Exposes a single global: TNC_CALLOUTS  { create }
 * ========================================================================== */

var TNC_CALLOUTS = (function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  function create(THREE, scene, camera, renderer) {
    var canvas = renderer.domElement;
    var host = canvas.parentElement || (canvas.ownerDocument && canvas.ownerDocument.body);
    if (host && getComputedStyle(host).position === 'static') host.style.position = 'relative';

    var wrap = document.createElement('div');
    wrap.className = 'tnc-callouts';
    wrap.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
      'overflow:visible;pointer-events:none;z-index:40;';
    if (host) host.appendChild(wrap);

    var svg = document.createElementNS(SVGNS, 'svg');
    svg.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;';
    wrap.appendChild(svg);

    var items = {};       // id -> item
    var order = [];       // insertion order, for stable z-stacking
    var w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    var globalVisible = true;
    var v3 = new THREE.Vector3();

    function labelStyle(color) {
      return 'position:absolute;left:0;top:0;transform:translate(-99999px,-99999px);' +
        'max-width:220px;background:rgba(22,29,41,0.92);border-left:3px solid ' + color + ';' +
        'color:#f2f6fb;font:600 11px/1.35 "IBM Plex Sans",-apple-system,sans-serif;' +
        'letter-spacing:.02em;padding:3px 8px;border-radius:2px;white-space:nowrap;' +
        'box-shadow:0 1px 6px rgba(0,0,0,.55);pointer-events:none;will-change:transform;';
    }

    function add(id, object3D, text, opts) {
      opts = opts || {};
      remove(id);
      var color = opts.color || '#6fdcff';

      var dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('r', '2.5');
      dot.setAttribute('fill', color);
      svg.appendChild(dot);

      var line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('stroke', color);
      line.setAttribute('stroke-width', '1');
      line.setAttribute('opacity', '0.9');
      svg.appendChild(line);

      var label = document.createElement('div');
      label.style.cssText = labelStyle(color);
      label.textContent = text;
      wrap.appendChild(label);

      var it = {
        id: id, obj: object3D, text: text, color: color,
        anchor: opts.anchor || [0, 0, 0],
        offset: opts.offset || [26, -20],
        visible: true,
        dot: dot, line: line, label: label
      };
      items[id] = it;
      order.push(id);
      return it;
    }

    function set(id, o) {
      var it = items[id]; if (!it) return;
      o = o || {};
      if (o.text !== undefined) { it.text = o.text; it.label.textContent = o.text; }
      if (o.visible !== undefined) it.visible = o.visible;
      if (o.color !== undefined) {
        it.color = o.color;
        it.dot.setAttribute('fill', o.color);
        it.line.setAttribute('stroke', o.color);
        it.label.style.borderLeftColor = o.color;
      }
    }

    function remove(id) {
      var it = items[id]; if (!it) return;
      it.dot.parentNode && it.dot.parentNode.removeChild(it.dot);
      it.line.parentNode && it.line.parentNode.removeChild(it.line);
      it.label.parentNode && it.label.parentNode.removeChild(it.label);
      delete items[id];
      var idx = order.indexOf(id); if (idx >= 0) order.splice(idx, 1);
    }

    function setVisible(b) {
      globalVisible = !!b;
      wrap.style.display = globalVisible ? '' : 'none';
    }

    function resize(ww, hh) {
      w = ww || w; h = hh || h;
    }

    function hideEl(it) {
      it.dot.setAttribute('opacity', '0');
      it.line.setAttribute('opacity', '0');
      it.label.style.transform = 'translate(-99999px,-99999px)';
    }

    function update() {
      if (!globalVisible) return;
      // Keep w/h in sync with the actual canvas box in case resize() wasn't called.
      var cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (cw) w = cw; if (ch) h = ch;

      for (var i = 0; i < order.length; i++) {
        var it = items[order[i]];
        if (!it || !it.visible) { if (it) hideEl(it); continue; }
        var obj = it.obj;
        if (!obj || !obj.parent && obj.parent !== scene) {
          // object may have been detached; still try -- matrixWorld may be stale but harmless
        }
        obj.updateMatrixWorld(true);
        v3.set(it.anchor[0], it.anchor[1], it.anchor[2]);
        v3.applyMatrix4(obj.matrixWorld);
        v3.project(camera);

        if (v3.z > 1 || v3.z < -1) { hideEl(it); continue; }   // behind / outside frustum

        var ax = (v3.x * 0.5 + 0.5) * w;
        var ay = (-v3.y * 0.5 + 0.5) * h;
        var lx = ax + it.offset[0];
        var ly = ay + it.offset[1];

        // Measure label to anchor the leader line on its near edge, never
        // crossing the text: line lands on the left or right edge of the
        // box (whichever faces the anchor), vertically centred on the box.
        var lw = it.label.offsetWidth || 0, lh = it.label.offsetHeight || 0;
        var boxLeft = lx, boxTop = ly - lh / 2;
        if (it.offset[0] < 0) boxLeft = lx - lw;
        var edgeX = (it.offset[0] >= 0) ? boxLeft : boxLeft + lw;
        var edgeY = boxTop + lh / 2;

        it.label.style.transform = 'translate(' + Math.round(boxLeft) + 'px,' + Math.round(boxTop) + 'px)';
        it.dot.setAttribute('cx', ax); it.dot.setAttribute('cy', ay);
        it.dot.setAttribute('opacity', '1');
        it.line.setAttribute('x1', ax); it.line.setAttribute('y1', ay);
        it.line.setAttribute('x2', edgeX); it.line.setAttribute('y2', edgeY);
        it.line.setAttribute('opacity', '0.9');
      }
    }

    function dispose() {
      for (var i = order.length - 1; i >= 0; i--) remove(order[i]);
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    }

    return {
      add: add, set: set, remove: remove,
      setVisible: setVisible, update: update, resize: resize, dispose: dispose
    };
  }

  return { create: create };
})();

if (typeof module !== 'undefined') module.exports = TNC_CALLOUTS;
