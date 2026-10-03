/* ============================================================
   TNC_AI — the third way to make a program: describe it, an AI writes it.
   OpenRouter only (BYOK). Plain fetch, no SDK, no server.
   The key lives in this browser (sessionStorage, or localStorage if the
   operator ticks Remember), or comes from .env in the gitignored local build.

   TNC_AI.DEFAULT_MODEL, TNC_AI.RECOMMENDED — the recommended model (DeepSeek V4.1 Flash)
   TNC_AI.listModels() -> Promise {live, models:[{id,name,provider,context,pin,pout,created}], frontier:[...]}
     the ONE model catalogue: OpenRouter's live list (or the server's filtered copy); pin/pout = US$ per million
     tokens in/out. frontier = newest flagship per major provider, computed from that list. Never rejects: when
     the list can't be fetched it resolves the small OFFLINE list with live:false.
   TNC_AI.providerName(slug) -> 'Anthropic', 'xAI', ...
   TNC_AI.generate({key, model, prompt, system, tools, verify, onStep, signal, maxRepairs, timeoutMs}) -> {src, report, cost}
     onStep phases: 'request' {attempt}, 'progress' {attempt, secs, chars, reasoningChars, stage:'thinking'|'writing'}
     (fired about once a second while the model streams), 'checked' {attempt, report, src}.
   TNC_AI.testKey(key) -> {label, usage, limit, ...}
   TNC_AI.extract(text) -> program text or null
   TNC_AI.system(tools) -> the system prompt for a tool table
   ============================================================ */
var TNC_AI = (function () {
  'use strict';
  var API = 'https://openrouter.ai/api/v1';
  var DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';

  /* ---------- the model catalogue: the only model list in the app ---------- */
  var FRONTIER_PROVIDERS = ['anthropic', 'openai', 'google', 'x-ai', 'deepseek', 'qwen', 'meta-llama', 'mistralai'];
  var PROVIDERS = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google', 'x-ai': 'xAI', deepseek: 'DeepSeek', qwen: 'Qwen',
    'meta-llama': 'Meta', mistralai: 'Mistral', moonshotai: 'Moonshot', 'z-ai': 'Z.ai', cohere: 'Cohere', perplexity: 'Perplexity',
    amazon: 'Amazon', microsoft: 'Microsoft', nvidia: 'NVIDIA', minimax: 'MiniMax', openrouter: 'OpenRouter', baidu: 'Baidu',
    tencent: 'Tencent', bytedance: 'ByteDance', 'ibm-granite': 'IBM', inception: 'Inception', liquid: 'Liquid', 'arcee-ai': 'Arcee' };
  function providerName(slug) { return PROVIDERS[slug] || slug; }
  /* Offline fallback ONLY (the live list could not be fetched): ids that were on OpenRouter on 2026-09-27.
     Only DeepSeek V4.1 Flash's price was checked then ($0.035 / $0.29 per M); the rest show as unknown. */
  var OFFLINE = [
    { id: DEFAULT_MODEL, name: 'DeepSeek V4.1 Flash', pin: 0.035, pout: 0.29 },
    { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5' },
    { id: 'openai/gpt-5.6-luna', name: 'GPT-5.6 Luna' },
    { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash' },
    { id: 'deepseek/deepseek-v4-pro-0813', name: 'DeepSeek V4 Pro' },
    { id: 'qwen/qwen3.8-flash', name: 'Qwen 3.8 Flash' }
  ].map(function (m) { return { id: m.id, name: m.name, provider: m.id.split('/')[0], context: null,
    pin: m.pin == null ? null : m.pin, pout: m.pout == null ? null : m.pout, created: 0 }; });
  var RECOMMENDED = OFFLINE[0];

  function perM(x) { var v = parseFloat(x); return isFinite(v) && v >= 0 ? v * 1e6 : null; }   // OpenRouter: US$ per token; -1 = variable
  function normalize(m) {
    var pr = m.pricing || {}, out = (m.architecture || {}).output_modalities, n = String(m.name || m.id), c = n.indexOf(': ');
    return { id: m.id, name: c > 0 && c < 30 ? n.slice(c + 2) : n, provider: String(m.id).split('/')[0],
      context: +m.context_length || (m.top_provider && +m.top_provider.context_length) || null,
      pin: perM(pr.prompt), pout: perM(pr.completion), created: +m.created || 0,
      text: !out || (out.indexOf('text') >= 0 && out.indexOf('image') < 0), variant: /:/.test(m.id) };
  }
  /* Frontier quick picks: per major provider, drop the small / fast / special-purpose models and the premium
     "pro" tier (> $60 per M out), keep the ones released within 120 days of that provider's newest, and take the
     top-tier name first (opus / pro / max / large / ultra), then the highest output price, then the newest.
     A heuristic over names and prices, not a benchmark. */
  var TOP_TIER = /(^|[-_.])(opus|pro|max|large|ultra|premier)(?=[-_.\d]|$)/i;
  var NOT_FLAGSHIP = /(^|[-_.])(mini|nano|lite|tiny|small|micro|flash|fast|haiku|air|turbo|instant|embed\w*|guard|moderation|audio|tts|image|realtime|search|research|ocr|vl|vision|codex|coder|devstral|codestral|distill|oss|ministral|saba)(?=[-_.\d]|$)/i;
  function frontier(models) {
    var out = [];
    FRONTIER_PROVIDERS.forEach(function (p) {
      var c = models.filter(function (m) { return m.provider === p && m.pout > 0 && m.pout <= 60 && !NOT_FLAGSHIP.test(m.id.slice(p.length + 1)); });
      if (!c.length) return;
      var newest = Math.max.apply(null, c.map(function (m) { return m.created; }));
      c = c.filter(function (m) { return newest - m.created <= 120 * 86400; });
      var top = function (m) { return TOP_TIER.test(m.id.slice(p.length + 1)) ? 1 : 0; };
      c.sort(function (a, b) { return (top(b) - top(a)) || (b.pout - a.pout) || (b.created - a.created); });
      out.push(c[0]);
    });
    return out;
  }
  var catalogue = null;
  function listModels() {
    var base = api();
    if (catalogue && catalogue.base === base) return catalogue.p;
    var p = fetch(base + '/models', { headers: { Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).then(function (j) {
      var L = (j.data || []).map(normalize).filter(function (m) { return m.id && !m.variant && m.text; });
      if (!L.length) throw new Error('empty model list');
      return { live: true, models: L, frontier: frontier(L) };
    }).catch(function (e) {
      catalogue = null;                                   // try again next time the picker opens
      return { live: false, error: String(e && e.message || e), models: OFFLINE.slice(), frontier: OFFLINE.slice(1) };
    });
    catalogue = { base: base, p: p };
    return p;
  }

  /* window.TNC_AI_API: set by bridge.js when the page is served by the TNC server, which holds the
     OpenRouter key and forwards to OpenRouter. The browser then sends its session cookie, never a key. */
  function api() { return (typeof window !== 'undefined' && window.TNC_AI_API) || API; }
  function headers(key) {
    var h = { 'Content-Type': 'application/json', 'X-Title': 'TNC 426 Simulator' };
    if (api() === API) h['Authorization'] = 'Bearer ' + key;
    try { if (typeof location !== 'undefined' && /^https?:/.test(location.origin)) h['HTTP-Referer'] = location.origin + location.pathname; } catch (e) {}
    return h;
  }
  function httpError(res, body) {
    var msg = (body && body.error && (body.error.message || body.error)) || res.statusText || 'request failed';
    var e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)); e.status = res.status; return e;
  }
  function dataError(obj) {
    var msg = (obj && obj.error && (obj.error.message || obj.error)) || 'stream error';
    var e = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)); e.status = (obj && obj.error && obj.error.code) || 502; return e;
  }
  function readJson(res) { return res.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return { raw: t }; } }); }

  /* SSE line/byte parsing, kept pure (no fetch, no timers) so it can be unit-tested without a network call. */
  function sseLine(line, onEvent) {
    line = line.replace(/\r$/, '');
    if (line.slice(0, 5) !== 'data:') return;
    var data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    var obj; try { obj = JSON.parse(data); } catch (e) { return; }
    onEvent(obj);
  }
  function sseFeed(buf, chunk, onEvent) {
    buf += chunk;
    var lines = buf.split('\n');
    buf = lines.pop();
    for (var i = 0; i < lines.length; i++) sseLine(lines[i], onEvent);
    return buf;
  }

  function testKey(key) {
    return fetch(api() + '/key', { headers: headers(key) }).then(function (res) {
      return readJson(res).then(function (b) { if (!res.ok) throw httpError(res, b); return b.data || b; });
    });
  }

  /* Streams the answer over SSE so the caller can show live progress (reasoning models can think for
     minutes before writing anything). Ties together the caller's AbortSignal and an overall timeout. */
  /* the request as sent (minus the key): shown to the user on demand.
     reasoning: 'off' | 'low' | 'medium' | 'high' (OpenRouter unified reasoning); maxTokens caps the answer (budget guard) */
  function requestBody(o) {
    var b = { model: o.model, messages: o.messages, temperature: 0.2, usage: { include: true }, stream: true };
    if (o.reasoning === 'off') b.reasoning = { enabled: false };
    else if (o.reasoning) b.reasoning = { effort: o.reasoning };
    if (o.maxTokens) b.max_tokens = o.maxTokens;
    return b;
  }
  /* chat, and when the answer stops at max_tokens, ask for the rest (at most twice) and join the pieces.
     When only reasoning fit in the budget, try once more with twice the budget. */
  var TOKEN_CAP = 64000;
  function chatFull(o, onCont) {
    var parts = [], cost = 0, conts = 0;
    function once(req) {
      return chat(req).then(function (r) {
        cost += r.cost; parts.push(r.text);
        if (r.finish === 'length' && conts < 2) {
          conts++; if (onCont) onCont({ n: conts, chars: parts.join('').length });
          var msgs = o.messages.concat([{ role: 'assistant', content: parts.join('') },
            { role: 'user', content: 'Your answer was cut off by the length limit. Continue EXACTLY where it stopped: the next characters only — no repetition, no explanation, do not reopen a code fence that is already open.' }]);
          return once(Object.assign({}, o, { messages: msgs }));
        }
        return { text: parts.join(''), cost: cost, finish: r.finish, continued: conts };
      }, function (e) {
        if (e && e.cutOff && !o._retried && (o.maxTokens || 0) < TOKEN_CAP) {
          if (onCont) onCont({ n: 0, retry: true, maxTokens: Math.min(TOKEN_CAP, (o.maxTokens || 16000) * 2) });
          return chatFull(Object.assign({}, o, { _retried: true, maxTokens: Math.min(TOKEN_CAP, (o.maxTokens || 16000) * 2) }), onCont)
            .then(function (r) { r.cost += cost; return r; });
        }
        /* a dropped connection or a provider hiccup (5xx): one more try after a short pause; never for 4xx or a cancel */
        var transient = e && e.name !== 'AbortError' && !e.cutOff && !(e.status >= 400 && e.status < 500) && !/TIMED OUT/.test(e.message || '');
        if (transient && !o._netRetried) {
          if (onCont) onCont({ n: 0, network: true, error: String(e.message || e) });
          return new Promise(function (r) { setTimeout(r, o.retryDelayMs != null ? o.retryDelayMs : 2000); })
            .then(function () { return chatFull(Object.assign({}, o, { _netRetried: true }), onCont); })
            .then(function (r) { r.cost += cost; return r; });
        }
        throw e;
      });
    }
    return once(o);
  }

  function chat(o) {
    var onProgress = o.onProgress || function () {};
    /* idle timeout: nothing streamed for this long = stuck (reasoning models stream their thinking, so a working
       model keeps the line busy); plus a hard cap for the whole answer. A long program that streams steadily is fine. */
    var timeoutMs = o.timeoutMs || 180000, hardMs = o.hardTimeoutMs || 1800000;
    var text = '', reasoning = '', usage = null, streamErr = null, timedOut = false, finish = null;
    var start = Date.now();
    var ac = new AbortController();
    var to = null, hard = setTimeout(function () { timedOut = true; ac.abort(); }, hardMs);
    function alive() { clearTimeout(to); to = setTimeout(function () { timedOut = true; ac.abort(); }, timeoutMs); }
    alive();
    if (o.signal) { if (o.signal.aborted) ac.abort(); else o.signal.addEventListener('abort', function () { ac.abort(); }); }
    var tick = setInterval(function () {
      onProgress({ secs: (Date.now() - start) / 1000, chars: text.length, reasoningChars: reasoning.length,
        stage: text.length ? 'writing' : 'thinking', text: text, reasoningTail: reasoning.slice(-400) });
    }, 500);
    function cleanup() { clearTimeout(to); clearTimeout(hard); clearInterval(tick); }
    function onEvent(obj) {
      if (obj.error) { streamErr = streamErr || dataError(obj); return; }
      var d = obj.choices && obj.choices[0] && obj.choices[0].delta;
      if (d) {
        if (d.content) text += d.content;
        if (d.reasoning) reasoning += d.reasoning; // OpenRouter puts reasoning-model "thinking" tokens here
      }
      var fr = obj.choices && obj.choices[0] && obj.choices[0].finish_reason;
      if (fr) finish = fr;                       // 'length' = cut off by max_tokens (reasoning counts against it)
      if (obj.usage) usage = obj.usage;
    }

    return fetch(api() + '/chat/completions', {
      method: 'POST', headers: headers(o.key), signal: ac.signal,
      body: JSON.stringify(requestBody(o))
    }).then(function (res) {
      if (!res.ok) return readJson(res).then(function (b) { throw httpError(res, b); });
      if (!res.body || !res.body.getReader) { // no streaming reader available: fall back to one shot
        return res.text().then(function (t) { var buf = ''; var lines = t.split('\n'); for (var i = 0; i < lines.length; i++) sseLine(lines[i], onEvent); });
      }
      var reader = res.body.getReader(), decoder = new TextDecoder(), buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (streamErr) throw streamErr;
          if (r.done) { if (buf) sseLine(buf, onEvent); return; }
          alive(); buf = sseFeed(buf, decoder.decode(r.value, { stream: true }), onEvent);
          if (streamErr) throw streamErr;
          return pump();
        });
      }
      return pump();
    }).then(function () {
      cleanup();
      if (streamErr) throw streamErr;
      if (!text && reasoning) { var e = new Error('THE MODEL ANSWERED WITH REASONING ONLY, NO FINAL TEXT (' + reasoning.length + ' chars)' +
        (finish === 'length' ? ' — THE TOKEN LIMIT RAN OUT WHILE IT WAS STILL THINKING' : '') + ' — raise the answer limit or lower the reasoning effort'); e.status = 502; e.cutOff = finish === 'length'; throw e; }
      if (!text) { var e2 = new Error('EMPTY ANSWER FROM THE MODEL'); e2.status = 502; throw e2; }
      return { text: text, cost: (usage && +usage.cost) || 0, finish: finish, usage: usage };
    }).catch(function (e) {
      cleanup();
      if (e && e.name === 'AbortError') {
        if (timedOut) { var te = new Error('TIMED OUT WAITING FOR THE MODEL (' + Math.round((Date.now() - start) / 1000) + ' s; nothing for ' + Math.round(timeoutMs / 1000) + ' s, or over the ' + Math.round(hardMs / 60000) + ' min cap)'); te.status = 0; throw te; }
        throw e; // caller cancelled: keep e.name === 'AbortError' so the UI shows CANCELLED
      }
      throw e;
    });
  }

  /* the program: the fenced block that contains BEGIN PGM, else BEGIN PGM .. END PGM in the raw text */
  function extract(text) {
    text = String(text || '');
    var fences = text.match(/```[a-z]*\s*\n([\s\S]*?)```/gi) || [];
    for (var i = 0; i < fences.length; i++) {
      var body = fences[i].replace(/^```[a-z]*\s*\n/i, '').replace(/```$/, '');
      if (/BEGIN\s+PGM/i.test(body)) return clean(body);
    }
    var m = /BEGIN\s+PGM[\s\S]*?END\s+PGM[^\n]*/i.exec(text);
    return m ? clean(m[0]) : null;
  }
  function clean(s) { return s.replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/^\s*\d+\s+(?=[A-Z;*])/i, '').replace(/\s+$/, ''); }).join('\n').trim(); }

  function toolLine(tools) {
    return (tools || []).map(function (t) { return 'T' + t.t + ' ' + t.name + ' R' + (+t.r); }).join(' | ');
  }

  /* The tool table as constraints, not names: what each cutter can and cannot do, how deep it reaches before
     its holder touches the part, the smallest inside corner and groove it makes, and a safe S / F.
     o: {holderA (mm, spindle face to collet nose; default 100 = ISO 50), sMax, fMax} */
  var PART = (typeof TNC_PART !== 'undefined' && TNC_PART) || (typeof require !== 'undefined' ? (function () { try { return require('./part.js'); } catch (e) { return null; } })() : null);
  function kindOf(t) { return PART ? PART.toolKind(t) : 'tool'; }
  function toolSheet(tools, o) {
    o = o || {};
    var A = o.holderA || 100, sMax = o.sMax || 6000, rows = [];
    (tools || []).forEach(function (t) {
      var D = +(2 * t.r).toFixed(3), k = kindOf(t), L = +t.l || 0;
      var reach = L > 0 ? Math.max(L - A, 0.25 * L) - 1 : null;
      var z = /face/.test(k) ? 5 : /end mill/.test(k) ? 3 : 2;
      var vc = /face/.test(k) ? 300 : /end mill/.test(k) ? 200 : /drill/.test(k) ? 80 : 60;
      var S = Math.min(sMax, Math.round(vc * 1000 / (Math.PI * D) / 100) * 100);
      var F = Math.floor(0.8 * (0.012 * D + 0.005) * S * z / 10) * 10;
      var line = 'T' + t.t + ' ' + t.name + ' — ' + k + ' Ø' + D + (L > 0 ? ', reaches ' + reach.toFixed(1) + ' mm below the top before the holder touches' : '');
      if (/end mill/.test(k)) line += '. Flat bottom (ball: round). Groove/slot width = ' + D + '; smallest inside corner R' + (+t.r) +
        '. Plunge straight max 1 mm per step at F150, deeper by ramping. Depth per pass ≤ ' + (D / 2) + ' slotting, ≤ ' + D + ' side cutting; step-over ≤ ' + (0.6 * D).toFixed(1) + '. S' + S + ' F' + F + '.';
      else if (/face/.test(k)) line += '. Facing only: depth per pass ≤ 2, step-over ≤ ' + (0.7 * D).toFixed(0) + ', start and end the pass outside the blank. S' + S + ' F' + F + '.';
      else if (k === 'drill') line += '. Axial only (CYCL DEF 200 / 203 / 205), hole Ø = ' + D + ' exactly; the 118° point goes ' + (0.3 * D).toFixed(1) + ' deeper than the programmed depth. S' + S + ' Q206=' + Math.round(S * D * 0.012) + '.';
      else if (k === 'spot drill') line += '. 90° point: spot / countersink depth d makes a Ø 2·d cone; axial only.';
      else if (k === 'chamfer cone') line += '. 45° cone: an edge chamfer of width w = run the tip along the edge at Z-w (radius comp. off), or deburr.';
      else if (k === 'tap') line += '. Tapping only (CYCL DEF 207 rigid / 206), into a hole drilled to the core Ø first; F = S × pitch.';
      else if (k === 'reamer') line += '. Reaming only (CYCL DEF 201) into a hole drilled 0.2–0.3 mm under size.';
      else if (k === 'boring head') line += '. Boring only (CYCL DEF 202) to finish an existing hole.';
      else if (k === 'probe') line += '. Touch probe: NEVER cuts.';
      rows.push(line);
    });
    return rows.join('\n');
  }

  /* The part spec the model plans before it writes (TNC_PART). */
  var SPEC_FORMAT = [
'PART SPEC (```partspec, JSON): the finished part as features, mm, same datum as the program, top face Z+0, z = the floor each feature leaves.',
'{"blank":{"x":[0,120],"y":[0,80],"z":[-15,0]},"features":[',
' {"id":"F1","type":"face","z":-0.5},',
' {"id":"P1","type":"pocket","shape":"rect","x":[30,90],"y":[25,55],"r":3,"z":-6},       r = corner radius (≥ the cutter radius)',
' {"id":"P2","type":"pocket","shape":"circle","x":60,"y":40,"d":30,"z":-5},',
' {"id":"P3","type":"pocket","shape":"poly","points":[[10,10],[40,10],[25,35]],"z":-4},',
' {"id":"H1","type":"hole","x":10,"y":10,"d":8.5,"z":-20},                           through: z below the blank bottom',
' {"id":"S1","type":"slot","from":[10,40],"to":[50,40],"w":6,"z":-3},                  w = slot width',
' {"id":"E1","type":"engrave","path":[[10,10],[30,10],[30,20]],"w":3,"z":-1},           tool-centre polyline, w = cutter Ø',
' {"id":"T1","type":"text","text":"SMITH","x":10,"y":20,"h":20,"w":3,"z":-1.5,"align":"left"},  capital letters: x,y = baseline start (align center: x = middle), h = cap height, w = cutter Ø',
' {"id":"O1","type":"profile","points":[[5,5],[115,5],[115,75],[5,75]],"z":-10}         outside contour: everything outside the outline cut down to z',
']}',
'Text is engraved in the simulator\'s single-stroke capitals; you get the exact stroke coordinates back, so do not draw letters yourself.'
  ].join('\n');

  function system(tools, opts) {
    opts = opts || {};
    return [
'You write HEIDENHAIN TNC 426 / TNC 430 conversational (Klartext) programs, NC software 280 476, for a browser simulator.',
'Its interpreter accepts the syntax below; anything else is rejected with an error. Units are mm.',
'',
'OUTPUT FORMAT',
'- Reply with ONLY the program inside a single ```klartext fenced block. Nothing before or after the fence.',
'- No block numbers. One block per line.',
'- Line 1: BEGIN PGM <NAME> MM. Last line: END PGM <NAME> MM (same name). NAME: A-Z, 0-9, _ only, max 16 characters.',
'- Lines 2-3: the BLK FORM. Then ; comment lines describing the part: blank size, features, tools with S and F.',
'',
'BLANK',
'BLK FORM 0.1 Z X+0 Y+0 Z-20   (MIN corner; Z after 0.1 = tool axis)',
'BLK FORM 0.2 X+100 Y+80 Z+0   (MAX corner)',
'Datum at front-left corner, top face Z+0, blank bottom negative. The tool starts at X0 Y0 Z0.',
'',
'PATH BLOCKS',
'TOOL CALL 5 Z S3000            tool, axis Z, speed. Does NOT start the spindle.',
'L X+10 Y+20 Z-3 R0 F500 M3     line. X Y Z absolute, IX IY IZ incremental. F modal mm/min. FMAX = rapid, this block only.',
'CC X+50 Y+40                   circle centre / pole (modal). C X+30 Y+40 DR+  arc about CC to X Y (end = start: full circle).',
'CR X+80 Y+40 R+20 DR-          arc by radius (+R <= 180 deg, -R > 180 deg). DR+ counter-clockwise, DR- clockwise, seen from +Z.',
'CT X+40 Y+5                    arc tangent to the previous element.',
'RND R5                         rounding arc between the element before and after it (between two path blocks).',
'CHF 5                          chamfer of side length 5 between two straight lines.',
'LP PR+30 PA+45                 polar line about CC (PR radius, PA angle deg; IPR IPA incremental).',
'CP IPA+360 IZ-2 DR+            polar arc about CC by an angle; with IZ it is a helix. CTP PR.. PA.. tangent polar arc.',
'',
'RADIUS COMPENSATION (use it for contours; the simulator offsets exactly like the TNC)',
'RL = tool left of the contour, RR = right, seen in the direction of travel. R0 = tool centre on the path. Modal.',
'Climb milling an outside contour: RL going clockwise around the part. Inside a pocket: RL going counter-clockwise.',
'Outside corners get an arc automatically; inside corners must be larger than the tool radius or TOOL RADIUS TOO LARGE.',
'Never switch RL straight to RR: an R0 block must come between. Cancel with an R0 line or a DEP block.',
'Approach and depart tangentially (preferred):',
'  L X-20 Y-20 R0 FMAX / L Z-5 R0 F200    start point PS outside the contour, at depth',
'  APPR LCT X+0 Y+0 R5 RL F500             first contour point, arc radius 5, compensation',
'  L ... contour ...',
'  DEP LCT X-20 Y-20 R5 F1000               depart to PN with an arc, compensation cancelled',
'  Also: APPR LT X Y LEN10 RL, APPR LN X Y LEN10 RL, APPR CT X Y CCA90 R5 RL, DEP LT LEN10, DEP LN LEN10, DEP CT CCA90 R5.',
'',
'PROGRAM FLOW',
'LBL 1 / LBL 0 / CALL LBL 1 / CALL LBL 1 REP 3/3 (section repeat: REP r runs it r+1 times in total).',
'Subprogram: CALL LBL n (no REP) runs LBL n ... LBL 0; place subprograms after M30.',
'FN 0: Q1 = -2      FN 1: Q2 = +Q2 + +Q1      (FN 2 minus, FN 3 times, FN 4 divide). Q in coordinates/feeds: L Z+Q2 FQ3.',
'Depth passes: FN 0: Q1 = -2, FN 0: Q2 = +0, loop: FN 1: Q2 = +Q2 + +Q1 then L Z+Q2 (absolute).',
'M30 alone on a line ends the program. ; starts a comment.',
'Formulas: Q10 = (Q1 + Q2) / 2, SIN COS SQRT SQ ABS PI. Jumps: FN 12: IF +Q1 LT +Q2 GOTO LBL 1. Never use: FK, INCH, block numbers.',
'',
'M-FUNCTIONS',
'M3/M4 spindle on, M8 coolant, M13/M14 spindle+coolant: at block START. M5, M9, M2/M30: at block END.',
'Every TOOL CALL stops the spindle: the next block must carry M3, e.g. L Z+50 R0 FMAX M3. M5 only on a retract block.',
'',
'CYCLES. A CYCL DEF plus its indented Q lines is ONE block; call it with M99 on a positioning block or CYCL CALL.',
'Available: 200 201 202 203 204 205 206 207 208 209 (drilling, boring, tapping; 207: Q239 pitch, F = S x pitch), 212 213 214 215 (pocket/stud finishing, centre Q216 Q217),',
'210 211 (slots), 220 221 (patterns: define the machining cycle first, then 220/221 runs it at every point, no CYCL CALL), 230 231 (surfaces),',
'7 DATUM SHIFT (7.1 X+.. 7.2 Y+..), 8 MIRROR, 10 ROTATION (10.1 ROT+..), 11 SCALING (11.1 SCL ..), 4 and 5 old pockets. Reset shifts/rotations when done.',
'CYCL DEF 200 DRILLING',
'  Q200=+2    ;SET-UP CLEARANCE',
'  Q201=-15   ;DEPTH',
'  Q206=+150  ;FEED RATE FOR PLNGNG',
'  Q202=+5    ;PLUNGING DEPTH',
'  Q210=+0    ;DWELL TIME AT TOP',
'  Q203=+0    ;SURFACE COORDINATE',
'  Q204=+50   ;2ND SET-UP CLEARANCE',
'L X+20 Y+20 R0 FMAX M99',
'CYCL DEF 201 REAMING: Q200 Q201 Q206 Q211 Q208 (retract feed, 0 = ream feed) Q203 Q204.',
'CYCL DEF 203 UNIVERSAL DRILLING: as 200 plus Q212 Q213 Q205 Q211 Q208 (0 = plunging feed) Q256.',
'Pocket, dotted form, called at the pocket centre at Z = surface + set-up:',
'CYCL DEF 4.0 POCKET MILLING / 4.1 SET UP 2 / 4.2 DEPTH -10 / 4.3 PECKG 3 F100 / 4.4 X60 / 4.5 Y40 / 4.6 F600 DR+ RADIUS 0',
'',
'TOOL TABLE — these tools and nothing else. Read the limits: a feature no tool can make must be changed, not faked.',
toolSheet(tools, opts),
'Cones (spot, chamfer) cut a 45 degree flank. Probes never cut.',
'',
'NOT AVAILABLE in this control / simulator (rejected or wrong): FK free contour programming, cycles 3 5 12 13 14 20-25 (SL contour cycles) 26 27 28,',
'cycles 251+ (iTNC 530 only), PLANE, M128, M91/M92 moves, TOOL DEF inside the program for a tool not in the table, INCH programs.',
'',
'SAFETY RULES THE SIMULATOR ENFORCES (a violation is reported as a crash)',
'1. No FMAX into uncut stock: FMAX over the part only at Z+2 or higher; feed into the cut; FMAX back to Z+2 before any XY rapid.',
'2. No cutting move without M3/M4 since the last TOOL CALL.',
'3. Going below the blank is allowed (through holes, taps); the holder must never reach the part: stick-out = tool length L minus the holder A dimension.',
'4. Chip load for end mills (3 flutes) and face mills (5): F / (S x flutes) <= 0.012 x D + 0.005.',
'   Each tool line in the table gives a safe S and F for it.',
'Plunge at F100-F200. Keep every cut within the blank.',
'',
'ERRORS',
'If you get an error report from the simulator (each with a block number; BEGIN PGM is block 0; a CYCL DEF with its Q lines is one block),',
'find the cause and return the COMPLETE corrected program, same format, nothing outside the fence.'
    ].join('\n') + (opts.plan ? '\n\nACCURACY\nYou work in two steps: first a part spec (the finished geometry), then the program. The simulator machines the program on a height field, measures the result against the spec in mm, and sends you the misses and gouges by position. Program the spec exactly: clear the WHOLE pocket area (step-over ≤ 0.6 × cutter Ø, finish the walls with radius compensation), reach every floor, keep the walls where the spec puts them.\n\n' + SPEC_FORMAT : '');
  }
  var FALLBACK_SYSTEM = system([]);

  /* generate({key, model, prompt, system, tools, verify, measure, plan, rounds, goal, onStep, signal, reasoning, maxTokens, timeoutMs})
     verify(src) -> {ok, errs, crashes, warns, text}: the simulator's checks.
     plan + measure(spec, src) -> TNC_PART.compare report: the model first writes a part spec, the program is measured against it,
     and up to `rounds` refinement rounds send errors / misses / gouges back. The best program wins (checked clean first, then match %).
     onStep phases: 'request' {attempt, stage}, 'progress', 'continued' {n}, 'planned' {spec, sheet, notes}, 'checked' {report, src},
     'measured' {measure, src}. */
  function generate(o) {
    var model = o.model || DEFAULT_MODEL, onStep = o.onStep || function () {};
    var plan = !!(o.plan && o.measure && PART), rounds = o.rounds != null ? o.rounds : o.maxRepairs != null ? o.maxRepairs : 1;
    var goal = o.goal || 95, cost = 0, attempt = 0, best = null, spec = null;
    var sys = { role: 'system', content: o.system || system(o.tools, { plan: plan }) };
    var ask = { role: 'user', content: 'Write the program for this part:\n\n' + o.prompt };
    function call(messages, stage) {
      var req = { key: o.key, model: model, messages: messages, signal: o.signal, timeoutMs: o.timeoutMs, reasoning: o.reasoning, maxTokens: o.maxTokens, retryDelayMs: o.retryDelayMs };
      onStep({ phase: 'request', attempt: attempt, stage: stage, body: JSON.parse(JSON.stringify(requestBody(req))) });
      return chatFull(Object.assign(req, {
        onProgress: function (p) { onStep({ phase: 'progress', attempt: attempt, stage: p.stage, secs: p.secs, chars: p.chars, reasoningChars: p.reasoningChars, text: p.text, reasoningTail: p.reasoningTail }); }
      }), function (c) { onStep({ phase: 'continued', attempt: attempt, n: c.n, retry: !!c.retry, maxTokens: c.maxTokens, network: !!c.network, error: c.error }); })
        .then(function (r) { cost += r.cost; return r; });
    }
    function rank(c) { return (c.report.ok ? 1000 : 0) + (c.measure && c.measure.score != null ? c.measure.score : 0) - c.report.errs.length - c.report.crashes.length; }
    function done() { if (!best) { var e = new Error('THE MODEL DID NOT RETURN A PROGRAM'); e.status = 0; throw e; }
      return { src: best.src, report: best.report, measure: best.measure, spec: spec, cost: cost, attempts: attempt + 1 }; }

    /* step 1: the part spec (one retry when it does not parse) */
    function planStep(retry) {
      var msgs = [sys, { role: 'user', content: ask.content + '\n\nSTEP 1 of 2: reply with ONLY the part spec in one ```partspec fence — the finished geometry, every feature, ' +
        'blank = the BLK FORM you will program. Check each feature against the tool table limits (corner radii, groove widths, drill sizes, reach). No program yet.' +
        (retry ? '\n\nYour last spec was refused: ' + retry : '') }];
      return call(msgs, 'plan').then(function (r) {
        var pr = PART.parse(r.text);
        if (pr.error && !retry) return planStep(pr.error);
        if (pr.error) { onStep({ phase: 'planned', attempt: attempt, error: pr.error }); return null; }
        var ex = PART.expand(pr.spec, o.tools);
        spec = ex.spec;
        onStep({ phase: 'planned', attempt: attempt, spec: spec, sheet: ex.sheet, notes: ex.notes });
        return { answer: r.text, ex: ex };
      });
    }
    /* step 2..n: write, check, measure, refine */
    function writeMsgs(p, last, feedback) {
      var m = [sys, ask];
      if (p) m.push({ role: 'assistant', content: '```partspec\n' + JSON.stringify(stripPaths(spec)) + '\n```' },
        { role: 'user', content: 'STEP 2 of 2: write the program for exactly this spec. Exact geometry:\n' + p.ex.sheet +
          (p.ex.notes.length ? '\n\nFEASIBILITY — fix these (send a corrected ```partspec first if the spec changes):\n- ' + p.ex.notes.join('\n- ') : '') +
          '\n\nReply with the program in one ```klartext fence' + (p.ex.notes.length ? ' (a corrected ```partspec before it if needed)' : '') + '.' });
      if (last) m.push({ role: 'assistant', content: (last.specText ? last.specText + '\n' : '') + '```klartext\n' + last.src + '\n```' }, { role: 'user', content: feedback });
      return m;
    }
    function write(p, last, feedback) {
      return call(writeMsgs(p, last, feedback), last ? 'refine' : 'write').then(function (r) {
        var src = extract(r.text), specText = null;
        if (plan && /```partspec/i.test(r.text)) {             // the model corrected its spec
          var pr = PART.parse(r.text);
          if (!pr.error) { var ex = PART.expand(pr.spec, o.tools); spec = ex.spec; p = { ex: ex }; specText = '```partspec\n' + JSON.stringify(stripPaths(spec)) + '\n```';
            onStep({ phase: 'planned', attempt: attempt, spec: spec, sheet: ex.sheet, notes: ex.notes, revised: true }); }
        }
        if (!src) {
          var rep0 = { ok: false, errs: ['NO PROGRAM IN THE ANSWER'], crashes: [], warns: [], text: 'NO PROGRAM IN THE ANSWER' };
          onStep({ phase: 'checked', attempt: attempt, report: rep0 });
          if (attempt >= rounds) return done();
          attempt++;
          return write(p, last || { src: '', specText: null }, 'Your answer contained no program. Reply with the complete program in one ```klartext fence.');
        }
        var report = o.verify ? o.verify(src) : { ok: true, errs: [], crashes: [], warns: [], text: '' };
        onStep({ phase: 'checked', attempt: attempt, report: report, src: src });
        var meas = null;
        if (plan && spec && report.errs.length === 0) {
          try { meas = o.measure(spec, src); } catch (e) { meas = null; }
          if (meas) onStep({ phase: 'measured', attempt: attempt, measure: meas, src: src });
        }
        var cand = { src: src, report: report, measure: meas, specText: specText };
        if (!best || rank(cand) > rank(best)) best = cand;
        var good = report.ok && (!meas || meas.score == null || meas.score >= goal);
        if (good || attempt >= rounds) return done();
        attempt++;
        var fb = (report.ok ? '' : 'The simulator reported:\n' + report.text + '\n\n') +
          (meas ? meas.text + '\n\nChange the program so the cut matches the spec: cut what is NOT CUT, stop cutting where it SHOULD NOT. ' +
            'If the spec itself does not describe what was asked, send a corrected ```partspec before the program.\n\n' : '') +
          (report.warns && report.warns.length && report.ok ? 'Warnings:\n' + report.warns.join('\n') + '\n\n' : '') +
          'Return the complete corrected program.';
        /* a refinement that fails (timeout, network, provider error) keeps the best program so far; a cancel does not */
        return write(p, cand, fb).catch(function (e) {
          if (e && e.name === 'AbortError') throw e;
          onStep({ phase: 'failed', attempt: attempt, error: String(e && e.message || e) });
          return done();
        });
      });
    }
    if (!plan) return write(null, null, null);
    return planStep(null).then(function (p) { attempt = 0; return write(p, null, null); });
  }
  function stripPaths(sp) { return { blank: sp.blank, features: (sp.features || []).map(function (f) { var c = Object.assign({}, f); delete c.paths; if (c.text != null && c.type === 'engrave') c.type = 'text'; return c; }) }; }

  return { DEFAULT_MODEL: DEFAULT_MODEL, RECOMMENDED: RECOMMENDED, FRONTIER_PROVIDERS: FRONTIER_PROVIDERS, FALLBACK_SYSTEM: FALLBACK_SYSTEM,
    listModels: listModels, providerName: providerName, _normalize: normalize, _frontier: frontier,
    generate: generate, toolSheet: toolSheet, chatFull: chatFull, testKey: testKey, extract: extract, system: system,
    _sseLine: sseLine, _sseFeed: sseFeed /* internal: exposed only so tests can drive the SSE parser without a network call */ };
})();
if (typeof module !== 'undefined') module.exports = TNC_AI;
