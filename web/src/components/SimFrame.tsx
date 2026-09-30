import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Machine, Tool } from '../lib/types';

/** What the simulator (bridge.js) tells the app. */
export type SimMessage =
  | { type: 'tnc:ready' }
  | { type: 'tnc:changed'; name: string; machine: Machine; text: string }
  | { type: 'tnc:selected'; name: string; machine: Machine }
  | { type: 'tnc:program'; id: string; name: string; machine: Machine; text: string };

export interface SimHandle {
  open(p: { name: string; text: string; machine: Machine; tools?: Tool[] }): void;
  /** The program on the simulator's screen right now. */
  current(): Promise<{ name: string; machine: Machine; text: string }>;
}

interface Props {
  /** Opened as soon as the simulator says it is ready (and again whenever it changes identity). */
  program?: { name: string; text: string; machine: Machine; tools?: Tool[] } | null;
  onMessage?: (m: SimMessage) => void;
}

/**
 * The single-file simulator served by tnc-server at /sim/, in an iframe on the same origin.
 * bridge.js inside it only accepts messages from this exact parent and origin, and we only
 * accept messages from this exact frame and origin.
 */
export const SimFrame = forwardRef<SimHandle, Props>(function SimFrame({ program, onMessage }, ref) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const pending = useRef(new Map<string, (p: { name: string; machine: Machine; text: string }) => void>());
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const post = (msg: unknown) => frame.current?.contentWindow?.postMessage(msg, location.origin);

  useEffect(() => {
    function listen(e: MessageEvent) {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return;
      const m = e.data as SimMessage;
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
      if (m.type === 'tnc:ready') setReady(true);
      if (m.type === 'tnc:program') {
        pending.current.get(m.id)?.(m);
        pending.current.delete(m.id);
      }
      onMessageRef.current?.(m);
    }
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  // open the program when the sim is ready or a different program is handed in
  const key = program ? `${program.machine}:${program.name}` : '';
  useEffect(() => {
    if (ready && program) post({ type: 'tnc:open', ...program });
    // text is deliberately not a dependency: edits flow the other way while the sim is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, key]);

  useImperativeHandle(ref, () => ({
    open: (p) => post({ type: 'tnc:open', ...p }),
    current: () =>
      new Promise((resolve, reject) => {
        const id = Math.random().toString(36).slice(2);
        pending.current.set(id, resolve);
        post({ type: 'tnc:get', id });
        setTimeout(() => pending.current.has(id) && (pending.current.delete(id), reject(new Error('the simulator did not answer'))), 3000);
      }),
  }));

  return (
    <div className="simframe">
      {!ready && <div className="simframe-loading">Loading the simulator…</div>}
      <iframe ref={frame} src="/sim/" title="TNC simulator" allow="fullscreen; clipboard-read; clipboard-write" />
    </div>
  );
});
