import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago } from '../lib/format';
import type { Machine, Tool } from '../lib/types';

const HOLDERS = ['ISO50', 'SK40'];

/** The operator's tool table per machine: it overrides the built-in tools by number in every check. */
export function Tools() {
  const { info } = useAuth();
  const machines = info?.machines ?? ['426', '430'];
  const [machine, setMachine] = useState<Machine>('426');
  const qc = useQueryClient();
  const table = useQuery({ queryKey: ['tools', machine], queryFn: () => api.tools(machine) });
  const [rows, setRows] = useState<Tool[]>([]);
  const [holder, setHolder] = useState('ISO50');
  const [showBuiltin, setShowBuiltin] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (table.data) {
      setRows(table.data.tools);
      setHolder(table.data.holder);
    }
  }, [table.data]);

  const done = (t: Awaited<ReturnType<typeof api.tools>>) => {
    qc.setQueryData(['tools', machine], t);
    qc.invalidateQueries({ queryKey: ['programs'] });
  };
  const save = useMutation({ mutationFn: () => api.saveTools(machine, rows, holder), onSuccess: done });
  const upload = useMutation({ mutationFn: (f: File) => api.uploadToolT(machine, f), onSuccess: done });

  const dirty = table.data && (JSON.stringify(rows) !== JSON.stringify(table.data.tools) || holder !== table.data.holder);
  const setRow = (i: number, patch: Partial<Tool>) => setRows((r) => r.map((t, n) => (n === i ? { ...t, ...patch } : t)));
  const dup = new Set(rows.map((r) => r.t).filter((t, i, a) => a.indexOf(t) !== i));

  return (
    <div className="page narrow">
      <div className="toolbar">
        <h2>Tool tables</h2>
        <div className="seg">
          {machines.map((m) => (
            <button key={m} className={m === machine ? 'on' : ''} onClick={() => setMachine(m)}>
              TNC {m}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        Your tools replace the built-in ones with the same number when programs are checked and simulated. L = 0 means the length is unknown (the holder
        check is skipped).
      </p>

      {table.isLoading ? (
        <div className="panel-empty">Loading…</div>
      ) : table.error ? (
        <div className="error">{table.error.message}</div>
      ) : (
        <>
          <div className="row gap-s wrap">
            <label className="inline">
              Holder
              <select value={holder} onChange={(e) => setHolder(e.target.value)}>
                {[...new Set([...HOLDERS, holder])].map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </select>
            </label>
            <button onClick={() => setRows((r) => [...r, { t: Math.max(0, ...r.map((x) => x.t)) + 1, name: '', l: 0, r: 5 }])}>+ Tool</button>
            <button onClick={() => file.current?.click()} disabled={upload.isPending}>
              Replace from TOOL.T…
            </button>
            <a className="button ghost" href={api.toolTUrl(machine)}>
              Download TOOL.T
            </a>
            <span className="grow" />
            <span className="muted small">{table.data?.updated_at ? 'saved ' + ago(table.data.updated_at) : 'not saved yet'}</span>
            <button className="primary" disabled={!dirty || save.isPending || dup.size > 0} onClick={() => save.mutate()}>
              Save
            </button>
            <input
              ref={file}
              type="file"
              hidden
              accept=".t,.T,.txt"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = '';
              }}
            />
          </div>
          {(save.error || upload.error) && <div className="error">{(save.error || upload.error)!.message}</div>}
          {dup.size > 0 && <div className="error">Tool numbers used twice: {[...dup].join(', ')}</div>}

          <table className="grid tools">
            <thead>
              <tr>
                <th>T</th>
                <th>Name</th>
                <th>L (mm)</th>
                <th>R (mm)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No tools of your own — the built-in table applies.
                  </td>
                </tr>
              )}
              {rows.map((t, i) => (
                <tr key={i} className={dup.has(t.t) ? 'bad-row' : ''}>
                  <td>
                    <input type="number" min={0} max={32767} value={t.t} onChange={(e) => setRow(i, { t: +e.target.value })} />
                  </td>
                  <td>
                    <input value={t.name} maxLength={16} onChange={(e) => setRow(i, { name: e.target.value.toUpperCase() })} />
                  </td>
                  <td>
                    <input type="number" step="0.001" value={t.l} onChange={(e) => setRow(i, { l: +e.target.value })} />
                  </td>
                  <td>
                    <input type="number" step="0.001" min={0} value={t.r} onChange={(e) => setRow(i, { r: +e.target.value })} />
                  </td>
                  <td>
                    <button className="ghost small danger" onClick={() => setRows((r) => r.filter((_, n) => n !== i))} aria-label="Remove">
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button className="link" onClick={() => setShowBuiltin(!showBuiltin)}>
            {showBuiltin ? 'Hide' : 'Show'} the built-in table ({table.data?.builtin.length ?? 0})
          </button>
          {showBuiltin && (
            <table className="grid small">
              <thead>
                <tr>
                  <th>T</th>
                  <th>Name</th>
                  <th>L</th>
                  <th>R</th>
                </tr>
              </thead>
              <tbody>
                {table.data?.builtin.map((t) => (
                  <tr key={t.t} className={rows.some((r) => r.t === t.t) ? 'dim' : ''}>
                    <td>{t.t}</td>
                    <td>{t.name}</td>
                    <td>{t.l}</td>
                    <td>{t.r}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
