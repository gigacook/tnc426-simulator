/* ==========================================================================
 * TNC 426 simulator  --  look.js
 * Cheap visual polish: an environment map so the metal-look materials have
 * something to reflect, correct color pipeline (sRGB + ACES filmic), and a
 * single FXAA pass through the plugin bus's `ui.render` hook to soften the
 * height-field's diagonal stair-stepping. No new UI; nothing to toggle by
 * keyboard. Swappable: delete this file (and its MODULES line) and the
 * simulator renders exactly as it did before, just flatter.
 *
 * Plain browser JS, no modules. Exposes one global: TNC_LOOK.
 * ========================================================================== */
var TNC_LOOK = (function () {
  'use strict';

  var api = { set: function () {} };

  if (typeof window !== 'undefined') {
    (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push(function (ui) {
      var THREE = ui.THREE, renderer = ui.renderer, scene = ui.scene, camera = ui.camera;
      var opts = { fxaa: true };

      /* ---- color pipeline ---- */
      try {
        if ('outputColorSpace' in renderer) renderer.outputColorSpace = THREE.SRGBColorSpace;   // r152+
        else if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
        if (THREE.ACESFilmicToneMapping !== undefined) {
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.05;
        }
      } catch (e) {}

      /* ---- environment: a plain interior room, baked once with PMREM ---- */
      try {
        if (THREE.PMREMGenerator && THREE.RoomEnvironment) {
          var pmrem = new THREE.PMREMGenerator(renderer);
          pmrem.compileEquirectangularShader && pmrem.compileEquirectangularShader();
          var envRT = pmrem.fromScene(new THREE.RoomEnvironment(), 0.035);
          scene.environment = envRT.texture;
          pmrem.dispose();
        }
      } catch (e) { /* no PMREM support: materials just stay unlit-by-env, no crash */ }

      /* ---- FXAA, wired through the shared render hook ---- */
      var composer = null, fxaaPass = null;
      try {
        if (THREE.EffectComposer && THREE.RenderPass && THREE.ShaderPass && THREE.FXAAShader) {
          composer = new THREE.EffectComposer(renderer);
          composer.addPass(new THREE.RenderPass(scene, camera));
          if (THREE.OutputPass) composer.addPass(new THREE.OutputPass());   // tone mapping + sRGB before FXAA (r152+)
          fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
          fxaaPass.renderToScreen = true;
          composer.addPass(fxaaPass);
        }
      } catch (e) { composer = null; fxaaPass = null; }

      function applyRenderHook() {
        if (opts.fxaa && composer) {
          ui.render = function () { composer.render(); };
        } else {
          ui.render = null;               // falls back to renderer.render(scene,camera) in ui.js
        }
      }
      applyRenderHook();

      ui.on('resize', function (r) {
        if (!composer || !fxaaPass) return;
        var w = Math.max(1, r.w), h = Math.max(1, r.h), pr = renderer.getPixelRatio();
        try {
          composer.setPixelRatio(pr);
          composer.setSize(w, h);
          fxaaPass.material.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
        } catch (e) {}
      });

      api.set = function (o) {
        if (!o) return;
        if (typeof o.fxaa === 'boolean') opts.fxaa = o.fxaa;
        applyRenderHook();
      };
    });
  }

  return api;
})();
if (typeof module !== 'undefined') module.exports = TNC_LOOK;
