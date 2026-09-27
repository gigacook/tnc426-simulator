/* ============================================================
   TNC_AI — the third way to make a program: describe it, an AI writes it.
   OpenRouter only (BYOK). Plain fetch, no SDK, no server.
   The key lives in this browser (sessionStorage, or localStorage if the
   operator ticks Remember), or comes from .env in the gitignored local build.

   TNC_AI.DEFAULT_MODEL
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
  // checked against https://openrouter.ai/api/v1/models on 2026-09-27: $0.035 / M in, $0.29 / M out
  var DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';
  var MODELS = ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4-pro-0813', 'google/gemini-3.8-flash', 'openai/gpt-5.6-luna'];

  function headers(key) {
    var h = { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'X-Title': 'TNC 426 Simulator' };
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
    return fetch(API + '/key', { headers: headers(key) }).then(function (res) {
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
  function chat(o) {
    var onProgress = o.onProgress || function () {};
    var timeoutMs = o.timeoutMs || 600000; // 10 min: reasoning models can run long before the first content token
    var text = '', reasoning = '', usage = null, streamErr = null, timedOut = false;
    var start = Date.now();
    var ac = new AbortController();
    var to = setTimeout(function () { timedOut = true; ac.abort(); }, timeoutMs);
    if (o.signal) { if (o.signal.aborted) ac.abort(); else o.signal.addEventListener('abort', function () { ac.abort(); }); }
    var tick = setInterval(function () {
      onProgress({ secs: (Date.now() - start) / 1000, chars: text.length, reasoningChars: reasoning.length,
        stage: text.length ? 'writing' : 'thinking', text: text, reasoningTail: reasoning.slice(-400) });
    }, 500);
    function cleanup() { clearTimeout(to); clearInterval(tick); }
    function onEvent(obj) {
      if (obj.error) { streamErr = streamErr || dataError(obj); return; }
      var d = obj.choices && obj.choices[0] && obj.choices[0].delta;
      if (d) {
        if (d.content) text += d.content;
        if (d.reasoning) reasoning += d.reasoning; // OpenRouter puts reasoning-model "thinking" tokens here
      }
      if (obj.usage) usage = obj.usage;
    }

    return fetch(API + '/chat/completions', {
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
          buf = sseFeed(buf, decoder.decode(r.value, { stream: true }), onEvent);
          if (streamErr) throw streamErr;
          return pump();
        });
      }
      return pump();
    }).then(function () {
      cleanup();
      if (streamErr) throw streamErr;
      if (!text && reasoning) { var e = new Error('THE MODEL ANSWERED WITH REASONING ONLY, NO FINAL TEXT (' + reasoning.length + ' chars) — try a lower reasoning effort or a non-reasoning model'); e.status = 502; throw e; }
      if (!text) { var e2 = new Error('EMPTY ANSWER FROM THE MODEL'); e2.status = 502; throw e2; }
      return { text: text, cost: (usage && +usage.cost) || 0 };
    }).catch(function (e) {
      cleanup();
      if (e && e.name === 'AbortError') {
        if (timedOut) { var te = new Error('TIMED OUT WAITING FOR THE MODEL (' + Math.round((Date.now() - start) / 1000) + 's)'); te.status = 0; throw te; }
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

  function system(tools) {
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
'TOOL TABLE (T name radius) — nothing else exists:',
toolLine(tools),
'Cones (spot, chamfer) cut a 45 degree flank. Probes never cut.',
'',
'SAFETY RULES THE SIMULATOR ENFORCES (a violation is reported as a crash)',
'1. No FMAX into uncut stock: FMAX over the part only at Z+2 or higher; feed into the cut; FMAX back to Z+2 before any XY rapid.',
'2. No cutting move without M3/M4 since the last TOOL CALL.',
'3. Going below the blank is allowed (through holes, taps); the holder must never reach the part: stick-out = tool length L minus the holder A dimension.',
'4. Chip load for end mills (3 flutes) and face mills (5): F / (S x flutes) <= 0.012 x D + 0.005.',
'   Safe: T9 S8000 F900 | T4 S3000 F500 | T5 S3000 F1000 | T6 S1200 F2000. Drills: T1 S2000 Q206=+100, T2 S1800 Q206=+150.',
'Plunge at F100-F200. Keep every cut within the blank.',
'',
'ERRORS',
'If you get an error report from the simulator (each with a block number; BEGIN PGM is block 0; a CYCL DEF with its Q lines is one block),',
'find the cause and return the COMPLETE corrected program, same format, nothing outside the fence.'
    ].join('\n');
  }
  var FALLBACK_SYSTEM = system([]);

  function generate(o) {
    var model = o.model || DEFAULT_MODEL, onStep = o.onStep || function () {}, repairs = o.maxRepairs == null ? 1 : o.maxRepairs;
    var messages = [{ role: 'system', content: o.system || system(o.tools) },
                    { role: 'user', content: 'Write the program for this part:\n\n' + o.prompt }];
    var cost = 0, attempt = 0, last = null;
    function step() {
      var req = { key: o.key, model: model, messages: messages, signal: o.signal, timeoutMs: o.timeoutMs, reasoning: o.reasoning, maxTokens: o.maxTokens };
      onStep({ phase: 'request', attempt: attempt, body: JSON.parse(JSON.stringify(requestBody(req))) });
      return chat(Object.assign(req, {
        onProgress: function (p) { onStep({ phase: 'progress', attempt: attempt, secs: p.secs, chars: p.chars, reasoningChars: p.reasoningChars, stage: p.stage, text: p.text, reasoningTail: p.reasoningTail }); }
      })).then(function (r) {
        cost += r.cost;
        var src = extract(r.text);
        if (!src) {
          var rep0 = { ok: false, errs: ['NO PROGRAM IN THE ANSWER'], crashes: [], warns: [], text: 'NO PROGRAM IN THE ANSWER' };
          onStep({ phase: 'checked', attempt: attempt, report: rep0 });
          if (attempt >= repairs) { var e = new Error('THE MODEL DID NOT RETURN A PROGRAM'); e.status = 0; throw e; }
          messages.push({ role: 'assistant', content: r.text });
          messages.push({ role: 'user', content: 'Your answer contained no program. Reply with the complete program in one ```klartext fence only.' });
          attempt++; return step();
        }
        var report = o.verify ? o.verify(src) : { ok: true, errs: [], crashes: [], warns: [], text: '' };
        last = { src: src, report: report };
        onStep({ phase: 'checked', attempt: attempt, report: report, src: src });
        if (report.ok || attempt >= repairs) return { src: src, report: report, cost: cost, attempts: attempt + 1 };
        messages.push({ role: 'assistant', content: '```klartext\n' + src + '\n```' });
        messages.push({ role: 'user', content: 'The simulator reported:\n' + report.text + '\n\nReturn the complete corrected program.' });
        attempt++; return step();
      });
    }
    return step();
  }

  return { DEFAULT_MODEL: DEFAULT_MODEL, MODELS: MODELS, FALLBACK_SYSTEM: FALLBACK_SYSTEM,
    generate: generate, testKey: testKey, extract: extract, system: system,
    _sseLine: sseLine, _sseFeed: sseFeed /* internal: exposed only so tests can drive the SSE parser without a network call */ };
})();
if (typeof module !== 'undefined') module.exports = TNC_AI;
