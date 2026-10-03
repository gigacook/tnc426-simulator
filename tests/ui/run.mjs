#!/usr/bin/env node
/* Browser regression suite for the simulator shell (phones + desktop) and the web app.
 *
 *   npm ci && python3 build.py && node tests/ui/run.mjs
 *
 * What it covers: page-level horizontal overflow at 320–1440 px and a short landscape; touch-target sizes;
 * the phone header drawer (modal dialog: focus, inert background, Esc, focus return); workspace tabs (keyboard,
 * ARIA state, roving tabindex); swipes (navigate, but never from the 3-D view or on a vertical drag); state kept
 * across workspaces (block cursor, WebGL canvas); soft-key paging; run controls; editing a block from the dock;
 * dialogs (focus trap, Esc, focus return); global shortcuts vs. typing and keyboard-focused buttons; Swedish;
 * AI generation against a MOCKED OpenRouter (never a real key); axe-core scans; and — when the Rust server is
 * built — the simulator and web app served with the desktop shell's CSP.
 *
 * Browsers: Chromium always (Playwright's, or /opt/pw-browsers); WebKit when Playwright has it installed
 * (CI: `npx playwright install --with-deps chromium webkit`). A browser that is not installed is reported as
 * SKIPPED, never as passed. Emulation is not a device test: WebKit here is not iOS Safari + VoiceOver, and
 * Chromium mobile emulation is not Android Chrome + TalkBack.
 *
 * Screenshots go to local/ui-shots/ (gitignored). Exit code 1 on any failure.
 */
import { chromium, webkit } from 'playwright';
import { existsSync, mkdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SIM = join(ROOT, 'index.html');
const SHOTS = join(ROOT, 'local', 'ui-shots');
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(SIM)) { console.error('index.html missing: run python3 build.py'); process.exit(1); }
const SIM_URL = pathToFileURL(SIM).href;

let pass = 0, fail = 0, skip = 0;
const failures = [];
function ok(cond, name, detail = '') {
  if (cond) { pass++; console.log('  ok    ' + name); }
  else { fail++; failures.push(name + (detail ? ' — ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  (' + detail + ')' : '')); }
}
function skipped(name, why) { skip++; console.log('  SKIP  ' + name + '  (' + why + ')'); }

/* ---------- browsers ---------- */
async function launch(type) {
  const tries = type === chromium
    ? [{}, { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }]
    : [{}];
  for (const t of tries) {
    if (t.executablePath && !existsSync(t.executablePath)) continue;
    try { return await type.launch({ ...t, args: type === chromium ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : [] }); }
    catch (e) { if (!/Executable doesn't exist|browserType.launch/.test(String(e))) throw e; }
  }
  return null;
}

/* ---------- a fresh simulator page: boot screen and name prompt out of the way, fonts offline ---------- */
async function simPage(browser, { width, height, mobile = width <= 900, lang = 'en', url = SIM_URL, storage = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: mobile && browser.browserType() === chromium ? true : undefined,
    hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await ctx.addInitScript(([lang, storage]) => {
    try {
      sessionStorage.setItem('tnc426.boot', '1');
      localStorage.setItem('tnc.lang', lang);
      for (const [k, v] of Object.entries(storage)) localStorage.setItem(k, v);
    } catch (e) {}
  }, [lang, storage]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)|ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => { if (!/fonts\.(googleapis|gstatic)\.com|openrouter\.ai/.test(r.url())) errors.push('requestfailed: ' + r.url()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(url);
  await page.waitForFunction(() => document.querySelectorAll('#plist .blk').length > 5, null, { timeout: 30000 });
  // the first visit asks for a name: close it like an operator would
  if (await page.locator('#m-prof:not([hidden])').count()) await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  return { ctx, page, errors };
}

const overflow = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
const box = (page, sel) => page.locator(sel).first().boundingBox();
const active = (page) => page.evaluate(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : null; });

/* swipe on the real touch pipeline (CDP), Chromium only */
async function swipe(page, x0, y0, x1, y1, steps = 3) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
  for (let i = 1; i <= steps; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(120);
}

const VIEWPORTS = [
  { name: '320 portrait', width: 320, height: 640 },
  { name: '360 portrait', width: 360, height: 740 },
  { name: '390 portrait', width: 390, height: 844 },
  { name: '430 portrait', width: 430, height: 932 },
  { name: '768 tablet', width: 768, height: 1024 },
  { name: '844x390 landscape', width: 844, height: 390 },
  { name: '1440 desktop', width: 1440, height: 900, mobile: false },
];

async function layoutChecks(browser, tag) {
  for (const vp of VIEWPORTS) {
    for (const lang of ['en', 'sv']) {
      if (lang === 'sv' && ![320, 390, 1440].includes(vp.width)) continue;
      const { ctx, page, errors } = await simPage(browser, { ...vp, lang });
      const label = `[${tag}] ${vp.name} ${lang}`;
      const o = await overflow(page);
      ok(o.sw <= o.cw, `${label}: no page-level horizontal overflow`, `${o.sw} > ${o.cw}`);
      const phone = vp.width <= 900;
      if (phone) {
        for (const p of ['pgm', 'gfx', 'side']) {
          await page.click(`#mt-${p}`);
          const o2 = await overflow(page);
          ok(o2.sw <= o2.cw, `${label}: no overflow in workspace ${p}`, `${o2.sw} > ${o2.cw}`);
          await page.screenshot({ path: join(SHOTS, `${tag}-${vp.width}x${vp.height}-${lang}-${p}.png`) });
        }
        await page.click('#mt-gfx');
        // primary touch targets
        const small = await page.evaluate(() => {
          const sel = '.mode, .mtabs [role=tab], #b-menu, #hdr-err, .dock .sk:not([hidden]), .skpager:not([hidden]) button';
          return [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null)
            .map((e) => { const r = e.getBoundingClientRect(); return { id: e.id || e.textContent.trim().slice(0, 14), w: Math.round(r.width), h: Math.round(r.height) }; })
            .filter((r) => r.w < 44 || r.h < 40);
        });
        ok(small.length === 0, `${label}: primary touch targets ≥ 44 px wide / ≥ 40 px tall`, JSON.stringify(small.slice(0, 4)));
        // essential controls on screen without scrolling: modes, tabs, START, menu, checks
        const vis = await page.evaluate(() => ['#modes', '#mtabs', '#b-menu', '#hdr-err', '.dock .sk.go'].map((s) => {
          const e = document.querySelector(s); if (!e) return s + ' missing'; const r = e.getBoundingClientRect();
          return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight + 1 ? null : s + ' off screen'; }).filter(Boolean));
        ok(vis.length === 0, `${label}: modes, workspace tabs, MENU, checks and NC START visible`, vis.join(', '));
        const canvas = await box(page, '#gl');
        ok(canvas && canvas.height >= 150 && canvas.width >= vp.width - 20, `${label}: graphics canvas has a usable size`, JSON.stringify(canvas));
      } else {
        await page.screenshot({ path: join(SHOTS, `${tag}-${vp.width}x${vp.height}-${lang}.png`) });
        const inl = await page.evaluate(() => ['b-dev', 'b-new', 'b-lessons', 'b-ai', 'b-help', 'b-focus', 'b-prof'].filter((id) => { const e = document.getElementById(id); return !e || e.offsetParent === null; }));
        ok(inl.length === 0, `${label}: header buttons stay inline on wide screens`, inl.join(','));
        ok(await page.evaluate(() => !document.getElementById('hmore').hasAttribute('role')), `${label}: no drawer dialog role on wide screens`);
        ok(await page.evaluate(() => document.getElementById('sks').closest('.col-pgm') !== null), `${label}: soft keys under the program column`);
      }
      ok(errors.length === 0, `${label}: no page errors, console errors or failed requests`, errors.slice(0, 3).join(' | '));
      await ctx.close();
    }
  }
}

async function phoneFlows(browser, tag) {
  const { ctx, page, errors } = await simPage(browser, { width: 390, height: 844 });
  const L = `[${tag}] phone`;
  // ---- drawer
  await page.click('#b-menu');
  ok(await page.evaluate(() => { const h = document.getElementById('hmore'); return h.getAttribute('role') === 'dialog' && h.getAttribute('aria-modal') === 'true' && h.classList.contains('open'); }), `${L}: MENU opens a modal drawer`);
  ok((await active(page)) === 'hmore-x', `${L}: focus moves into the drawer`, await active(page));
  ok(await page.evaluate(() => document.querySelector('.main').inert && document.getElementById('dock').inert), `${L}: workspace and dock are inert behind the drawer`);
  ok(await page.getAttribute('#b-menu', 'aria-expanded') === 'true', `${L}: MENU aria-expanded=true`);
  const inDrawer = await page.evaluate(() => ['b-dev', 'b-new', 'b-lessons', 'b-ai', 'b-help', 'b-focus', 'b-prof'].filter((id) => { const e = document.getElementById(id); const r = e.getBoundingClientRect(); return !(e.closest('#hmore') && r.width > 0 && r.right <= innerWidth + 1); }));
  ok(inDrawer.length === 0, `${L}: profile, AI, help, lessons, DEV, new, focus are in the drawer`, inDrawer.join(','));
  for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.getElementById('hmore').contains(document.activeElement)), `${L}: Tab stays inside the drawer`, await active(page));
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => !document.getElementById('hmore').classList.contains('open')), `${L}: Esc closes the drawer`);
  ok((await active(page)) === 'b-menu', `${L}: focus returns to MENU`, await active(page));
  ok(await page.evaluate(() => !document.querySelector('.main').inert), `${L}: workspace usable again`);
  await page.click('#b-menu');
  const hm = await box(page, '#hmore');
  await swipe(page, hm.x + 40, hm.y + 300, hm.x + 260, hm.y + 310);
  ok(await page.evaluate(() => !document.getElementById('hmore').classList.contains('open')), `${L}: swipe right closes the drawer`);

  // ---- dialog from the drawer: focus trap, Esc, focus return
  await page.click('#b-menu'); await page.click('#b-help');
  ok(await page.evaluate(() => !document.getElementById('m-help').hidden && !document.getElementById('hmore').classList.contains('open')), `${L}: HELP opens the dialog and closes the drawer`);
  for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
  ok(await page.evaluate(() => document.querySelector('#m-help .mcard').contains(document.activeElement)), `${L}: Tab is trapped in the dialog`, await active(page));
  ok(await page.evaluate(() => document.querySelector('.app').inert), `${L}: page behind the dialog is inert`);
  const mc = await box(page, '#m-help .mcard');
  ok(mc && mc.height >= 800 && mc.width >= 380, `${L}: dialog is a full-height sheet`, JSON.stringify(mc));
  await page.keyboard.press('Escape');
  ok(await page.evaluate(() => document.getElementById('m-help').hidden), `${L}: Esc closes the dialog`);
  ok((await active(page)) === 'b-menu', `${L}: focus returns to MENU after the dialog`, await active(page));

  // ---- workspace tabs: keyboard + ARIA
  await page.focus('#mt-gfx');
  await page.keyboard.press('ArrowLeft');
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane === 'pgm' && document.activeElement.id === 'mt-pgm'), `${L}: ArrowLeft on the tabs selects Program`);
  ok(await page.evaluate(() => [...document.querySelectorAll('#mtabs [role=tab]')].map((t) => t.tabIndex + ':' + t.getAttribute('aria-selected')).join() === '0:true,-1:false,-1:false'), `${L}: roving tabindex + aria-selected`);
  ok(await page.evaluate(() => document.getElementById('ws-pgm').getAttribute('role') === 'tabpanel' && document.getElementById('ws-pgm').getAttribute('aria-labelledby') === 'mt-pgm'), `${L}: workspace is a labelled tabpanel`);
  await page.keyboard.press('End');
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane === 'side'), `${L}: End selects Status`);

  // ---- state kept across workspaces
  await page.click('#mt-pgm');
  await page.evaluate(() => { window.__gl = document.getElementById('gl'); window.__ctx = window.__gl.getContext('webgl2') || window.__gl.getContext('webgl'); });
  await page.click('#plist .blk[data-i="12"]');
  const curBefore = await page.evaluate(() => document.querySelector('#plist .blk.cur').dataset.i);
  await page.evaluate(() => scrollTo(0, 400)); await page.waitForTimeout(50);
  const y0 = await page.evaluate(() => scrollY);
  await page.click('#mt-gfx'); await page.waitForTimeout(80); await page.click('#mt-pgm'); await page.waitForTimeout(80);
  ok(await page.evaluate(() => document.querySelector('#plist .blk.cur').dataset.i) === curBefore, `${L}: block cursor kept across workspaces`);
  const y1 = await page.evaluate(() => scrollY);
  ok(Math.abs(y1 - y0) < 4, `${L}: Program scroll position restored`, `${y0} → ${y1}`);
  ok(await page.evaluate(() => document.getElementById('gl') === window.__gl && !window.__ctx.isContextLost()), `${L}: same canvas, WebGL context not recreated`);
  await page.click('#mt-gfx'); await page.waitForTimeout(150);
  const cb = await box(page, '#gl');
  const rs = await page.evaluate(() => { const c = document.getElementById('gl'); return { w: c.width, h: c.height }; });
  ok(rs.w > 0 && Math.abs(rs.w / rs.h - cb.width / cb.height) < 0.05, `${L}: canvas resized to its box after the switch`, JSON.stringify({ rs, cb }));

  // ---- swipes
  await page.click('#mt-side');
  // a point inside the workspace, below the sticky tab bar and above the dock
  const mid = await page.evaluate(() => { const t = document.getElementById('mtabs').getBoundingClientRect().bottom, d = document.getElementById('dock').getBoundingClientRect().top; return Math.round((t + d) / 2); });
  ok(await page.evaluate((y) => !!document.elementFromPoint(200, y).closest('.main'), mid), `${L}: swipe point is on the workspace`);
  await swipe(page, 330, mid, 60, mid + 10);   // leftward = next; Status is last: stays
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane) === 'side', `${L}: swipe past the last workspace does nothing`);
  await swipe(page, 60, mid, 330, mid + 5);   // rightward = previous
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane) === 'gfx', `${L}: swipe right goes to the previous workspace`);
  const g = await box(page, '#gl');
  await swipe(page, g.x + 300, g.y + g.height / 2, g.x + 40, g.y + g.height / 2);
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane) === 'gfx', `${L}: a swipe on the 3-D view orbits, never switches`);
  await page.click('#mt-pgm');
  await swipe(page, 200, mid - 150, 210, mid + 150);
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane) === 'pgm', `${L}: a vertical drag does not switch`);
  await swipe(page, 360, mid, 80, mid + 10);
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane) === 'gfx', `${L}: swipe left goes to the next workspace`);

  // ---- run controls from the dock (TEST mode)
  await page.click('.mode[data-m="test"]');
  await page.click('.dock .sk[data-a="start"]');
  await page.waitForTimeout(400);
  const rt = await page.evaluate(() => document.getElementById('run-state').textContent);
  ok(!/^READY$/.test(rt), `${L}: NC START from the dock runs the program`, rt);
  ok(await page.evaluate(() => document.getElementById('hdr-stat').textContent.includes('NAMEPLATE')), `${L}: header shows the program`);
  await page.click('.dock .sk[data-a="stop"]');
  await page.click('.dock .sk[data-a="reset"]');
  ok(await page.evaluate(() => (document.getElementById('sr-live').textContent || '').length > 0), `${L}: run state announced in the polite live region`);

  // ---- PRG EDIT: soft-key rows page, a block is edited from the dock
  await page.click('.mode[data-m="edit"]');
  ok(await page.evaluate(() => !document.getElementById('skpager').hidden && document.querySelectorAll('#sks .sk:not([hidden])').length === 8), `${L}: PRG EDIT shows 8 soft keys and a row switch`);
  ok(/1 \/ 3/.test(await page.textContent('#sk-page')), `${L}: soft-key row 1 / 3`, await page.textContent('#sk-page'));
  await page.click('#sk-next'); await page.click('#sk-next');
  ok(await page.evaluate(() => !!document.querySelector('#sks .sk[data-a="ed"]:not([hidden])')), `${L}: row 3 holds EDIT / INSERT / DELETE`);
  await page.click('#mt-pgm');
  await page.click('#plist .blk[data-i="10"]');
  await page.click('.dock .sk[data-a="ed"]');
  const dlg = page.locator('#dlg-in');
  ok(await dlg.isEnabled(), `${L}: EDIT opens the block line in the dock`);
  const before = await page.evaluate(() => document.querySelector('#plist .blk[data-i="10"] .bt').textContent);
  await dlg.fill('L Z+60 R0 FMAX M3');
  await dlg.press('Enter');
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => document.querySelector('#plist .blk[data-i="10"] .bt').textContent);
  ok(after.includes('Z+60') && after !== before, `${L}: block edited from the phone`, `${before} → ${after}`);
  const dlgBox = await box(page, '#dlg-in');
  ok(dlgBox && dlgBox.y + dlgBox.height <= 844, `${L}: block line visible in the dock`, JSON.stringify(dlgBox));

  // ---- header check count → Status
  await page.click('#hdr-err');
  ok(await page.evaluate(() => document.querySelector('.main').dataset.pane === 'side' && !document.getElementById('sp-diag').hidden), `${L}: the check count opens the checks`);
  ok(await page.evaluate(() => !!document.getElementById('hdr-err').getAttribute('aria-label')), `${L}: check count has a text name (not colour only)`);
  ok(errors.length === 0, `${L}: no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

async function desktopFlows(browser, tag) {
  const { ctx, page, errors } = await simPage(browser, { width: 1440, height: 900, mobile: false });
  const L = `[${tag}] desktop`;
  await page.locator('body').click({ position: { x: 700, y: 400 } }).catch(() => {});
  await page.keyboard.press('2');
  ok(await page.getAttribute('.mode[data-m="test"]', 'aria-pressed') === 'true', `${L}: key 2 = TEST`);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  ok(await page.evaluate(() => document.querySelector('#plist .blk.cur').dataset.i) === '2', `${L}: ↑↓ move the block cursor`);
  await page.keyboard.press(' ');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => document.getElementById('run-state').textContent !== 'READY'), `${L}: SPACE = NC START`);
  await page.keyboard.press('Escape');
  // Tab to a header button, Enter activates it (not NC START)
  await page.focus('#b-help');
  await page.keyboard.press('Enter');
  ok(await page.evaluate(() => !document.getElementById('m-help').hidden), `${L}: Enter on a keyboard-focused button activates it`);
  await page.keyboard.press('Escape');
  ok((await active(page)) === 'b-help', `${L}: focus returns to the opener`, await active(page));
  // typing does not trigger shortcuts
  await page.keyboard.press('Tab'); // raw editor toggles only when focus is not on a control; use the TAB key path explicitly
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Tab');
  const rawOpen = await page.evaluate(() => !document.getElementById('raw').hidden);
  if (rawOpen) {
    await page.keyboard.type('1');
    ok(await page.getAttribute('.mode[data-m="test"]', 'aria-pressed') === 'true', `${L}: typing "1" in the raw editor does not switch to PRG EDIT`);
    await page.keyboard.press('Backspace'); await page.keyboard.press('Tab');
  } else skipped(`${L}: raw editor typing`, 'TAB did not open the raw editor from this focus');
  // status tabs: arrow keys
  await page.focus('#stabs [aria-selected="true"]');
  await page.keyboard.press('ArrowRight');
  ok(await page.evaluate(() => document.querySelector('#stabs [aria-selected="true"]').dataset.tab === 'ref' && !document.getElementById('sp-ref').hidden), `${L}: ArrowRight in the status tabs selects Reference`);
  await page.keyboard.press('ArrowLeft');
  ok(errors.length === 0, `${L}: no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

/* AI against a mocked OpenRouter: the route answers, nothing leaves the machine, no key is spent */
async function aiMocked(browser, tag) {
  const { ctx, page, errors } = await simPage(browser, { width: 390, height: 844, storage: { 'tnc426.orkey': 'test-key-not-real' } });
  const L = `[${tag}] AI (mocked)`;
  const PROGRAM = ['BEGIN PGM MOCK MM', 'BLK FORM 0.1 Z X+0 Y+0 Z-20', 'BLK FORM 0.2 X+100 Y+80 Z+0', 'TOOL CALL 4 Z S3000',
    'L Z+50 R0 FMAX M3', 'L X+10 Y+10 R0 FMAX', 'L Z+2 R0 FMAX', 'L Z-1 R0 F150', 'L X+90 R0 F500', 'L Z+50 R0 FMAX M5', 'M30', 'END PGM MOCK MM'].join('\n');
  const SPEC = { blank: { x: [0, 100], y: [0, 80], z: [-20, 0] }, features: [{ id: 'S1', type: 'slot', from: [10, 10], to: [90, 10], w: 6, z: -1 }] };
  let calls = 0, sawKey = false;
  await page.route('https://openrouter.ai/**', async (route) => {
    const u = route.request().url();
    if (u.endsWith('/models')) return route.fulfill({ json: { data: [{ id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek: V4.1 Flash', created: 1, pricing: { prompt: '0.000000035', completion: '0.00000029' }, context_length: 128000 }] } });
    if (u.endsWith('/chat/completions')) {
      calls++; sawKey = (route.request().headers().authorization || '') === 'Bearer test-key-not-real';
      const req = JSON.parse(route.request().postData() || '{}'), planStep = /STEP 1 of 2/.test(JSON.stringify(req.messages || []));
      const chunk = (o) => 'data: ' + JSON.stringify(o) + '\n\n';
      const content = planStep ? '```partspec\n' + JSON.stringify(SPEC) + '\n```' : '```klartext\n' + PROGRAM + '\n```';
      const body = chunk({ choices: [{ delta: { content }, finish_reason: 'stop' }] }) + chunk({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, cost: 0 } }) + 'data: [DONE]\n\n';
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
    }
    return route.fulfill({ status: 404, body: '{}' });
  });
  await page.click('#b-menu'); await page.click('#b-ai');
  await page.click('.hmenu button:has-text("New program from a description")');
  ok(await page.evaluate(() => !document.getElementById('m-new').hidden && !document.getElementById('new-ai').hidden), `${L}: AI dialog opens from the drawer`);
  await page.fill('#ai-prompt', 'A 100 x 80 plate, one facing pass 1 mm deep.');
  const pb = await box(page, '#ai-go');
  ok(pb && pb.y >= 0 && pb.y + pb.height <= 844, `${L}: Generate button on screen without scrolling`, JSON.stringify(pb));
  await page.click('#ai-go');
  await page.waitForFunction(() => /MOCK/.test(document.getElementById('hdr-stat').textContent), null, { timeout: 15000 }).catch(() => {});
  ok(calls === 2 && sawKey, `${L}: plan + program = two requests to the mocked endpoint with the BYOK header`, `calls=${calls} key=${sawKey}`);
  ok(await page.evaluate(() => /Measured against the spec: 1\d\d|Measured against the spec: 9\d/.test(document.getElementById('ailive') ? document.getElementById('ailive').textContent : '')),
    `${L}: the program is measured against the planned part (high match)`, await page.evaluate(() => (document.getElementById('ailive') || {}).textContent));
  ok(await page.evaluate(() => /MOCK/.test(document.getElementById('hdr-stat').textContent)), `${L}: generated program opened`);
  ok(errors.length === 0, `${L}: no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

/* axe-core: reported per state; serious/critical in the shell's new parts fail the run */
async function axeScan(browser, tag) {
  let AxeBuilder;
  try { ({ default: AxeBuilder } = await import('@axe-core/playwright')); } catch { skipped(`[${tag}] axe`, '@axe-core/playwright not installed'); return; }
  const states = [
    { name: 'phone', vp: { width: 390, height: 844 }, run: async () => {} },
    { name: 'phone drawer', vp: { width: 390, height: 844 }, run: async (p) => p.click('#b-menu') },
    { name: 'phone help dialog', vp: { width: 390, height: 844 }, run: async (p) => { await p.click('#b-menu'); await p.click('#b-help'); } },
    { name: 'desktop', vp: { width: 1440, height: 900, mobile: false }, run: async () => {} },
  ];
  for (const s of states) {
    const { ctx, page } = await simPage(browser, s.vp);
    await s.run(page);
    await page.waitForTimeout(250);
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    const mine = bad.filter((v) => v.nodes.some((n) => n.target.join(' ').match(/#(b-menu|hmore|hmore-x|mtabs|mt-|hdr-|dock|sk-|skpager|sr-live|scrim|ws-)/)));
    console.log(`  axe   [${tag}] ${s.name}: ${r.violations.length} violation types (${bad.length} serious/critical): ` +
      r.violations.map((v) => `${v.id}×${v.nodes.length}`).join(', '));
    ok(mine.length === 0, `[${tag}] axe ${s.name}: no serious/critical violation in the new shell controls`, mine.map((v) => v.id + ' ' + v.nodes[0].target).join('; '));
    ok(bad.length === 0, `[${tag}] axe ${s.name}: no serious/critical violation anywhere`, bad.map((v) => v.id + ' ' + v.nodes[0].target).join('; '));
    await ctx.close();
  }
}

/* the Rust server, when built: the simulator and the web app under the desktop shell's CSP */
async function serverChecks(browser, tag) {
  const bin = join(ROOT, 'server', 'target', process.platform === 'win32' ? 'debug/tnc-server.exe' : 'debug/tnc-server');
  if (!existsSync(bin)) { skipped(`[${tag}] server + CSP`, 'server/target/debug/tnc-server not built (cd server && cargo build)'); return; }
  const web = join(ROOT, 'web', 'dist', 'index.html');
  const lib = readFileSync(join(ROOT, 'desktop', 'src-tauri', 'src', 'lib.rs'), 'utf8');
  const m = lib.match(/const CSP: &str = "([\s\S]*?)";/);
  const csp = m[1].replace(/\\\n\s*/g, '');
  const data = mkdtempSync(join(tmpdir(), 'tnc-ui-'));
  const port = 18000 + Math.floor(Math.random() * 2000);
  const proc = spawn(bin, [], { env: { ...process.env, TNC_BIND: `127.0.0.1:${port}`, TNC_DATA_DIR: data, TNC_SIM_FILE: SIM, TNC_WEB_DIR: join(ROOT, 'web', 'dist'),
    TNC_CSP: csp, TNC_ALLOWED_HOSTS: `127.0.0.1:${port}`, OPENROUTER_API_KEY: '', RUST_LOG: 'warn' }, stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    const L = `[${tag}] server`;
    // simulator, served with the CSP
    const csps = [];
    const { ctx, page, errors } = await (async () => {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
      await ctx.addInitScript(() => { try { sessionStorage.setItem('tnc426.boot', '1'); } catch (e) {} });
      const page = await ctx.newPage(); const errors = [];
      page.on('console', (m) => { if (/Content Security Policy|Refused to/.test(m.text())) csps.push(m.text()); });
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
      return { ctx, page, errors };
    })();
    const res = await page.goto(base + '/sim/');
    ok(res.headers()['content-security-policy'] === csp, `${L}: /sim/ carries the desktop CSP`);
    await page.waitForFunction(() => document.querySelectorAll('#plist .blk').length > 5, null, { timeout: 30000 });
    ok(await page.evaluate(() => !!window.TNC_BACKEND), `${L}: simulator sees the server (bridge)`);
    const nonFont = csps.filter((c) => !/fonts\.(googleapis|gstatic)/.test(c));
    ok(nonFont.length === 0, `${L}: simulator runs under the CSP (fonts aside)`, nonFont.slice(0, 2).join(' | '));
    ok(errors.length === 0, `${L}: simulator page errors`, errors.slice(0, 2).join(' | '));
    // fetch() will not send a custom Host header; a raw request does (this is what a DNS-rebinding page looks like)
    const status = await new Promise((res) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/health', headers: { Host: `evil.example:${port}` } }, (x) => { x.resume(); res(x.statusCode); }); r.on('error', () => res(0)); r.end(); });
    ok(status === 421, `${L}: foreign Host header refused (421)`, status);
    await ctx.close();
    if (!existsSync(web)) { skipped(`${L}: web app`, 'web/dist not built (cd web && npm run build)'); return; }
    // web app on a phone: sign up the first account, every page fits, the simulator page shows the iframe
    const c2 = await browser.newContext({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: browser.browserType() === chromium || undefined });
    const p2 = await c2.newPage(); const e2 = [];
    p2.on('pageerror', (e) => e2.push(e.message));
    p2.on('console', (m) => { if (/Refused to/.test(m.text()) && !/fonts/.test(m.text())) e2.push(m.text()); });
    await p2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await p2.goto(base + '/');
    await p2.fill('input[type=email]', 'op@shop.test');
    const name = p2.locator('input[autocomplete=name], input[name=name]');
    if (await name.count()) await name.first().fill('Operator');
    await p2.fill('input[type=password]', 'correct horse');
    await p2.click('button[type=submit]');
    await p2.waitForSelector('.topbar', { timeout: 10000 });
    for (const path of ['/', '/tools', '/account', '/simulator']) {
      await p2.goto(base + path); await p2.waitForTimeout(400);
      const o = await overflow(p2);
      ok(o.sw <= o.cw, `${L}: web ${path} has no horizontal overflow at 360 px`, `${o.sw} > ${o.cw}`);
      await p2.screenshot({ path: join(SHOTS, `${tag}-web-360${path.replace(/\//g, '_') || '_'}.png`) });
    }
    const nav = await p2.evaluate(() => { const b = document.querySelector('.nav-toggle'); return b ? b.getBoundingClientRect().height : 0; });
    ok(nav >= 44, `${L}: web menu button ≥ 44 px`, nav);
    const fr = await box(p2, '.simframe iframe');
    ok(fr && fr.height >= 400, `${L}: simulator iframe fills the phone`, JSON.stringify(fr));
    ok(e2.length === 0, `${L}: web app errors`, e2.slice(0, 2).join(' | '));
    await c2.close();
  } finally { proc.kill(); try { rmSync(data, { recursive: true, force: true }); } catch {} }
}

/* ---------- run ---------- */
for (const [type, tag] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
  const b = await launch(type);
  if (!b) { skipped(`[${tag}] all checks`, `${tag} not installed for Playwright`); continue; }
  console.log(`\n== ${tag} ${b.version()} ==`);
  try {
    await layoutChecks(b, tag);
    if (type === chromium) await phoneFlows(b, tag); else skipped(`[${tag}] phone flows`, 'swipe tests drive the CDP touch pipeline (Chromium only)');
    await desktopFlows(b, tag);
    await aiMocked(b, tag);
    await axeScan(b, tag);
    await serverChecks(b, tag);
  } catch (e) { fail++; failures.push(`[${tag}] crashed: ${e.stack || e}`); console.log(e); }
  await b.close();
}
console.log(`\n${pass} passed · ${fail} failed · ${skip} skipped   (screenshots: local/ui-shots/)`);
if (fail) { console.log('\nFAILURES\n' + failures.map((f) => '  - ' + f).join('\n')); process.exit(1); }
