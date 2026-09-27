/* ==========================================================================
 * TNC 426 simulator -- flow.js
 * Renders a TNC.run() result as a vertical flowchart: one card per block (or
 * small group of consecutive motion blocks), read top to bottom like the
 * Klartext program itself, with loop-back / subprogram jump lanes on the
 * right and true TNC semantics in plain shop language.
 *
 * TECHNOLOGY DECISION (see RELEASES.txt for the short version):
 *   Hand-rolled column layout, rendered as inline SVG + a couple of
 *   foreignObjects for word-wrapped text. No D2, Mermaid, dagre, Cytoscape,
 *   ELK or Graphviz/WASM.
 *   - D2 (@terrastruct/d2, the WASM build): the d2.wasm binary alone is
 *     ~22 MB (measured: `npm pack @terrastruct/d2@0.1.33`, 21.3 MB tarball,
 *     dist/node-esm/d2.wasm = 22,072,784 bytes). That alone blows the "one
 *     self-contained offline HTML file" budget by more than an order of
 *     magnitude, needs WASM instantiation at runtime, is a batch
 *     text->diagram compiler (not built for per-block click/highlight),
 *     and ships no notion of "this is the currently executing node."
 *     MPL-2.0 -- fine, but irrelevant given the size. Rejected on size and
 *     interaction-model grounds alone.
 *   - Mermaid: real browser runtime, MIT, but its own minified bundle is
 *     ~3.3 MB (measured via the jsdelivr dist) for a general-purpose
 *     diagram grammar we would fight to get TNC-specific loop lanes,
 *     rapid/feed styling, per-node error badges and live highlight/click
 *     out of. Its layout re-runs dagre-style graph layout on every update,
 *     which is more than a 180-block linear program needs.
 *   - dagre / @dagrejs/dagre: small (MIT, ~0.3-1.4 MB unpacked, layout
 *     only, no renderer) and a legitimate option -- but a Klartext program
 *     is not a general graph, it is a straight line with the occasional
 *     loop-back edge. A general force/rank layout is the wrong tool: it
 *     will happily reflow the whole column sideways to shorten a loop
 *     edge, which is exactly the "code reads top to bottom" property we
 *     must not lose.
 *   - Cytoscape.js (+dagre), Graphviz-in-WASM (viz.js / @hpcc-js/wasm):
 *     same shape of problem as D2, worse or comparable size (viz.js WASM
 *     alone ~3.4 MB; @hpcc-js/wasm unpacked ~37 MB across its multiple
 *     WASM backends), general-purpose graph renderers with no notion of
 *     "block index" or TNC semantics, and no first-class click/highlight
 *     wiring -- all of that would be built on top regardless.
 *   - ELK.js: EPL-2.0/GPL dual license (friction for a project that wants
 *     the vendored code to be clearly MIT/BSD/Apache/ISC), ~8 MB unpacked,
 *     same "general layered graph" mismatch as dagre.
 *   DECISION: a Klartext program is fundamentally a linear column with
 *   occasional loop/jump edges into a side lane -- exactly the case where
 *   a ~700-line hand-rolled layout beats a general graph library: zero
 *   added weight, full control over TNC semantics (loop = r+1, subprogram
 *   = jump+return, rapid vs feed styling, error badges, per-node click),
 *   deterministic non-DOM-measuring layout (fast and stable for a
 *   180-block program), and total offline self-containment.
 *
 * Plain browser JS (ES5-ish), no modules. describe() and pathSVG() are pure
 * DOM-building helpers usable from Node (with a DOM, e.g. jsdom, for
 * pathSVG/create) or, for describe(), with no DOM at all.
 * Exposes a single global: TNC_FLOW  { create, describe, pathSVG }
 * ========================================================================== */

var TNC_FLOW = (function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var XLINKNS = 'http://www.w3.org/1999/xlink';

  var COL = {
    ground: '#02050a', panel2: '#070b12', panel: '#161d29', line: '#3a4655',
    ink: '#f2f6fb', dim: '#b3bfd0', cyan: '#6fdcff', amber: '#ffb03a',
    mint: '#63e6b0', red: '#ff5347', violet: '#a596ff'
  };

  var MDESC = {
    2: 'PROGRAM END', 3: 'SPINDLE CW START', 4: 'SPINDLE CCW START', 5: 'SPINDLE STOP',
    6: 'TOOL CHANGE', 8: 'COOLANT ON', 9: 'COOLANT OFF', 13: 'SPINDLE CW + COOLANT ON',
    14: 'SPINDLE CCW + COOLANT ON', 30: 'PROGRAM END', 99: 'CYCLE CALL',
    128: 'TCPM ON (TILTED-PLANE MACHINING)', 129: 'TCPM OFF'
  };

  /* ---------------------------------------------------------------- formatting */

  function fmtQ(v) {
    if (v === null || v === undefined) return '?';
    if (typeof v === 'object') return (v.neg ? '-Q' : 'Q') + v.q;
    if (!isFinite(v)) return '?';
    var r = Math.round(v * 1000) / 1000;
    return String(r);
  }
  function fmtSigned(v) {
    if (v === null || v === undefined) return '?';
    if (typeof v === 'object') return (v.neg ? '-Q' : '+Q') + v.q;
    if (!isFinite(v)) return '?';
    var r = Math.round(v * 1000) / 1000;
    return (r >= 0 ? '+' : '') + r;
  }
  function describeMWord(code) { return 'M' + code + (MDESC[code] ? ': ' + MDESC[code] : ''); }
  function describeMWordShort(code) { return 'M' + code; }

  function hasAnyAxis(a) {
    return a.x !== undefined || a.y !== undefined || a.z !== undefined ||
           a.ix !== undefined || a.iy !== undefined || a.iz !== undefined;
  }
  function axesTxt(a) {
    var s = '';
    ['x', 'y', 'z'].forEach(function (k) {
      if (a[k] !== undefined) s += ' ' + k.toUpperCase() + fmtSigned(a[k]);
      if (a['i' + k] !== undefined) s += ' I' + k.toUpperCase() + fmtSigned(a['i' + k]);
    });
    return s;
  }
  // Forward-compat with a 5-axis (TNC 430-style) profile: rotary A/B/C words
  // and M128/M129 TCPM, described in plain words if a future core.js starts
  // putting them into block.args.
  function rotaryTxt(a) {
    var parts = [];
    ['a', 'b', 'c'].forEach(function (k) {
      if (a[k] !== undefined) parts.push(k.toUpperCase() + fmtSigned(a[k]) + (typeof a[k] === 'number' ? '°' : ''));
    });
    var s = parts.length ? ('  — tilt/rotate: ' + parts.join(', ')) : '';
    if (a.m && a.m.indexOf(128) >= 0) s += '  [M128 TCPM ON]';
    if (a.m && a.m.indexOf(129) >= 0) s += '  [M129 TCPM OFF]';
    return s;
  }

  function describeCycleParams(list) {
    var out = [];
    list.forEach(function (p) {
      if (p.args.dot) out.push('.' + p.args.q + '=' + (p.args.values || []).join(','));
      else out.push('Q' + p.args.q + '=' + fmtQ(p.args.value) + (p.args.comment ? ' (' + p.args.comment + ')' : ''));
    });
    return out.join('  ·  ');
  }

  function describeMotionLine(b) {
    var a = b.args, rot = rotaryTxt(a);
    if (b.kind === 'CC') return { text: 'SET CIRCLE CENTRE' + axesTxt(a) + rot, rapid: false, feed: false };
    var mSuf = a.m ? '  ' + a.m.map(describeMWordShort).join(' ') : '';
    if (b.kind === 'L') {
      if (!hasAnyAxis(a)) return { text: a.m ? ('M-FUNCTION' + mSuf) : 'NO-OP', rapid: false, feed: false };
      var fmax = !!a.fmax;
      var mode = fmax ? 'RAPID (FMAX)' : ('FEED (F' + (a.f !== undefined ? fmtQ(a.f) : 'modal') + ')');
      return { text: mode + ' to' + axesTxt(a) + rot + mSuf, rapid: fmax, feed: !fmax };
    }
    if (b.kind === 'C') {
      var dir = a.dr === '-' ? 'CW' : 'CCW';
      return { text: 'ARC (' + dir + ', about last CC) to' + axesTxt(a) + rot + mSuf, rapid: false, feed: true };
    }
    if (b.kind === 'CR') {
      var dir2 = a.dr === '-' ? 'CW' : 'CCW';
      return { text: 'ARC (' + dir2 + ', R' + fmtQ(a.r) + ') to' + axesTxt(a) + rot + mSuf, rapid: false, feed: true };
    }
    return { text: b.raw || (b.kind + ' (unrecognised)'), rapid: false, feed: false };
  }

  /* ---------------------------------------------------------------- describe() */

  function describe(res) {
    var blocks = (res && res.blocks) || [];
    var errByBlock = {};
    ((res && res.errors) || []).forEach(function (e) {
      (errByBlock[e.block] = errByBlock[e.block] || []).push(e.msg);
    });
    function mergeErr(idxs) {
      var msgs = [];
      idxs.forEach(function (i) { if (errByBlock[i]) msgs = msgs.concat(errByBlock[i]); });
      return msgs.length ? msgs.join('; ') : undefined;
    }

    var labelIdx = {};
    blocks.forEach(function (b, i) {
      if (b && b.kind === 'LBL' && labelIdx[b.args.lbl] === undefined) labelIdx[b.args.lbl] = i;
    });

    var MOTION_KINDS = { L: 1, C: 1, CR: 1, CC: 1 };
    var nodes = [];
    var seq = 0;
    function mk(kind, idxs, title, detail, loop, extra) {
      var n = {
        id: 'n' + (seq++), kind: kind, blocks: idxs.slice(),
        title: title, detail: detail || ''
      };
      if (loop) n.loop = loop;
      var err = mergeErr(idxs);
      if (err) n.error = err;
      if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) n[k] = extra[k];
      return n;
    }

    var i = 0;
    while (i < blocks.length) {
      var b = blocks[i];
      if (!b) { i++; continue; }

      if (b.kind === 'BLANK') { i++; continue; }

      if (b.kind === 'COMMENT') {
        var txt = (b.args.comment || '').trim();
        var isHeading = /-{3,}/.test(txt) && /\S/.test(txt.replace(/-/g, ''));
        nodes.push(mk(isHeading ? 'heading' : 'comment', [i],
          isHeading ? txt.replace(/^-+\s*/, '').replace(/\s*-+$/, '') : 'NOTE',
          isHeading ? '' : txt));
        i++; continue;
      }

      if (b.kind === 'BEGIN') {
        nodes.push(mk('begin', [i], 'PROGRAM START', 'PGM ' + b.args.name + ' ' + (b.args.unit || 'MM')));
        i++; continue;
      }
      if (b.kind === 'END') {
        nodes.push(mk('end', [i], 'PROGRAM END', 'PGM ' + b.args.name));
        i++; continue;
      }

      if (b.kind === 'BLK1' || b.kind === 'BLK2') {
        var blks = [i], det, j = i + 1;
        if (b.kind === 'BLK1' && blocks[j] && blocks[j].kind === 'BLK2') {
          det = 'STOCK  X ' + fmtQ(b.args.x) + '..' + fmtQ(blocks[j].args.x) +
                '  Y ' + fmtQ(b.args.y) + '..' + fmtQ(blocks[j].args.y) +
                '  Z ' + fmtQ(b.args.z) + '..' + fmtQ(blocks[j].args.z);
          blks.push(j); j++;
        } else {
          det = 'MIN CORNER  X' + fmtQ(b.args.x) + ' Y' + fmtQ(b.args.y) + ' Z' + fmtQ(b.args.z);
        }
        nodes.push(mk('stock', blks, 'BLANK / STOCK DEFINITION', det));
        i = j; continue;
      }

      if (b.kind === 'TOOLCALL') {
        var tt = fmtQ(b.args.t);
        var sTxt = (b.args.s !== null && b.args.s !== undefined) ? (' S' + fmtQ(b.args.s)) : '';
        nodes.push(mk('toolchange', [i], 'TOOL CHANGE — T' + tt,
          'Spindle stops. New tool loaded' + sTxt + '. Tool axis ' + (b.args.axis || '?') + '.'));
        i++; continue;
      }

      if (b.kind === 'CYCLDEF') {
        var cblks = [i], paramLines = [], jj = i + 1;
        while (jj < blocks.length) {
          var pb = blocks[jj];
          if (!pb) break;
          if (pb.kind === 'BLANK' || pb.kind === 'COMMENT') { jj++; continue; }
          if (pb.kind !== 'CYCLPARM') break;
          cblks.push(jj); paramLines.push(pb); jj++;
        }
        var num = b.args.num, name = (b.args.name || '').trim(), title, detail;
        if (num === 19) { title = 'WORKING PLANE (TILT)'; detail = describeCycleParams(paramLines) || 'Tilts the working plane for the moves that follow.'; }
        else if (num === 7) { title = 'DATUM SHIFT'; detail = describeCycleParams(paramLines) || 'Shifts the datum (origin) for the moves that follow.'; }
        else if (num === 10) { title = 'ROTATION'; detail = describeCycleParams(paramLines) || 'Rotates the working coordinate system.'; }
        else { title = 'DEFINE CYCLE ' + num + (name ? ' ' + name : ''); detail = describeCycleParams(paramLines) || 'Sets up cycle parameters; does not move the tool.'; }
        nodes.push(mk('cycledef', cblks, title, detail));
        i = jj; continue;
      }
      if (b.kind === 'CYCLPARM') { i++; continue; }   // orphan safety; normally consumed above

      if (b.kind === 'CYCLCALL') {
        nodes.push(mk('cyclecall', [i], 'RUN CYCLE (CYCL CALL)',
          'Executes the last CYCL DEF at the current X/Y position.' + (b.args.m ? '  ' + b.args.m.map(describeMWordShort).join(' ') : '')));
        i++; continue;
      }

      if (b.kind === 'LBL') {
        nodes.push(mk('label', [i], 'LABEL ' + b.args.lbl, 'Start of section / subprogram LBL ' + b.args.lbl + '.'));
        i++; continue;
      }
      if (b.kind === 'LBLEND') {
        nodes.push(mk('lblend', [i], 'LBL 0 — END OF SUBPROGRAM', 'Returns to whoever called this subprogram.'));
        i++; continue;
      }

      if (b.kind === 'CALLLBL') {
        var lbl = b.args.lbl, rep = b.args.rep || 1, target = labelIdx[lbl];
        var isLoop = !!(b.args.repProg && target !== undefined && target < i);
        if (isLoop) {
          var times = rep + 1;
          nodes.push(mk('loop-call', [i], 'REPEAT SECTION FROM LABEL ' + lbl,
            'Runs the blocks between LBL ' + lbl + ' and here ' + times +
            ' times in total (REP ' + rep + ' + the pass that already ran once).',
            { from: target, to: i, times: times }));
        } else {
          var timesTxt = (rep > 1) ? (' × ' + rep + ' times') : '';
          nodes.push(mk('subcall', [i], 'CALL SUBPROGRAM LBL ' + lbl,
            (target === undefined ? ('LABEL ' + lbl + ' NOT FOUND.') :
              ('Jumps to LBL ' + lbl + ', runs to its LBL 0, then returns here' + timesTxt + '.')),
            { from: (target !== undefined ? target : i), to: i, times: rep, sub: true }));
        }
        i++; continue;
      }

      if (b.kind === 'FN') {
        var a2 = b.args;
        var isCounter = (a2.fn === 1 || a2.fn === 2) && a2.a && typeof a2.a === 'object' && a2.a.q === a2.target;
        var opWord = { '+': '+', '-': '-', '*': '×', '/': '÷' }[a2.op] || (a2.op || '');
        var exprTxt = (a2.fn === 0) ? ('Q' + a2.target + ' = ' + fmtQ(a2.a))
                                     : ('Q' + a2.target + ' = ' + fmtQ(a2.a) + ' ' + opWord + ' ' + fmtQ(a2.b));
        if (isCounter) exprTxt += '  (DEPTH / PASS COUNTER — changes by ' + fmtQ(a2.b) + ' each time through)';
        nodes.push(mk('fn', [i], 'CALCULATE Q' + a2.target, exprTxt));
        i++; continue;
      }

      if (b.kind === 'STOP') {
        var isEnd = b.args.m && (b.args.m.indexOf(2) >= 0 || b.args.m.indexOf(30) >= 0);
        nodes.push(mk('stop', [i], isEnd ? 'PROGRAM END (M2/M30)' : 'OPTIONAL STOP',
          (b.args.m || []).map(describeMWord).join('; ') || 'Halts until the operator presses START.'));
        i++; continue;
      }

      if (MOTION_KINDS[b.kind]) {
        var midxs = [], k2 = i, cap = 10, anyRapid = false, anyFeed = false, mWords = [], lines = [];
        while (k2 < blocks.length && blocks[k2] && MOTION_KINDS[blocks[k2].kind] && midxs.length < cap) {
          var mb = blocks[k2];
          var d = describeMotionLine(mb);
          lines.push('N' + (mb.n !== null && mb.n !== undefined ? mb.n : k2) + '  ' + d.text);
          if (d.rapid) anyRapid = true;
          if (d.feed) anyFeed = true;
          if (mb.args.m) mWords = mWords.concat(mb.args.m);
          midxs.push(k2); k2++;
        }
        var moveKind = anyRapid && anyFeed ? 'mixed' : anyRapid ? 'rapid' : anyFeed ? 'feed' : 'none';
        var tag = moveKind === 'mixed' ? 'RAPID + FEED' : moveKind === 'rapid' ? 'RAPID (POSITIONING)' :
                  moveKind === 'feed' ? 'FEED (CUTTING)' : 'POSITION SET';
        var mTitle = (midxs.length === 1 ? tag + ' MOVE' : midxs.length + ' MOVES — ' + tag) +
                     (mWords.length ? ('  [' + mWords.map(describeMWord).join(', ') + ']') : '');
        nodes.push(mk('motion', midxs, mTitle, lines.join('\n'), null, { moveKind: moveKind }));
        i = k2; continue;
      }

      // Fallback for UNKNOWN or any block kind this build doesn't specifically
      // know yet (forward-compat: never throw, just show the raw text).
      nodes.push(mk('raw', [i], b.kind === 'UNKNOWN' ? 'UNRECOGNISED BLOCK' : (b.kind || 'BLOCK'), b.raw || ''));
      i++;
    }

    return nodes;
  }

  /* ---------------------------------------------------------------- pathSVG() */

  function addArrow(g, x, y, ang, color) {
    var size = 5;
    var p1x = x + Math.cos(ang) * size, p1y = y + Math.sin(ang) * size;
    var p2x = x + Math.cos(ang + 2.6) * size * 0.6, p2y = y + Math.sin(ang + 2.6) * size * 0.6;
    var p3x = x + Math.cos(ang - 2.6) * size * 0.6, p3y = y + Math.sin(ang - 2.6) * size * 0.6;
    var poly = document.createElementNS(SVGNS, 'polygon');
    poly.setAttribute('points', p1x + ',' + p1y + ' ' + p2x + ',' + p2y + ' ' + p3x + ',' + p3y);
    poly.setAttribute('fill', color);
    g.appendChild(poly);
  }

  // Renders segments (from TNC_SIM.expand()) belonging to `blockIndices` as a
  // small auto-fit top-view (or, for a pure Z move, a vertical arrow glyph)
  // with an animated "comet" travelling in the true direction of motion.
  function pathSVG(ex, blockIndices, opts) {
    opts = opts || {};
    var w = opts.width || 160, h = opts.height || 90;
    var reduced = !!opts.reducedMotion;
    var wanted = {};
    (blockIndices || []).forEach(function (bi) { wanted[bi] = 1; });
    var segs = ((ex && ex.segs) || []).filter(function (s) { return wanted[s.block]; });

    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', w); svg.setAttribute('height', h);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('class', 'tnc-flow-path');
    if (!segs.length) return svg;

    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    segs.forEach(function (s) {
      [s.a, s.b].forEach(function (p) {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      });
    });
    var vertical = (maxX - minX < 0.05) && (maxY - minY < 0.05);
    function projXY(p) { return { x: p.x, y: -p.y }; }
    function projZ(p) { return { x: 0, y: -p.z }; }
    var proj = vertical ? projZ : projXY;

    var raw = segs.map(function (s) {
      var A = proj(s.a), B = proj(s.b);
      return { x1: A.x, y1: A.y, x2: B.x, y2: B.y, kind: s.kind };
    });
    var bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity;
    raw.forEach(function (r) {
      bx0 = Math.min(bx0, r.x1, r.x2); bx1 = Math.max(bx1, r.x1, r.x2);
      by0 = Math.min(by0, r.y1, r.y2); by1 = Math.max(by1, r.y1, r.y2);
    });
    var pad = 10;
    var spanX = Math.max(1e-3, bx1 - bx0), spanY = Math.max(1e-3, by1 - by0);
    if (vertical) spanX = Math.max(spanX, 6);
    var scale = Math.min((w - 2 * pad) / spanX, (h - 2 * pad) / spanY);
    if (!isFinite(scale) || scale <= 0) scale = 1;
    var cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2;
    function tx(x) { return w / 2 + (x - cx) * scale; }
    function ty(y) { return h / 2 + (y - cy) * scale; }

    var g = document.createElementNS(SVGNS, 'g');
    svg.appendChild(g);

    var dParts = [];
    raw.forEach(function (r, idx) {
      var X1 = tx(r.x1), Y1 = ty(r.y1), X2 = tx(r.x2), Y2 = ty(r.y2);
      var line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', X1); line.setAttribute('y1', Y1);
      line.setAttribute('x2', X2); line.setAttribute('y2', Y2);
      line.setAttribute('stroke', r.kind === 'rapid' ? COL.amber : COL.cyan);
      line.setAttribute('stroke-width', '1.6');
      line.setAttribute('stroke-linecap', 'round');
      if (r.kind === 'rapid') line.setAttribute('stroke-dasharray', '3,2.4');
      g.appendChild(line);
      dParts.push((idx === 0 ? 'M' : 'L') + X1.toFixed(2) + ',' + Y1.toFixed(2));
      dParts.push('L' + X2.toFixed(2) + ',' + Y2.toFixed(2));
    });

    if (vertical) {
      // small directional arrow glyph off to the side of the vertical line
      var midIdx = raw.length - 1;
      var lastAng = raw[midIdx].y2 > raw[midIdx].y1 ? Math.PI / 2 : -Math.PI / 2;
      addArrow(g, tx(0) + 10, (ty(raw[0].y1) + ty(raw[midIdx].y2)) / 2, lastAng, raw[midIdx].kind === 'rapid' ? COL.amber : COL.cyan);
    }

    if (reduced) {
      raw.forEach(function (r) {
        var mx = (tx(r.x1) + tx(r.x2)) / 2, my = (ty(r.y1) + ty(r.y2)) / 2;
        var ang = Math.atan2(ty(r.y2) - ty(r.y1), tx(r.x2) - tx(r.x1));
        addArrow(g, mx, my, ang, r.kind === 'rapid' ? COL.amber : COL.cyan);
      });
      return svg;
    }

    var pathD = dParts.join(' ');
    var mpathId = 'tncflowpath' + Math.random().toString(36).slice(2);
    var hiddenPath = document.createElementNS(SVGNS, 'path');
    hiddenPath.setAttribute('d', pathD);
    hiddenPath.setAttribute('id', mpathId);
    hiddenPath.setAttribute('fill', 'none');
    hiddenPath.setAttribute('stroke', 'none');
    svg.appendChild(hiddenPath);

    var totalLen = 0;
    raw.forEach(function (r) { totalLen += Math.hypot(tx(r.x2) - tx(r.x1), ty(r.y2) - ty(r.y1)); });
    var dur = Math.max(1.2, Math.min(4, totalLen / 40 || 1.5));
    var tailN = 4;
    for (var t = tailN; t >= 0; t--) {
      var c = document.createElementNS(SVGNS, 'circle');
      c.setAttribute('r', t === 0 ? 2.6 : 2.0);
      c.setAttribute('fill', COL.ink);
      c.setAttribute('opacity', (t === 0 ? 1 : Math.max(0.08, 0.5 - (t - 1) * 0.13)).toFixed(2));
      var anim = document.createElementNS(SVGNS, 'animateMotion');
      anim.setAttribute('dur', dur + 's');
      anim.setAttribute('repeatCount', 'indefinite');
      anim.setAttribute('begin', (-(t * dur / (tailN * 3.2))).toFixed(3) + 's');
      anim.setAttribute('rotate', 'auto');
      var mpath = document.createElementNS(SVGNS, 'mpath');
      mpath.setAttributeNS(XLINKNS, 'href', '#' + mpathId);
      mpath.setAttribute('href', '#' + mpathId);
      anim.appendChild(mpath);
      c.appendChild(anim);
      g.appendChild(c);
    }
    return svg;
  }

  /* ---------------------------------------------------------------- view (DOM) */

  function estimateLines(text, charsPerLine) {
    if (!text) return 0;
    var total = 0;
    String(text).split('\n').forEach(function (l) { total += Math.max(1, Math.ceil(l.length / charsPerLine)); });
    return total;
  }

  function kindColor(n) {
    if (n.error) return COL.red;
    switch (n.kind) {
      case 'begin': case 'end': return COL.mint;
      case 'toolchange': case 'stop': return COL.violet;
      case 'motion':
        return n.moveKind === 'rapid' ? COL.amber : COL.cyan;
      case 'cycledef': case 'cyclecall': return COL.mint;
      case 'loop-call': return COL.mint;
      case 'subcall': return COL.violet;
      case 'fn': return COL.cyan;
      case 'label': case 'lblend': case 'comment': return COL.dim;
      case 'raw': return COL.red;
      default: return COL.line;
    }
  }

  function nodeHasMotionSegs(n, ex) {
    if (!ex || !ex.segs || !ex.segs.length) return false;
    for (var i = 0; i < ex.segs.length; i++) if (n.blocks.indexOf(ex.segs[i].block) >= 0) return true;
    return false;
  }

  function reducedMotionPref() {
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function create(container, opts) {
    opts = opts || {};
    while (container.firstChild) container.removeChild(container.firstChild);

    var wrapper = document.createElement('div');
    wrapper.className = 'tnc-flow-wrap';
    wrapper.style.cssText = 'position:relative;width:100%;height:100%;overflow:auto;' +
      'background:' + COL.panel2 + ';box-sizing:border-box;';
    container.appendChild(wrapper);

    var svg = document.createElementNS(SVGNS, 'svg');
    svg.style.cssText = 'display:block;width:100%;';
    wrapper.appendChild(svg);

    var state = { nodes: [], res: null, ex: null, highlightIdx: null };
    var view = { onSelect: null };
    var lastLaid = [];

    function blockBadge(n) {
      var blocks = state.res && state.res.blocks;
      if (!blocks || !n.blocks.length) return '';
      function label(i) { var b = blocks[i]; return 'N' + (b && b.n !== null && b.n !== undefined ? b.n : i); }
      var first = n.blocks[0], last = n.blocks[n.blocks.length - 1];
      return first === last ? label(first) : (label(first) + '–' + label(last));
    }

    function findNodeIdxForBlock(nodes, bi) {
      if (bi === null || bi === undefined) return null;
      for (var k = 0; k < nodes.length; k++) if (nodes[k].blocks.indexOf(bi) >= 0) return k;
      return null;
    }

    function drawConnector(prevL, curL, xMid) {
      var y1 = prevL.y + prevL.h, y2 = curL.y;
      if (y2 <= y1) return;
      var line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', xMid); line.setAttribute('y1', y1);
      line.setAttribute('x2', xMid); line.setAttribute('y2', y2);
      line.setAttribute('stroke', COL.line); line.setAttribute('stroke-width', '1.4');
      svg.appendChild(line);
    }

    function findLaidIdxForBlock(laid, bi) {
      for (var k = 0; k < laid.length; k++) if (laid[k].node.blocks.indexOf(bi) >= 0) return k;
      return -1;
    }

    function drawLoopEdge(laid, node, callIdx, margin, cardW, laneW) {
      var fromIdx = findLaidIdxForBlock(laid, node.loop.from);
      if (fromIdx < 0) return;
      var laneX = margin + cardW + laneW * 0.6;
      var rightEdge = margin + cardW;
      var yTop = laid[fromIdx].y + laid[fromIdx].h / 2;
      var yBot = laid[callIdx].y + laid[callIdx].h / 2;
      var color = node.loop.sub ? COL.violet : COL.mint;
      var path = document.createElementNS(SVGNS, 'path');
      var d = 'M' + rightEdge + ',' + yBot + ' C ' + laneX + ',' + yBot + ' ' + laneX + ',' + yTop + ' ' + rightEdge + ',' + yTop;
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', color);
      path.setAttribute('stroke-width', '1.4');
      if (node.loop.sub) path.setAttribute('stroke-dasharray', '4,3');
      svg.appendChild(path);
      addArrow(svg, rightEdge + 1, yTop, Math.PI, color);
      var label = document.createElementNS(SVGNS, 'text');
      label.setAttribute('x', laneX + 3);
      label.setAttribute('y', (yTop + yBot) / 2);
      label.setAttribute('fill', color);
      label.setAttribute('font-size', '9');
      label.setAttribute('font-family', '"IBM Plex Mono",monospace');
      label.setAttribute('transform', 'rotate(90 ' + (laneX + 3) + ' ' + ((yTop + yBot) / 2) + ')');
      label.setAttribute('text-anchor', 'middle');
      label.textContent = '×' + node.loop.times;
      svg.appendChild(label);
    }

    function drawNode(L, idx, margin, cardW) {
      var n = L.node, x = margin, y = L.y, w = cardW, h = L.h;
      var g = document.createElementNS(SVGNS, 'g');
      g.setAttribute('class', 'tnc-flow-node' + (state.highlightIdx === idx ? ' tnc-flow-hi' : ''));
      g.setAttribute('data-idx', String(idx));

      if (n.kind === 'heading') {
        var htext = document.createElementNS(SVGNS, 'text');
        htext.setAttribute('x', x); htext.setAttribute('y', y + 18);
        htext.setAttribute('fill', COL.dim);
        htext.setAttribute('font-family', '"Saira Condensed",sans-serif');
        htext.setAttribute('font-size', '13');
        htext.setAttribute('letter-spacing', '.08em');
        htext.textContent = (n.title || '').toUpperCase();
        g.appendChild(htext);
        var hr = document.createElementNS(SVGNS, 'line');
        hr.setAttribute('x1', x); hr.setAttribute('x2', x + w);
        hr.setAttribute('y1', y + 24); hr.setAttribute('y2', y + 24);
        hr.setAttribute('stroke', COL.line);
        g.appendChild(hr);
        svg.appendChild(g);
        return;
      }

      var rect = document.createElementNS(SVGNS, 'rect');
      rect.setAttribute('x', x); rect.setAttribute('y', y);
      rect.setAttribute('width', w); rect.setAttribute('height', h);
      rect.setAttribute('rx', 5);
      rect.setAttribute('fill', COL.panel);
      rect.setAttribute('stroke', n.error ? COL.red : (state.highlightIdx === idx ? COL.ink : COL.line));
      rect.setAttribute('stroke-width', state.highlightIdx === idx ? '2' : '1');
      g.appendChild(rect);

      var stripe = document.createElementNS(SVGNS, 'rect');
      stripe.setAttribute('x', x); stripe.setAttribute('y', y);
      stripe.setAttribute('width', 4); stripe.setAttribute('height', h);
      stripe.setAttribute('fill', kindColor(n));
      g.appendChild(stripe);

      var title = document.createElementNS(SVGNS, 'text');
      title.setAttribute('x', x + 14); title.setAttribute('y', y + 18);
      title.setAttribute('fill', COL.ink);
      title.setAttribute('font-family', '"Saira Condensed",sans-serif');
      title.setAttribute('font-size', '13');
      title.setAttribute('font-weight', '600');
      title.textContent = n.title;
      g.appendChild(title);

      var badge = document.createElementNS(SVGNS, 'text');
      badge.setAttribute('x', x + w - 8); badge.setAttribute('y', y + 18);
      badge.setAttribute('text-anchor', 'end');
      badge.setAttribute('fill', COL.dim);
      badge.setAttribute('font-family', '"IBM Plex Mono",monospace');
      badge.setAttribute('font-size', '10');
      badge.textContent = blockBadge(n);
      g.appendChild(badge);

      var foH = h - 30 - (L.expand ? 112 : 0);
      if (foH > 6) {
        var fo = document.createElementNS(SVGNS, 'foreignObject');
        fo.setAttribute('x', x + 12); fo.setAttribute('y', y + 24);
        fo.setAttribute('width', Math.max(10, w - 20)); fo.setAttribute('height', foH);
        var div = document.createElement('div');
        div.style.cssText = 'font:11px/1.4 "IBM Plex Mono","IBM Plex Sans",monospace;color:' + COL.dim +
          ';white-space:pre-wrap;word-break:break-word;';
        div.textContent = n.detail || '';
        if (n.error) {
          var errDiv = document.createElement('div');
          errDiv.style.cssText = 'color:' + COL.red + ';font-weight:600;margin-top:4px;font-family:"IBM Plex Sans",sans-serif;';
          errDiv.textContent = 'ERROR: ' + n.error;
          div.appendChild(errDiv);
        }
        fo.appendChild(div);
        g.appendChild(fo);
      }

      if (L.expand) {
        var previewBg = document.createElementNS(SVGNS, 'rect');
        previewBg.setAttribute('x', x + 8); previewBg.setAttribute('y', y + h - 112);
        previewBg.setAttribute('width', w - 16); previewBg.setAttribute('height', 104);
        previewBg.setAttribute('fill', COL.ground); previewBg.setAttribute('rx', 4);
        g.appendChild(previewBg);
        var previewSvg = pathSVG(state.ex, n.blocks, {
          width: w - 24, height: 100, reducedMotion: reducedMotionPref()
        });
        previewSvg.setAttribute('x', x + 12);
        previewSvg.setAttribute('y', y + h - 108);
        g.appendChild(previewSvg);
      }

      g.style.cursor = 'pointer';
      g.addEventListener('click', function () {
        if (typeof view.onSelect === 'function') view.onSelect(n.blocks[0]);
      });

      svg.appendChild(g);
    }

    function render() {
      var W = Math.max(240, wrapper.clientWidth || container.clientWidth || 320);
      var laneW = 30, margin = 10;
      var cardW = Math.max(190, W - margin * 2 - laneW);
      var charsPerLine = Math.max(18, Math.floor((cardW - 26) / 6.3));
      var y = margin;
      var laid = [];

      state.nodes.forEach(function (n, idx) {
        var isHeading = n.kind === 'heading';
        var detailLines = isHeading ? 0 : estimateLines(n.detail || '', charsPerLine);
        var hh = isHeading ? 26 : (24 + detailLines * 14 + 12);
        if (!isHeading && n.error) hh += 16;
        var expand = (!isHeading) && (state.highlightIdx === idx) && nodeHasMotionSegs(n, state.ex);
        if (expand) hh += 112;
        laid.push({ node: n, y: y, h: hh, expand: expand });
        y += hh + 12;
      });
      var totalH = y + margin;

      svg.setAttribute('width', W);
      svg.setAttribute('height', totalH);
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + totalH);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      for (var k = 1; k < laid.length; k++) drawConnector(laid[k - 1], laid[k], margin + cardW / 2);
      laid.forEach(function (L, idx) { if (L.node.loop) drawLoopEdge(laid, L.node, idx, margin, cardW, laneW); });
      laid.forEach(function (L, idx) { drawNode(L, idx, margin, cardW); });

      lastLaid = laid;
    }

    function scrollToHighlight() {
      if (state.highlightIdx === null) return;
      var target = lastLaid[state.highlightIdx];
      if (!target) return;
      var top = target.y - wrapper.clientHeight / 2 + target.h / 2;
      var behavior = reducedMotionPref() ? 'auto' : 'smooth';
      try { wrapper.scrollTo({ top: Math.max(0, top), behavior: behavior }); }
      catch (e) { wrapper.scrollTop = Math.max(0, top); }
    }

    function onResize() { render(); }
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', onResize);

    view.update = function (res, ex) {
      state.res = res;
      if (ex !== undefined) state.ex = ex;
      state.nodes = describe(res);
      if (state.highlightIdx !== null) state.highlightIdx = findNodeIdxForBlock(state.nodes, blockOfLastHighlight);
      render();
    };
    var blockOfLastHighlight = null;
    view.highlight = function (blockIndex) {
      blockOfLastHighlight = blockIndex;
      state.highlightIdx = findNodeIdxForBlock(state.nodes, blockIndex);
      render();
      scrollToHighlight();
    };
    view.dispose = function () {
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', onResize);
      while (container.firstChild) container.removeChild(container.firstChild);
    };

    return view;
  }

  return { create: create, describe: describe, pathSVG: pathSVG };
})();

if (typeof module !== 'undefined') module.exports = TNC_FLOW;
