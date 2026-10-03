import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, bytes, duration } from '../lib/format';
import { StatusBadge } from '../components/ReportPanel';
import type { ImportReport, Machine } from '../lib/types';

export function Library() {
  const { info } = useAuth();
  const machines = info?.machines ?? ['426', '430'];
  const qc = useQueryClient();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const project = sp.get('project') ?? '';
  const machine = sp.get('machine') ?? '';
  const trash = sp.get('trash') === '1';
  const [q, setQ] = useState(sp.get('q') ?? '');
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };

  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const programs = useQuery({
    queryKey: ['programs', { project, machine, q: sp.get('q') ?? '', trash }],
    queryFn: () => api.programs({ project: project || undefined, machine: machine || undefined, q: sp.get('q') || undefined, trash }),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['programs'] });
    qc.invalidateQueries({ queryKey: ['projects'] });
  };

  // new program
  const [newName, setNewName] = useState('');
  const [newMachine, setNewMachine] = useState<Machine>(machine || '426');
  const create = useMutation({
    mutationFn: () => api.createProgram({ name: newName, machine: newMachine, project_id: project && project !== 'none' ? project : null }),
    onSuccess: (p) => {
      refresh();
      nav(`/programs/${p.id}`);
    },
  });

  // projects
  const addProject = useMutation({ mutationFn: (name: string) => api.createProject(name), onSuccess: refresh });
  const renameProject = useMutation({ mutationFn: (a: { id: string; name: string }) => api.renameProject(a.id, a.name), onSuccess: refresh });
  const dropProject = useMutation({
    mutationFn: (id: string) => api.deleteProject(id),
    onSuccess: () => {
      set('project', '');
      refresh();
    },
  });

  // import
  const fileInput = useRef<HTMLInputElement>(null);
  const [importMachine, setImportMachine] = useState<Machine>('426');
  const [imported, setImported] = useState<ImportReport | null>(null);
  const [drag, setDrag] = useState(false);
  const doImport = useMutation({
    mutationFn: (files: File[]) => api.importFiles(files, importMachine, project && project !== 'none' ? project : null),
    onSuccess: (r) => {
      setImported(r);
      refresh();
      qc.invalidateQueries({ queryKey: ['tools'] });
    },
  });
  const onFiles = (list: FileList | null) => list && list.length && doImport.mutate(Array.from(list));

  const restore = useMutation({ mutationFn: (id: string) => api.undeleteProgram(id), onSuccess: refresh });

  const projectName = (id: string | null) => projects.data?.find((p) => p.id === id)?.name;

  return (
    <div
      className={'library' + (drag ? ' dragging' : '')}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      <aside className="sidebar">
        <h3>Projects</h3>
        <ul className="navlist">
          <li className={!project && !trash ? 'active' : ''} onClick={() => setSp({}, { replace: true })}>
            All programs
          </li>
          <li className={project === 'none' ? 'active' : ''} onClick={() => set('project', 'none')}>
            Not in a project
          </li>
          {projects.data?.map((p) => (
            <li key={p.id} className={project === p.id ? 'active' : ''} onClick={() => set('project', p.id)}>
              <span>{p.name}</span>
              <span className="count">{p.program_count}</span>
            </li>
          ))}
        </ul>
        <button
          className="ghost small"
          onClick={() => {
            const n = prompt('New project name');
            if (n) addProject.mutate(n);
          }}
        >
          + New project
        </button>
        {project && project !== 'none' && (
          <div className="row gap-s">
            <button
              className="ghost small"
              onClick={() => {
                const n = prompt('Rename project', projectName(project));
                if (n) renameProject.mutate({ id: project, name: n });
              }}
            >
              Rename
            </button>
            <button
              className="ghost small danger"
              onClick={() => confirm('Delete this project? Its programs stay in the library.') && dropProject.mutate(project)}
            >
              Delete
            </button>
          </div>
        )}
        <hr />
        <ul className="navlist">
          <li className={trash ? 'active' : ''} onClick={() => set('trash', trash ? '' : '1')}>
            Trash
          </li>
        </ul>
        <hr />
        <a className="button ghost small" href={api.exportUrl()}>
          Export everything (.zip)
        </a>
      </aside>

      <section className="main-col">
        <div className="toolbar">
          <form
            className="row gap-s grow"
            onSubmit={(e) => {
              e.preventDefault();
              set('q', q.trim());
            }}
          >
            <input className="grow" aria-label="Search programs" placeholder="Search names and program text…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select aria-label="Machine" value={machine} onChange={(e) => set('machine', e.target.value)}>
              <option value="">All machines</option>
              {machines.map((m) => (
                <option key={m} value={m}>
                  TNC {m}
                </option>
              ))}
            </select>
          </form>
        </div>

        {!trash && (
          <div className="card-row">
            <form
              className="card inline-form"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                if (newName.trim()) create.mutate();
              }}
            >
              <strong>New program</strong>
              <input placeholder="NAME" value={newName} onChange={(e) => setNewName(e.target.value.toUpperCase())} maxLength={24} />
              <select value={newMachine} onChange={(e) => setNewMachine(e.target.value)}>
                {machines.map((m) => (
                  <option key={m} value={m}>
                    TNC {m}
                  </option>
                ))}
              </select>
              <button className="primary" disabled={create.isPending || !newName.trim()}>
                Create
              </button>
              {create.error && <span className="error">{create.error.message}</span>}
            </form>
            <div className="card inline-form">
              <strong>Import</strong>
              <select value={importMachine} onChange={(e) => setImportMachine(e.target.value)} title="Machine for plain .H files">
                {machines.map((m) => (
                  <option key={m} value={m}>
                    TNC {m}
                  </option>
                ))}
              </select>
              <button onClick={() => fileInput.current?.click()} disabled={doImport.isPending}>
                {doImport.isPending ? 'Importing…' : 'Choose files'}
              </button>
              <span className="muted small">.H .I .T .zip, or a simulator profile .json — or drop them here</span>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept=".h,.H,.i,.I,.t,.T,.zip,.json,.txt"
                onChange={(e) => {
                  onFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        )}

        {doImport.error && <div className="error">{doImport.error.message}</div>}
        {imported && <ImportSummary r={imported} onClose={() => setImported(null)} />}

        {programs.isLoading ? (
          <div className="panel-empty">Loading…</div>
        ) : programs.error ? (
          <div className="error">{programs.error.message}</div>
        ) : programs.data!.length === 0 ? (
          <div className="panel-empty">
            {trash ? 'The trash is empty.' : sp.get('q') ? 'Nothing matches.' : 'No programs yet — create one or drop .H files here.'}
          </div>
        ) : (
          <table className="grid programs">
            <thead>
              <tr>
                <th>Name</th>
                <th>Machine</th>
                <th>Project</th>
                <th>Check</th>
                <th>Cycle</th>
                <th>Ver.</th>
                <th>Size</th>
                <th>{trash ? 'Deleted' : 'Changed'}</th>
                {trash && <th />}
              </tr>
            </thead>
            <tbody>
              {programs.data!.map((p) => (
                <tr key={p.id}>
                  <td>{trash ? <span>{p.name}</span> : <Link to={`/programs/${p.id}`}>{p.name}</Link>}</td>
                  <td>TNC {p.machine}</td>
                  <td className="muted">{projectName(p.project_id) ?? ''}</td>
                  <td>
                    <StatusBadge ok={p.ok} errors={p.error_count} />
                  </td>
                  <td>{duration(p.cycle_time)}</td>
                  <td>v{p.version}</td>
                  <td>{bytes(p.size)}</td>
                  <td title={p.deleted_at ?? p.updated_at}>{ago(p.deleted_at ?? p.updated_at)}</td>
                  {trash && (
                    <td>
                      <button className="small" onClick={() => restore.mutate(p.id)}>
                        Restore
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {restore.error && <div className="error">{restore.error.message}</div>}
      </section>
    </div>
  );
}

function ImportSummary({ r, onClose }: { r: ImportReport; onClose: () => void }) {
  const line = (label: string, items: { name: string; machine: Machine; id: string }[]) =>
    items.length > 0 && (
      <div>
        <b>{label}</b>{' '}
        {items.map((i, n) => (
          <span key={i.id}>
            {n > 0 && ', '}
            <Link to={`/programs/${i.id}`}>{i.name}</Link>
          </span>
        ))}
      </div>
    );
  return (
    <div className="card notice">
      <button className="ghost close" onClick={onClose} aria-label="Close">
        ×
      </button>
      {line('New:', r.created)}
      {line('Updated:', r.updated)}
      {line('Unchanged:', r.unchanged)}
      {r.tools_added > 0 && <div>{r.tools_added} missing tools added to the tool table.</div>}
      {r.tool_tables.map((t) => (
        <div key={t}>Tool table: {t}</div>
      ))}
      {r.projects > 0 && <div>{r.projects} projects created.</div>}
      {r.skipped.map((s) => (
        <div key={s.name} className="error">
          Skipped {s.name}: {s.reason}
        </div>
      ))}
    </div>
  );
}
