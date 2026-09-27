/* ==========================================================================
 * TNC 426 simulator  --  materials.js
 * Alloy presets for the stock, as plain data. Swappable: this whole file can
 * be deleted (and its MODULES line in build.py) and the simulator falls back
 * to its built-in grey MeshStandardMaterial, unchanged.
 *
 * Plain browser JS, no modules, no DOM beyond one injected <select>.
 * Exposes one global: TNC_MATERIALS.
 * ========================================================================== */
var TNC_MATERIALS = (function () {
  'use strict';

  var LS_KEY = 'tnc426.material';

  /* alloy presets: color/metalness/roughness drive the PBR look; chipColor
   * and sparkColor are handed to fx.js so chips and sparks read as the
   * right metal instead of always aluminium-grey / steel-orange. */
  var PRESETS = [
    { id: 'aluminium',    label: 'Aluminium 6061',   color: 0xc7ccd2, metalness: 0.55, roughness: 0.42, chipColor: 0xd9dee3, sparkColor: 0xeaf2ff },
    { id: 'titanium',     label: 'Titanium Ti-6Al-4V', color: 0x82868c, metalness: 0.62, roughness: 0.46, chipColor: 0x9198a0, sparkColor: 0xfff2c8 },
    { id: 'steel',        label: 'Mild steel',       color: 0x8a8f96, metalness: 0.78, roughness: 0.38, chipColor: 0x8f959c, sparkColor: 0xffb060 },
    { id: 'stainless',    label: 'Stainless 304',    color: 0xc9ced4, metalness: 0.82, roughness: 0.26, chipColor: 0xd6dbe0, sparkColor: 0xffd8a0 },
    { id: 'brass',        label: 'Brass',            color: 0xcfa257, metalness: 0.85, roughness: 0.30, chipColor: 0xe3bd72, sparkColor: 0xffcf80 },
    { id: 'cast-iron',    label: 'Cast iron',        color: 0x4d4f53, metalness: 0.32, roughness: 0.82, chipColor: 0x5a5c60, sparkColor: 0xff9a4a },
    /* industry presets: same idea, tuned for a recognizable shop-floor look */
    { id: 'turbine',      label: 'Turbine · Inconel/Ti', color: 0x6c7570, metalness: 0.66, roughness: 0.44, chipColor: 0x7c847e, sparkColor: 0xfff0c0 },
    { id: 'aerospace',    label: 'Aerospace · 7075-T6', color: 0xc9ced3, metalness: 0.50, roughness: 0.40, chipColor: 0xdbe0e4, sparkColor: 0xeaf2ff },
    { id: 'ground',       label: 'Ground finish · fine steel', color: 0xaeb3b9, metalness: 0.82, roughness: 0.10, chipColor: 0xb8bcc1, sparkColor: 0xffc37a },
    { id: 'cast',         label: 'Cast · rough iron', color: 0x46484c, metalness: 0.22, roughness: 0.90, chipColor: 0x525459, sparkColor: 0xff9a4a }
  ];
  var DEFAULT_ID = 'aluminium';

  function byId(id) { for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i]; return null; }

  function loadSaved() {
    try { return localStorage.getItem(LS_KEY); } catch (e) { return null; }
  }
  function saveChoice(id) {
    try { localStorage.setItem(LS_KEY, id); } catch (e) {}
  }

  var api = { presets: PRESETS, byId: byId, current: byId(DEFAULT_ID) };

  function applyTo(mesh, preset) {
    if (!mesh || !mesh.material) return;
    var m = mesh.material;
    m.color.setHex(preset.color);
    if ('metalness' in m) m.metalness = preset.metalness;
    if ('roughness' in m) m.roughness = preset.roughness;
    // vertexColors stays on for gStock: the material color above multiplies
    // with the per-vertex cut-depth tint already painted by ui.js, rather
    // than replacing it.
  }

  function notifyFX(preset) {
    try {
      if (window.TNC_FX && TNC_FX.instance && typeof TNC_FX.instance.setMaterial === 'function') {
        TNC_FX.instance.setMaterial(preset);
      }
    } catch (e) {}
  }

  if (typeof window !== 'undefined') {
    (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push(function (ui) {
      var saved = loadSaved(), preset = byId(saved) || byId(DEFAULT_ID);
      api.current = preset;

      var latestScene = null;
      function applyAll() {
        if (!latestScene) return;
        applyTo(latestScene.gStock, preset);
        applyTo(latestScene.gSkirt, preset);
        applyTo(latestScene.gFloor, preset);
        notifyFX(preset);
      }

      ui.on('scene', function (ev) {
        latestScene = ev;
        applyAll();
      });

      api.select = function (id) {
        var p = byId(id); if (!p) return;
        preset = p; api.current = p; saveChoice(p.id);
        applyAll();
        ui.say('MATERIAL: ' + p.label.toUpperCase());
      };

      /* ---- small picker, next to the existing sound toggle ---- */
      try {
        var host = document.getElementById('b-sound');
        if (host && host.parentNode && !document.getElementById('mat-sel')) {
          var sel = document.createElement('select');
          sel.id = 'mat-sel';
          sel.className = 'tb fx';
          sel.title = 'Stock material';
          sel.setAttribute('aria-label', 'Stock material');
          sel.style.cssText = 'font:inherit;letter-spacing:.06em;padding:0 8px;min-width:0;appearance:auto;-webkit-appearance:menu;cursor:pointer;';
          PRESETS.forEach(function (p) {
            var o = document.createElement('option');
            o.value = p.id; o.textContent = p.label;
            if (p.id === preset.id) o.selected = true;
            sel.appendChild(o);
          });
          sel.addEventListener('change', function () { api.select(sel.value); });
          host.parentNode.insertBefore(sel, host.nextSibling);
        }
      } catch (e) {}
    });
  }

  return api;
})();
if (typeof module !== 'undefined') module.exports = TNC_MATERIALS;
