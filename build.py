#!/usr/bin/env python3
"""Bundle shell + three.js + core.js + ui.js into one standalone HTML."""
import pathlib, urllib.request, sys
d = pathlib.Path(__file__).parent
cache = d / '.libcache'; cache.mkdir(exist_ok=True)

def lib(name, url):
    f = cache / name
    if not f.exists():
        f.write_bytes(urllib.request.urlopen(url).read())
    return f.read_text()

three = lib('three.js',  'https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js')
orbit = lib('orbit.js',  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js')
core  = (d / 'core.js').read_text()
sim   = (d / 'sim.js').read_text()
pgms  = (d / 'programs.js').read_text()
import json
devf  = d / 'devlog.txt'
devlog = 'window.TNC_DEVLOG = ' + json.dumps(devf.read_text() if devf.exists() else 'devlog.txt not written yet.') + ';'
ui    = (d / 'ui.js').read_text()
shell = (d / 'sim-shell.html').read_text()

split = '<div class="app">'
head, body = shell.split(split, 1)
body = split + body

def tag(label, src):
    return f'<script>/* ===== {label} ===== */\n{src}\n</script>\n'

doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="TNC 426 Simulator — HEIDENHAIN Klartext CNC simulator with live material removal.">
{head}<style>html{{color-scheme:dark}} img{{max-width:100%}} [hidden]{{display:none!important}}</style>
</head>
<body>
{body}
{tag('three.js r128 — MIT, Three.js Authors', three)}{tag('OrbitControls — MIT, Three.js Authors', orbit)}{tag('TNC Klartext interpreter', core)}{tag('Simulation checks', sim)}{tag('Programs on the control', pgms)}{tag('Dev feature log', devlog)}{tag('Simulator UI', ui)}</body>
</html>
"""
out = d / 'index.html'
out.write_text(doc)
print(f'built {out}  {len(doc):,} bytes')
