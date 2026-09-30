/* The server's entry into core.js. Mirrors what ui.js does around TNC.run:
   the tool table merged over the built-ins (mtools), the machine parameters (machines.js),
   the holder gauge length, and the numbered listing (listing() in ui.js). */
function __tncCheck(text, optsJson) {
  var o = JSON.parse(optsJson || '{}'), opts = { autoTools: !!o.auto_tools };
  var mc = o.machine && TNC_MACHINE_CONFIGS[o.machine];
  if (mc) opts.machine = mc;
  var by = {};
  TNC.TOOLS.forEach(function (t) { by[t.t] = Object.assign({}, t); });
  (o.tools || []).forEach(function (t) { by[t.t] = Object.assign({}, t, { mine: true }); });
  opts.tools = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return a.t - b.t; });
  var stack = o.holder === 'SK40' ? 70 : 100;                 // tools3d.js HOLDERS[...].A
  opts.holder = { stack: function () { return stack; } };

  var r = TNC.run(String(text), opts), s = r.stats || {};
  var num = function (v) { return typeof v === 'number' && isFinite(v) ? v : 0; };
  var st0 = r.stock;                                           // ui.js compile(): an unusable BLK FORM falls back to the default blank
  if (!st0 || !(st0.x1 > st0.x0) || !(st0.y1 > st0.y0) || !(st0.z1 > st0.z0)) r.stock = { x0: 0, y0: 0, z0: -20, x1: 100, y1: 80, z1: 0 };
  var events = [];
  if (!r.errors.length && typeof TNC_SIM !== 'undefined') {    // ui.js verifyProgram(): expand + analyse on the machine's grid
    var ex = TNC_SIM.expand(r), ev = TNC_SIM.analyse(r, ex, TNC_SIM.grid(r.stock, ex.segs)) || [];
    events = ev.filter(function (e) { return e.sev === 'crash' || e.sev === 'warn'; }).map(function (e) {
      var b = r.blocks[e.block] || {};
      return { sev: e.sev, line: (e.block | 0) + 1, block: b.n == null ? null : b.n, msg: String(e.msg) };
    });
  }
  var out = {
    ok: r.errors.length === 0 && !events.some(function (e) { return e.sev === 'crash'; }),
    events: events,
    errors: r.errors.map(function (e) {
      var b = r.blocks[e.block] || {};
      return { line: e.block + 1, block: b.n == null ? null : b.n, msg: String(e.msg), raw: String(b.raw || '') };
    }),
    blocks: r.blocks.filter(function (b) { return b.kind !== 'BLANK' && b.n != null; }).reduce(function (m, b) { return Math.max(m, b.n + 1); }, 0),
    stats: {
      move_count: s.moveCount || 0, path_feed: num(s.pathFeed), path_rapid: num(s.pathRapid), cycle_time: num(s.cycleTime),
      min_z: num(s.minZ), max_z: num(s.maxZ), removed_volume: num(s.removedVolume),
      tools_used: (s.toolsUsed || []).map(function (t) { return { t: t.t, name: t.name || null, r: num(t.r), moves: t.moves || 0, time: num(t.time) }; })
    },
    stock: r.stock ? { x0: num(r.stock.x0), y0: num(r.stock.y0), z0: num(r.stock.z0), x1: num(r.stock.x1), y1: num(r.stock.y1), z1: num(r.stock.z1) } : null,
    interpreter: ''
  };
  if (o.listing) out.listing = r.blocks.filter(function (b) { return b.kind !== 'BLANK'; })
    .map(function (b) { return b.indent ? '  ' + b.raw : b.n + ' ' + b.raw; }).join('\r\n') + '\r\n';
  return JSON.stringify(out);
}

function __tncBuiltinTools() { return JSON.stringify(TNC.TOOLS.map(function (t) { return { t: t.t, name: t.name, l: t.l, r: t.r }; })); }
