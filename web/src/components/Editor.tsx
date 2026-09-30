import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { forceLinting, lintGutter } from '@codemirror/lint';
import { klartextHighlight, klartextLanguage, reportLinter } from '../lib/klartext';
import type { Report } from '../lib/types';

interface Props {
  value: string;
  onChange?: (text: string) => void;
  report?: Report | null;
  readOnly?: boolean;
  onSave?: () => void;
  /** 1-based line to scroll to and select; bump `jump.n` to repeat the same line. */
  jump?: { line: number; n: number } | null;
}

/** CodeMirror 6 with Klartext highlighting; the interpreter report shows as lint marks. */
export function Editor({ value, onChange, report = null, readOnly = false, onSave, jump }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const reportRef = useRef(report);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const ro = useRef(new Compartment());
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          klartextLanguage,
          klartextHighlight,
          lintGutter(),
          reportLinter(() => reportRef.current),
          ro.current.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
          keymap.of([
            { key: 'Mod-s', preventDefault: true, run: () => (onSaveRef.current?.(), true) },
            ...defaultKeymap,
            ...historyKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // the view is created once; value/readOnly changes are pushed in below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // text replaced from outside (load, restore, the simulator): swap the doc without an echo
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
  }, [readOnly]);

  useEffect(() => {
    reportRef.current = report;
    if (view.current) forceLinting(view.current);
  }, [report]);

  useEffect(() => {
    const v = view.current;
    if (!v || !jump) return;
    const n = Math.min(Math.max(jump.line, 1), v.state.doc.lines);
    const l = v.state.doc.line(n);
    v.dispatch({ selection: { anchor: l.from, head: l.to }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
    v.focus();
  }, [jump]);

  return <div className="editor" ref={host} />;
}
