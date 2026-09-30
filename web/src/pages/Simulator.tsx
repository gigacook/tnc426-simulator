import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { SimFrame, type SimHandle, type SimMessage } from '../components/SimFrame';
import type { Machine } from '../lib/types';

/** The whole simulator, with a button that stores whatever program is on its screen in the library. */
export function Simulator() {
  const sim = useRef<SimHandle>(null);
  const qc = useQueryClient();
  const [onScreen, setOnScreen] = useState<{ name: string; machine: Machine } | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string; id?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const onMessage = (m: SimMessage) => {
    if (m.type === 'tnc:selected' || m.type === 'tnc:changed') setOnScreen({ name: m.name, machine: m.machine });
  };

  async function store() {
    setBusy(true);
    setStatus(null);
    try {
      const p = await sim.current!.current();
      const same = (await api.programs({ machine: p.machine, q: p.name.replace(/\.H$/, '') })).find((x) => x.name === p.name);
      if (same) {
        const r = await api.saveProgram(same.id, { content: p.text, message: 'from the simulator', source: 'simulator' });
        setStatus({ ok: true, id: same.id, text: r.changed ? `${p.name} saved as v${r.version}.` : `${p.name} is unchanged (v${r.version}).` });
      } else {
        const r = await api.createProgram({ name: p.name, machine: p.machine, content: p.text, message: 'from the simulator', source: 'simulator' });
        setStatus({ ok: true, id: r.id, text: `${r.name} added to the library.` });
      }
      qc.invalidateQueries({ queryKey: ['programs'] });
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sim-page">
      <div className="toolbar">
        <span className="muted">{onScreen ? `On screen: ${onScreen.name} · TNC ${onScreen.machine}` : 'Programs you open in the simulator can be stored in your library.'}</span>
        <div className="row gap-s">
          {status && (
            <span className={status.ok ? 'ok-text' : 'error'}>
              {status.text} {status.id && <Link to={`/programs/${status.id}`}>Open</Link>}
            </span>
          )}
          <button className="primary" onClick={store} disabled={busy}>
            {busy ? 'Saving…' : 'Save to library'}
          </button>
        </div>
      </div>
      <SimFrame ref={sim} onMessage={onMessage} />
    </div>
  );
}
