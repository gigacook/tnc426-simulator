/* ==========================================================================
 * TNC 426 simulator  --  i18n.js
 * Minimal i18n: (a) static shell text, applied to any element carrying a
 * data-i18n="key" attribute in sim-shell.html, and (b) tr(text), which
 * translates the interpreter's UPPERCASE error / soft-key / mode strings.
 *
 * Swedish (sv) is here because the real TNC 426/430 control can be set to
 * Swedish dialogs (machine parameter MP7230=7). HEIDENHAIN's actual Swedish
 * dialog wording is NOT public, so every Swedish string below is unofficial
 * -- natural Swedish machine-shop terminology written for this simulator,
 * not a transcription of the real control.
 *
 * Plain browser JS, no modules. Exposes one global: TNC_I18N.
 * ========================================================================== */
var TNC_I18N = (function () {
  'use strict';

  var LS_KEY = 'tnc.lang';

  /* ---- (a) static shell dictionary: data-i18n="key" on sim-shell.html ---- */
  var SHELL = {
    en: {
      'btn.dev': 'DEV',
      'btn.new': '+ New',
      'btn.help': 'Help',
      'btn.focus': 'Focus',
      'mode.edit': 'PRG EDIT',
      'btn.tools': 'Tool list',
      'btn.effects': 'Effects & view',
      'tab.diag': 'Diagnostics',
      'tab.ref': 'Reference',
      'mode.test': 'TEST',
      'mode.single': 'SINGLE-BLOCK',
      'mode.full': 'FULL-RUN',
      'panel.program': 'Program',
      'panel.testgfx': 'Test graphics',
      'panel.position': 'Position',
      'panel.run': 'Run',
      'panel.checks': 'Checks',
      'panel.compare': 'Compare',
      'panel.projects': 'Projects',
      'panel.keys': 'Keys',
      'btn.pgmmgt': 'Programs',
      'btn.save': 'Save .H',
      'btn.ncstart': 'NC Start',
      'btn.ncstop': 'NC Stop',
      'btn.step': 'Step',
      'btn.reset': 'Reset',
      'btn.fx': 'Chips & sparks',
      'btn.cool': 'Coolant',
      'btn.fire': 'Smoke & fire',
      'btn.labels': 'Labels',
      'btn.vice': 'Vice',
      'btn.sound': 'Sound',
      'btn.snap': 'Store finished run as reference A',
      'btn.restore': 'Open reference program',
      'btn.projadd': 'Add current program to active project',
      'title.newprogram': 'New program',
      'title.help': 'Help',
      'title.profile': 'Profile',
      'title.dev': 'DEV',
      /* shell: phones (workspaces, drawer, dock) and accessible names */
      'btn.menu': 'Menu',
      'btn.close': 'Close',
      'drawer.title': 'Menu',
      'aria.modes': 'Operating mode',
      'aria.workspace': 'Workspace',
      'aria.dock': 'Soft keys',
      'aria.canvas': '3-D test graphics: blank, tool and tool path',
      'ws.program': 'Program',
      'ws.graphics': 'Graphics',
      'ws.status': 'Status',
      'mode.edit.s': 'PRG EDIT',
      'mode.test.s': 'TEST',
      'mode.single.s': 'SINGLE',
      'mode.full.s': 'FULL',
      'sk.prev': 'Previous soft-key row',
      'sk.next': 'Next soft-key row',
      'sk.row': 'Row',
      'hdr.errdesc': 'Opens the checks in the Status workspace',
      'chk.clear': 'all clear',
      'chk.error': 'error',
      'chk.errors': 'errors',
      'chk.warning': 'warning',
      'chk.warnings': 'warnings'
    },
    sv: {
      /* unofficial Swedish -- see file header */
      'btn.dev': 'UTV',
      'btn.new': '+ Nytt',
      'btn.help': 'Hjälp',
      'btn.focus': 'Fokus',
      'mode.edit': 'PRG REDIGERA',
      'btn.tools': 'Verktygslista',
      'btn.effects': 'Effekter & vy',
      'tab.diag': 'Diagnostik',
      'tab.ref': 'Referens',
      'mode.test': 'TEST',
      'mode.single': 'ENKELBLOCK',
      'mode.full': 'HELKÖRNING',
      'panel.program': 'Program',
      'panel.testgfx': 'Testgrafik',
      'panel.position': 'Position',
      'panel.run': 'Körning',
      'panel.checks': 'Kontroller',
      'panel.compare': 'Jämförelse',
      'panel.projects': 'Projekt',
      'panel.keys': 'Tangenter',
      'btn.pgmmgt': 'Program',
      'btn.save': 'Spara .H',
      'btn.ncstart': 'NC Start',
      'btn.ncstop': 'NC Stopp',
      'btn.step': 'Steg',
      'btn.reset': 'Återställ',
      'btn.fx': 'Spån & gnistor',
      'btn.cool': 'Kylmedel',
      'btn.fire': 'Rök & eld',
      'btn.labels': 'Etiketter',
      'btn.vice': 'Skruvstycke',
      'btn.sound': 'Ljud',
      'btn.snap': 'Spara avslutad körning som referens A',
      'btn.restore': 'Öppna referensprogram',
      'btn.projadd': 'Lägg till aktuellt program i aktivt projekt',
      'title.newprogram': 'Nytt program',
      'title.help': 'Hjälp',
      'title.profile': 'Profil',
      'title.dev': 'UTV',
      'btn.menu': 'Meny',
      'btn.close': 'Stäng',
      'drawer.title': 'Meny',
      'aria.modes': 'Driftläge',
      'aria.workspace': 'Arbetsyta',
      'aria.dock': 'Funktionstangenter',
      'aria.canvas': '3D-testgrafik: ämne, verktyg och verktygsbana',
      'ws.program': 'Program',
      'ws.graphics': 'Grafik',
      'ws.status': 'Status',
      'mode.edit.s': 'REDIGERA',
      'mode.test.s': 'TEST',
      'mode.single.s': 'ENKEL',
      'mode.full.s': 'HEL',
      'sk.prev': 'Föregående rad funktionstangenter',
      'sk.next': 'Nästa rad funktionstangenter',
      'sk.row': 'Rad',
      'hdr.errdesc': 'Öppnar kontrollerna i arbetsytan Status',
      'chk.clear': 'inga fel',
      'chk.error': 'fel',
      'chk.errors': 'fel',
      'chk.warning': 'varning',
      'chk.warnings': 'varningar'
    }
  };

  /* ---- (b) interpreter UPPERCASE strings: errors, soft keys, mode names ----
   * en needs no map (tr() is a no-op there); tr() also falls back to the
   * input unchanged for anything not listed here, in any language. */
  var TR_SV = {
    'BLOCK FORMAT INCORRECT': 'FELAKTIGT BLOCKFORMAT',
    'ARITHMETICAL ERROR': 'ARITMETISKT FEL',
    'TOOL RADIUS TOO LARGE': 'VERKTYGSRADIE FÖR STOR',
    'RADIUS COMP. UNDEFINED': 'RADIEKOMPENSERING EJ DEFINIERAD',
    'CIRCLE CENTER UNDEFINED': 'CIRKELCENTRUM EJ DEFINIERAT',
    'ARC END POS. INCORRECT': 'CIRKELNS SLUTPOSITION FEL',
    'FEED RATE MISSING': 'MATNING SAKNAS',
    'TOOL AXIS MISSING': 'VERKTYGSAXEL SAKNAS',
    'ENTRY INCOMPLETE': 'OFULLSTÄNDIG INMATNING',
    'CYCL DEF INCOMPLETE': 'OFULLSTÄNDIG CYKELDEFINITION',
    'LABEL NUMBER NOT FOUND': 'LABEL-NUMMER SAKNAS',
    'DIVISION BY ZERO': 'DIVISION MED NOLL',
    'TANGENTIAL CONNECTION NOT POSSIBLE': 'TANGENTIELL ANSLUTNING EJ MÖJLIG',
    'ROUNDING-OFF RADIUS TOO LARGE': 'AVRUNDNINGSRADIE FÖR STOR',
    'CHAMFER NOT PERMITTED': 'FAS EJ TILLÅTEN',
    'PROGRAM START UNDEFINED': 'PROGRAMSTART EJ DEFINIERAD',
    'SPINDLE ?': 'SPINDEL ?',
    'CRASH: TOOL INTO THE VICE': 'KRASCH: VERKTYG I SKRUVSTYCKET',
    'START': 'START',
    'STOP': 'STOPP',
    'RESET': 'ÅTERSTÄLL',
    'INSERT': 'INFOGA',
    'DELETE': 'RADERA',
    'EDIT': 'REDIGERA',
    'COPY': 'KOPIERA',
    'UNDO': 'ÅNGRA',
    'REDO': 'GÖR OM',
    'CHECK': 'KONTROLLERA',
    'PGM MGT': 'PGM-HANT',
    'TOOL TABLE': 'VERKTYGSTABELL',
    'CYCL DEF': 'CYKELDEF',
    'CYCL CALL': 'CYKELANROP',
    'TOOL CALL': 'VERKTYGSANROP',
    'TOOL DEF': 'VERKTYGSDEF',
    'END': 'SLUT',
    'NEW': 'NYTT',
    'OPEN': 'ÖPPNA',
    'SAVE': 'SPARA',
    'PROGRAMMING AND EDITING': 'PROGRAMMERING OCH REDIGERING',
    'TEST RUN': 'TESTKÖRNING',
    'PGM RUN SINGLE BLOCK': 'PROGRAMKÖRNING, ENSTAKA BLOCK',
    'PGM RUN FULL SEQUENCE': 'PROGRAMKÖRNING, HELA SEKVENSEN'
  };

  /* messages carrying numbers / variable text, e.g. "TOOL 5 NOT DEFINED",
   * "LIMIT SWITCH X", "LABEL 12 NOT FOUND" */
  var TR_PATTERNS = [
    [/^TOOL (\S+) NOT DEFINED$/, function (m) { return 'VERKTYG ' + m[1] + ' EJ DEFINIERAT'; }],
    [/^LIMIT SWITCH\b(.*)$/, function (m) { return 'ÄNDLÄGE' + (m[1] || ''); }],
    [/^LABEL (\S+) NOT FOUND$/, function (m) { return 'LABEL ' + m[1] + ' SAKNAS'; }],
    [/^UNKNOWN LABEL (\S+)$/, function (m) { return 'OKÄND LABEL ' + m[1]; }]
  ];

  var lang = 'en';
  try {
    var saved = (typeof localStorage !== 'undefined') && localStorage.getItem(LS_KEY);
    if (saved === 'en' || saved === 'sv') lang = saved;
  } catch (e) {}

  function applyDom() {
    if (typeof document === 'undefined' || !document.querySelectorAll) return;
    var dict = SHELL[lang] || SHELL.en;
    var nodes = document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], key = n.getAttribute('data-i18n');
      var val = dict[key] != null ? dict[key] : (SHELL.en[key] != null ? SHELL.en[key] : null);
      if (val == null) continue;
      var attr = n.getAttribute('data-i18n-attr');   // e.g. data-i18n-attr="title" for a tooltip
      if (attr) n.setAttribute(attr, val); else n.textContent = val;
    }
  }

  function set(l) {
    if (l !== 'en' && l !== 'sv') return;
    lang = l;
    api.lang = l;
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, l); } catch (e) {}
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = l;
    applyDom();
  }

  function t(key, fallback) {
    var dict = SHELL[lang] || SHELL.en;
    if (dict[key] != null) return dict[key];
    if (SHELL.en[key] != null) return SHELL.en[key];
    return fallback !== undefined ? fallback : key;
  }

  function tr(text) {
    if (typeof text !== 'string' || lang !== 'sv') return text;
    if (TR_SV.hasOwnProperty(text)) return TR_SV[text];
    for (var i = 0; i < TR_PATTERNS.length; i++) {
      var m = text.match(TR_PATTERNS[i][0]);
      if (m) return TR_PATTERNS[i][1](m);
    }
    return text;
  }

  var api = { lang: lang, set: set, t: t, tr: tr };

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyDom);
    } else {
      applyDom();
    }
  }

  return api;
})();
if (typeof module !== 'undefined') module.exports = TNC_I18N;
