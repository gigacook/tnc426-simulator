/* Vendor bundle: three.js + the addons the simulator uses + three.quarks, exposed as the
   classic globals window.THREE and window.QUARKS so every module stays a plain script.
   Built by build.py with esbuild (root node_modules, `npm ci`) into .libcache/three-vendor-<ver>.js. */
import * as T from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { CopyShader } from 'three/examples/jsm/shaders/CopyShader.js';
import * as QUARKS from 'three.quarks';

const THREE = Object.assign({}, T, { OrbitControls, RoomEnvironment, EffectComposer, RenderPass, ShaderPass, OutputPass, FXAAShader, CopyShader });
/* r128 behaviour for colours: hex and vertex colours are used as given, not converted from sRGB.
   Keeps the existing look; modules may opt in to colour management later. */
THREE.ColorManagement.enabled = false;
window.THREE = THREE;
window.QUARKS = QUARKS;
