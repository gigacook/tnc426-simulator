// HEIDENHAIN Klartext highlighting and diagnostics for CodeMirror.
import { StreamLanguage, HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import type { Extension, Text } from '@codemirror/state';
import type { Report } from './types';

const KEYWORDS = /^(BEGIN|END|PGM|MM|INCH|BLK|FORM|TOOL|DEF|CALL|CYCL|LBL|REP|FN|APPR|DEP|LCT|LT|LN|TCH|PROBE|STOP|PLANE|M\d+)\b/;
const PATH = /^(L|C|CR|CC|CT|CP|LP|CTP|RND|CHF)\b/;

export const klartextLanguage = StreamLanguage.define<{ inComment: boolean }>({
  name: 'klartext',
  startState: () => ({ inComment: false }),
  token(stream, state) {
    if (stream.sol()) {
      state.inComment = false;
      if (stream.match(/^\s*\d+(?=\s)/)) return 'meta';
    }
    if (state.inComment) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.peek() === ';') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^\*\s?-.*/)) return 'comment';
    if (stream.match(/^Q[LR]?\d+/)) return 'variableName';
    if (stream.match(/^(RL|RR|R0|F\s?MAX|FMAX|FAUTO|DR[+-]?|DL[+-]?)/)) return 'modifier';
    if (stream.match(/^I?[XYZABCUVW][+-]?\d*[.,]?\d*/)) return 'propertyName';
    if (stream.match(/^[FSRL][+-]?\d+[.,]?\d*/)) return 'attributeName';
    if (stream.match(/^Q\d+\s*=/)) return 'variableName';
    if (stream.match(PATH)) return 'keyword';
    if (stream.match(KEYWORDS)) return 'keyword';
    if (stream.match(/^[+-]?\d+([.,]\d+)?/)) return 'number';
    if (stream.match(/^"[^"]*"?/)) return 'string';
    if (stream.match(/^[A-Z_][A-Z0-9_.]*/i)) return null;
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: ';' } },
});

const style = HighlightStyle.define([
  { tag: t.lineComment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: t.comment, color: 'var(--cm-comment)', fontStyle: 'italic' },
  { tag: t.meta, color: 'var(--cm-blocknr)' },
  { tag: t.keyword, color: 'var(--cm-keyword)', fontWeight: '600' },
  { tag: t.propertyName, color: 'var(--cm-axis)' },
  { tag: t.attributeName, color: 'var(--cm-feed)' },
  { tag: t.variableName, color: 'var(--cm-q)' },
  { tag: t.modifier, color: 'var(--cm-mod)' },
  { tag: t.number, color: 'var(--cm-number)' },
  { tag: t.string, color: 'var(--cm-string)' },
]);

export const klartextHighlight: Extension = syntaxHighlighting(style);

/** The interpreter's report (fetched elsewhere) as editor diagnostics on the lines it names. */
export function reportDiagnostics(doc: Text, r: Report | null): CmDiagnostic[] {
  if (!r) return [];
  const out: CmDiagnostic[] = [];
  const at = (line: number) => {
    const l = doc.line(Math.min(Math.max(line, 1), doc.lines));
    return { from: l.from, to: l.to };
  };
  for (const e of r.errors) out.push({ ...at(e.line), severity: 'error', message: e.msg, source: 'interpreter' });
  for (const e of r.events) out.push({ ...at(e.line), severity: e.sev === 'crash' ? 'error' : 'warning', message: e.msg, source: 'simulation' });
  return out;
}
