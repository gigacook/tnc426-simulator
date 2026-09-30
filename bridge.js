/* ============================================================
   TNC_BRIDGE — the simulator talking to the TNC server and its web app.
   Does nothing in the plain page (GitHub Pages, a downloaded index.html):
   it only wakes up when the server injected window.TNC_BACKEND = {api, ai}
   while serving the page at /sim/.

   With a server:
     - AI goes through the server (window.TNC_AI_API): the OpenRouter key stays
       on the server, the browser sends its session cookie.
   Inside the web app (an iframe from the same origin), postMessage:
     app -> sim  {type:'tnc:open', name, text, machine, tools}   open / replace a program
                 {type:'tnc:get', id}                            ask for the program on screen
     sim -> app  {type:'tnc:ready'}
                 {type:'tnc:program', id, name, machine, text}   answer to tnc:get
                 {type:'tnc:changed', name, machine, text}       after an edit (debounced)
                 {type:'tnc:selected', name, machine}            another program was opened
   ============================================================ */
var TNC_BRIDGE = (function () {
  'use strict';
  if (typeof window === 'undefined' || !window.TNC_BACKEND) return null;
  var B = window.TNC_BACKEND, embedded = false;
  try { embedded = window.parent !== window && window.parent.location.origin === location.origin; } catch (e) { embedded = false; }

  fetch(B.api + '/info', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (info) {
    if (info && info.ai && info.ai.enabled) window.TNC_AI_API = B.ai;
  }).catch(function () {});

  function post(msg) { if (embedded) try { window.parent.postMessage(msg, location.origin); } catch (e) {} }

  (window.TNC_UI_PLUGINS = window.TNC_UI_PLUGINS || []).push(function (ui) {
    if (!embedded) return;
    var t = 0;
    ui.on('text', function (p) {
      clearTimeout(t);
      t = setTimeout(function () { post({ type: 'tnc:changed', name: p.name, machine: p.machine, text: p.text }); }, 400);
    });
    ui.on('program', function (p) { post({ type: 'tnc:selected', name: p.name, machine: p.machine }); });
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || e.source !== window.parent) return;
      var m = e.data || {};
      if (m.type === 'tnc:open' && typeof m.text === 'string') {
        ui.open(m.name, m.text, { machine: m.machine, tools: m.tools });
      } else if (m.type === 'tnc:get') {
        var p = ui.program;
        post({ type: 'tnc:program', id: m.id, name: p.name, machine: p.machine, text: p.text });
      }
    });
    ui.on('ready', function () { post({ type: 'tnc:ready' }); });
  });

  return { embedded: embedded, backend: B };
})();
if (typeof module !== 'undefined') module.exports = TNC_BRIDGE;
