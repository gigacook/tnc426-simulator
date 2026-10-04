#!/usr/bin/env python3
"""Bundle shell + libraries + modules into one standalone HTML.

  python3 build.py          -> index.html        (public, pushed; never contains a key)
                            -> index.local.html  (only if private/.env has OPENROUTER_API_KEY; gitignored)

A new module is one line in MODULES. Missing optional files are skipped, never fatal.
"""
import pathlib, urllib.request, json, re, sys
d = pathlib.Path(__file__).parent
cache = d / '.libcache'; cache.mkdir(exist_ok=True)
src = d / 'sim'          # simulator sources (the single-file build's modules + shell)
T_VER = '0.186.1'   # three.js; bundled with its addons and three.quarks by esbuild (vendor/three-entry.mjs)

def vendor():
    """three + addons + three.quarks as one classic script (window.THREE, window.QUARKS)."""
    out = cache / f'three-vendor-{T_VER}.js'
    if not out.exists():
        import subprocess
        esb = d / '.tools' / 'node_modules' / '.bin' / ('esbuild.cmd' if sys.platform == 'win32' else 'esbuild')
        if not esb.exists():
            sys.exit('build: esbuild missing — run: (cd .tools && npm i three@%s three.quarks@0.17.1 esbuild@0.28.2)' % T_VER)
        subprocess.run([str(esb), str(src / 'vendor' / 'three-entry.mjs'), '--bundle', '--format=iife', '--minify',
                        '--legal-comments=none', '--log-level=warning', f'--outfile={out}'], check=True, cwd=d / '.tools',
                       env=dict(__import__('os').environ, NODE_PATH=str(d / '.tools' / 'node_modules')))
    return out.read_text(encoding='utf-8')

# (cache file, url, label) — fetched once into .libcache/
LIBS = [
    ('jszip.js',          'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'JSZip 3.10.1 — MIT, Stuart Knightley'),
    ('idb-keyval.js',     'https://cdn.jsdelivr.net/npm/idb-keyval@6.2.2/dist/umd.js',   'idb-keyval 6.2.2 — Apache-2.0, Jake Archibald'),
]

# (file, label) — project modules, in load order. ui.js must stay last.
MODULES = [
    ('core.js',      'TNC Klartext interpreter'),
    ('machines.js',  'Machine parameters (shared with the server engine)'),
    ('stock.js',     'Material model: height field, tilted tool, vice'),
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
    ('bridge.js',    'Bridge to the TNC server and web app (inactive without a server)'),
    ('viz.js',       'View aids: axis vectors, click to pick'),
    ('dialogs.js',   'Programming dialogs: path functions, CYCL DEF, TOOL CALL'),
    ('i18n.js',      'i18n: language strings (en/sv)'),
    ('ui.js',        'Simulator UI'),
]

# text files exposed as window globals for the DEV modal
TEXTS = [('docs/FEATURES.txt', 'TNC_DEVLOG'), ('docs/HISTORY.txt', 'TNC_HISTORY'),
         ('docs/RELEASES.txt', 'TNC_RELEASES'), ('docs/ROADMAP.txt', 'TNC_ROADMAP')]

def lib(name, url):
    f = cache / name
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(url).read())
    return f.read_text(encoding='utf-8')

def tag(label, src):
    if '</script' in src.lower():
        sys.exit(f'build: "{label}" contains </script — would break the page')
    return f'<script>/* ===== {label} ===== */\n{src}\n</script>\n'

def env_key():
    # private/.env (gitignored folder) first, then a root .env
    for f in (d / 'private' / '.env', d / '.env'):
        if not f.exists(): continue
        for line in f.read_text(encoding='utf-8').splitlines():
            m = re.match(r'\s*OPENROUTER_API_KEY\s*=\s*["\']?([^"\'\s#]+)', line)
            if m: return m.group(1)
    return None

shell = (src / 'sim-shell.html').read_text(encoding='utf-8')
split = '<div class="app">'
head, body = shell.split(split, 1)
body = split + body

scripts = tag('three.js r186 + addons (MIT, three.js authors) + three.quarks (MIT, Alchemist0823)', vendor())
scripts += ''.join(tag(label, lib(n, u)) for n, u, label in LIBS)
for name, var in TEXTS:
    f = d / name
    if f.exists():
        scripts += tag('text: ' + name, f'window.{var} = {json.dumps(f.read_text(encoding="utf-8"))};')
included = []
for name, label in MODULES:
    f = src / name
    if f.exists():
        scripts += tag(label, f.read_text(encoding='utf-8')); included.append(name)

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
(d / 'index.html').write_text(doc, encoding='utf-8', newline='\n')
print(f'built index.html  {len(doc):,} bytes  modules: {" ".join(included)}')

if key:
    local = page(tag('local-only key from .env — never commit this file',
                     f'window.TNC_AI_LOCAL_KEY = {json.dumps(key)};'))
    (d / 'index.local.html').write_text(local, encoding='utf-8', newline='\n')
    print(f'built index.local.html  {len(local):,} bytes  (with .env key — gitignored)')
