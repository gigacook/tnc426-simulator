/* ============================================================
   TNC_PROFILE — the operator's personal profile, one per browser.
   Pure storage + file formats, no DOM. Used by ui.js.

   Profile shape (v2):
   { v:2, name, created, updated,
     prefs:{…},                                     view / speed / toggles
     machines:{ '426':{ pgms:{NAME.H:text}, cur:'NAME.H', tools:[{t,name,l,r}] },
                '430':{ … } },                      pgms = only yours or changed built-ins
     projects:[{id,name,created,pgms:[{m,name}]}], active }

   Storage: IndexedDB (idb-keyval) first, localStorage as fallback.
   Files:   export .zip = profile.json + programs/<machine>/<NAME>.H + TOOL_<machine>.T
            import .zip / .json (a whole profile) or HEIDENHAIN TOOL.T (a tool table)
   ============================================================ */
var TNC_PROFILE = (function () {
  'use strict';
  var KEY = 'tnc.profile.v2', LEGACY = 'tnc426.v1';
  var idb = (typeof window !== 'undefined' && window.idbKeyval) || null;

  function blank(name) {
    var now = new Date().toISOString();
    return { v: 2, name: name || '', created: now, updated: now, prefs: {}, machines: {}, projects: [], active: null };
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  /* the pre-profile store (programs + projects in localStorage, v1) */
  function legacy() {
    var j = null; try { j = JSON.parse(lsGet(LEGACY) || 'null'); } catch (e) {}
    if (!j) return null;
    var p = blank('');
    Object.keys(j.pgms || {}).forEach(function (m) { p.machines[m] = { pgms: j.pgms[m] || {}, cur: (j.cur || {})[m] || null }; });
    p.projects = Array.isArray(j.projects) ? j.projects : [];
    p.active = j.active || null;
    return p;
  }

  function valid(p) {
    return p && typeof p === 'object' && p.v === 2 && typeof p.machines === 'object' && Array.isArray(p.projects);
  }

  function load() {
    var fromLs = function () { var p = null; try { p = JSON.parse(lsGet(KEY) || 'null'); } catch (e) {} return valid(p) ? p : null; };
    if (!idb) return Promise.resolve(fromLs());
    return idb.get(KEY).then(function (p) { return valid(p) ? p : fromLs(); }, function () { return fromLs(); });
  }

  var lastSaved = null;
  function save(p) {
    p.updated = new Date().toISOString();
    var json = JSON.stringify(p);
    var ls = function () { return lsSet(KEY, json) ? 'local' : false; };
    if (!idb) { var r = ls(); if (r) lastSaved = new Date(); return Promise.resolve(r); }
    return idb.set(KEY, JSON.parse(json)).then(function () { lastSaved = new Date(); lsSet(KEY, json); return 'idb'; },
      function () { var r2 = ls(); if (r2) lastSaved = new Date(); return r2; });
  }
  function wipe() {
    try { localStorage.removeItem(KEY); } catch (e) {}
    return idb ? idb.del(KEY).catch(function () {}) : Promise.resolve();
  }

  /* ---------- HEIDENHAIN tool table TOOL.T ----------
     BEGIN TOOL .T MM
     T    NAME             L          R          R2   DL  DR ...
     0    NULLWERKZEUG     +0         +0 ...
     [END]
     Columns are fixed-width; positions come from the header line.            */
  function parseToolT(text) {
    var lines = String(text).replace(/\r/g, '').split('\n'), hdr = -1;
    for (var i = 0; i < lines.length; i++) if (/^\s*T\s+NAME\b/.test(lines[i])) { hdr = i; break; }
    if (hdr < 0) return null;
    var h = lines[hdr], cols = {}, re = /\S+/g, m;
    while ((m = re.exec(h))) cols[m[0]] = m.index;
    var names = Object.keys(cols).sort(function (a, b) { return cols[a] - cols[b]; });
    var cell = function (line, key) {
      if (cols[key] === undefined) return '';
      var i = names.indexOf(key), end = i + 1 < names.length ? cols[names[i + 1]] : line.length;
      return line.slice(cols[key], end).trim();
    };
    var tools = [];
    for (i = hdr + 1; i < lines.length; i++) {
      var ln = lines[i]; if (/^\s*\[END\]/.test(ln) || !ln.trim()) continue;
      var t = parseInt(cell(ln, 'T'), 10); if (isNaN(t)) continue;
      var r = parseFloat(cell(ln, 'R')), l = parseFloat(cell(ln, 'L'));
      tools.push({ t: t, name: (cell(ln, 'NAME') || ('T' + t)).toUpperCase().slice(0, 16), l: isNaN(l) ? 0 : l, r: isNaN(r) ? 0 : r });
    }
    return tools;
  }
  function toolT(tools) {
    var pad = function (s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + new Array(n - s.length + 1).join(' '); };
    var num = function (v) { return (v < 0 ? '-' : '+') + Math.abs(v).toFixed(3); };
    var out = ['BEGIN TOOL .T MM', pad('T', 5) + pad('NAME', 17) + pad('L', 11) + pad('R', 11)];
    tools.slice().sort(function (a, b) { return a.t - b.t; }).forEach(function (x) {
      out.push(pad(x.t, 5) + pad(x.name, 17) + pad(num(x.l), 11) + pad(num(x.r), 11));
    });
    out.push('[END]');
    return out.join('\r\n') + '\r\n';
  }

  /* ---------- export / import ---------- */
  function slug(s) { return String(s || 'profile').replace(/[^\w.-]+/g, '_').slice(0, 40) || 'profile'; }

  // listing(machineId, text) -> numbered TNC listing (the UI owns the interpreter)
  function exportZip(p, listing) {
    if (typeof JSZip === 'undefined') return Promise.reject(new Error('ZIP LIBRARY MISSING FROM THIS BUILD'));
    var z = new JSZip(), n = 0;
    z.file('profile.json', JSON.stringify(p, null, 1));
    Object.keys(p.machines).forEach(function (m) {
      var mm = p.machines[m];
      Object.keys(mm.pgms || {}).forEach(function (name) { z.file('programs/TNC' + m + '/' + name, listing ? listing(m, mm.pgms[name]) : mm.pgms[name]); n++; });
      if (mm.tools && mm.tools.length) z.file('TOOL_TNC' + m + '.T', toolT(mm.tools));
    });
    z.file('README.txt', ['Profile: ' + (p.name || '(unnamed)'), 'Exported ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
      n + ' program(s). Import this .zip on any browser: profile button -> Import.', '',
      'programs/ holds each program as a numbered TNC listing (.H, CRLF).',
      'TOOL_*.T are HEIDENHAIN tool tables. profile.json is the whole profile.', '',
      '(c) 2026 TNC 426 Simulator contributors'].join('\r\n'));
    return z.generateAsync({ type: 'blob' }).then(function (b) { return { blob: b, name: 'TNC_PROFILE_' + slug(p.name) + '.zip', count: n }; });
  }

  /* bytes -> text: UTF-8 when valid, else Windows-1252 (TNC files from real controls) */
  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
    catch (e) { try { return new TextDecoder('windows-1252').decode(buf); } catch (e2) { return String.fromCharCode.apply(null, new Uint8Array(buf)); } }
  }
  function readBuf(file) {
    if (file.arrayBuffer) return file.arrayBuffer();
    return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(file); });
  }

  /* Classify an uploaded file. Resolves to one of:
     {kind:'profile', profile}  {kind:'programs', files:[{name,text,machine}]}  {kind:'tools', tools, name}  {kind:'unknown'} */
  function readFile(file) {
    var nm = file.name || '';
    return readBuf(file).then(function (buf) {
      if (/\.zip$/i.test(nm)) {
        if (typeof JSZip === 'undefined') throw new Error('ZIP LIBRARY MISSING FROM THIS BUILD');
        return JSZip.loadAsync(buf).then(function (z) {
          var pj = z.file('profile.json');
          if (pj) return pj.async('string').then(function (s) {
            var p = JSON.parse(s); if (!valid(p)) throw new Error('NOT A TNC PROFILE'); return { kind: 'profile', profile: p };
          });
          var jobs = [];
          z.forEach(function (path, f) {
            if (f.dir || !/\.(h|i)$/i.test(path)) return;
            var mm = /(?:^|\/)TNC(\d{3})\//.exec(path);
            jobs.push(f.async('arraybuffer').then(function (b) { return { name: path.split('/').pop(), text: decode(b), machine: mm ? mm[1] : null }; }));
          });
          return Promise.all(jobs).then(function (files) { return { kind: 'programs', files: files }; });
        });
      }
      var text = decode(buf);
      if (/\.json$/i.test(nm)) { var p = JSON.parse(text); if (!valid(p)) throw new Error('NOT A TNC PROFILE'); return { kind: 'profile', profile: p }; }
      if (/\.t$/i.test(nm) || /^\s*BEGIN\s+TOOL/i.test(text)) { var t = parseToolT(text); return t ? { kind: 'tools', tools: t, name: nm } : { kind: 'unknown' }; }
      return { kind: 'programs', files: [{ name: nm, text: text, machine: null }] };
    });
  }

  /* incoming profile merged into base: programs by name (clashes renamed _IMP), projects appended */
  function merge(base, inc) {
    var out = JSON.parse(JSON.stringify(base)), renamed = 0;
    Object.keys(inc.machines || {}).forEach(function (m) {
      var bm = out.machines[m] = out.machines[m] || { pgms: {}, cur: null, tools: [] }, im = inc.machines[m] || {};
      bm.pgms = bm.pgms || {};
      Object.keys(im.pgms || {}).forEach(function (n) {
        var name = n;
        if (bm.pgms[name] != null && bm.pgms[name] !== im.pgms[n]) {
          var base_ = n.replace(/\.H$/i, '').slice(0, 12), k = 1;
          do { name = base_ + '_IMP' + (k > 1 ? k : '') + '.H'; k++; } while (bm.pgms[name] != null);
          renamed++;
        }
        bm.pgms[name] = im.pgms[n];
      });
      var have = {}; (bm.tools = bm.tools || []).forEach(function (t) { have[t.t] = 1; });
      (im.tools || []).forEach(function (t) { if (!have[t.t]) bm.tools.push(t); });
    });
    (inc.projects || []).forEach(function (pj) { var c = JSON.parse(JSON.stringify(pj)); c.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); out.projects.push(c); });
    return { profile: out, renamed: renamed };
  }

  return { blank: blank, load: load, save: save, wipe: wipe, legacy: legacy, valid: valid,
    exportZip: exportZip, readFile: readFile, merge: merge, parseToolT: parseToolT, toolT: toolT, decode: decode,
    get lastSaved() { return lastSaved; } };
})();
if (typeof module !== 'undefined') module.exports = TNC_PROFILE;
