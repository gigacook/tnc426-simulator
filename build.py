#!/usr/bin/env python3
"""Bundle shell + libraries + modules into one standalone HTML.

  python3 build.py          -> index.html        (public, pushed; never contains a key)
                            -> index.local.html  (only if .env has OPENROUTER_API_KEY; gitignored)

A new module is one line in MODULES. Missing optional files are skipped, never fatal.
"""
import pathlib, urllib.request, json, re, sys
d = pathlib.Path(__file__).parent
cache = d / '.libcache'; cache.mkdir(exist_ok=True)
T128 = 'https://cdn.jsdelivr.net/npm/three@0.128.0/'

# (cache file, url, label) — fetched once into .libcache/
LIBS = [
    ('three.js',          T128 + 'build/three.min.js',                              'three.js r128 — MIT, three.js authors'),
    ('orbit.js',          T128 + 'examples/js/controls/OrbitControls.js',           'OrbitControls — MIT, three.js authors'),
    ('room-env.js',       T128 + 'examples/js/environments/RoomEnvironment.js',     'RoomEnvironment — MIT, three.js authors'),
    ('copy-shader.js',    T128 + 'examples/js/shaders/CopyShader.js',               'CopyShader — MIT, three.js authors'),
    ('fxaa-shader.js',    T128 + 'examples/js/shaders/FXAAShader.js',               'FXAAShader — MIT, three.js authors'),
    ('effect-composer.js',T128 + 'examples/js/postprocessing/EffectComposer.js',    'EffectComposer — MIT, three.js authors'),
    ('render-pass.js',    T128 + 'examples/js/postprocessing/RenderPass.js',        'RenderPass — MIT, three.js authors'),
    ('shader-pass.js',    T128 + 'examples/js/postprocessing/ShaderPass.js',        'ShaderPass — MIT, three.js authors'),
    ('jszip.js',          'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip 3.10.1 — MIT, Stuart Knightley'),
    ('idb-keyval.js',     'https://cdn.jsdelivr.net/npm/idb-keyval@6.2.2/dist/umd.js',   'idb-keyval 6.2.2 — Apache-2.0, Jake Archibald'),
]

# (file, label) — project modules, in load order. ui.js must stay last.
MODULES = [
    ('core.js',      'TNC Klartext interpreter'),
    ('sim.js',       'Simulation checks'),
    ('programs.js',  'Programs on the control'),
    ('lessons.js',   'Lessons, BREAK IT, manual'),
    ('tools3d.js',   'Tool geometry'),
    ('callouts.js',  'Callouts'),
    ('flow.js',      'Flow view'),
    ('fx.js',        'Effects'),
    ('materials.js', 'Materials'),
    ('look.js',      'Look: environment, antialiasing'),
    ('profile.js',   'User profile storage'),
    ('ai.js',        'AI program generation (OpenRouter)'),
    ('ui.js',        'Simulator UI'),
]

# text files exposed as window globals for the DEV modal
TEXTS = [('devlog.txt', 'TNC_DEVLOG'), ('history.txt', 'TNC_HISTORY'),
         ('RELEASES.txt', 'TNC_RELEASES'), ('ROADMAP.txt', 'TNC_ROADMAP')]

def lib(name, url):
    f = cache / name
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(url).read())
    return f.read_text()

def tag(label, src):
    if '</script' in src.lower():
        sys.exit(f'build: "{label}" contains </script — would break the page')
    return f'<script>/* ===== {label} ===== */\n{src}\n</script>\n'

def env_key():
    f = d / '.env'
    if not f.exists(): return None
    for line in f.read_text().splitlines():
        m = re.match(r'\s*OPENROUTER_API_KEY\s*=\s*["\']?([^"\'\s#]+)', line)
        if m: return m.group(1)
    return None

shell = (d / 'sim-shell.html').read_text()
split = '<div class="app">'
head, body = shell.split(split, 1)
body = split + body

scripts = ''.join(tag(label, lib(n, u)) for n, u, label in LIBS)
for name, var in TEXTS:
    f = d / name
    if f.exists():
        scripts += tag('text: ' + name, f'window.{var} = {json.dumps(f.read_text())};')
included = []
for name, label in MODULES:
    f = d / name
    if f.exists():
        scripts += tag(label, f.read_text()); included.append(name)

def page(extra=''):
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="TNC 426 Simulator — HEIDENHAIN Klartext CNC simulator with live material removal.">
{head}<style>html{{color-scheme:dark}} img{{max-width:100%}} [hidden]{{display:none!important}}</style>
</head>
<body>
{body}
{extra}{scripts}</body>
</html>
"""

doc = page()
key = env_key()
if key and key in doc:
    sys.exit('build: the OpenRouter key leaked into the public build — aborting')
(d / 'index.html').write_text(doc)
print(f'built index.html  {len(doc):,} bytes  modules: {" ".join(included)}')

if key:
    local = page(tag('local-only key from .env — never commit this file',
                     f'window.TNC_AI_LOCAL_KEY = {json.dumps(key)};'))
    (d / 'index.local.html').write_text(local)
    print(f'built index.local.html  {len(local):,} bytes  (with .env key — gitignored)')
