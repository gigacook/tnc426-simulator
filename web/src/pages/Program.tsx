import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago, bytes, duration, when } from '../lib/format';
import { Editor } from '../components/Editor';
import { ReportPanel, StatusBadge } from '../components/ReportPanel';
import { SimFrame, type SimMessage } from '../components/SimFrame';
import type { ProgramDetail, Report } from '../lib/types';

type View = 'code' | 'split' | 'sim';
type Tab = 'check' | 'versions' | 'share' | 'details';

/** The simulator names programs NAME.H, upper case; so does the server. */
const simName = (n: string) => String(n).toUpperCase().replace(/\.[HI]$/, '').replace(/[^A-Z0-9_]/g, '_').slice(0, 16) + '.H';

export function Program() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['program', id], queryFn: () => api.program(id) });

  if (detail.isLoading) return <div className="panel-empty">Loading…</div>;
  if (detail.error)
    return (
      <div className="panel-empty">
        <div className="error">{detail.error.message}</div>
        <Link to="/">Back to the library</Link>
      </div>
    );
  // remount the workspace per program so drafts never leak between programs
  return <Workspace key={id} program={detail.data!} onSaved={(p) => qc.setQueryData(['program', id], p)} />;
}

function Workspace({ program, onSaved }: { program: ProgramDetail; onSaved: (p: ProgramDetail) => void }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(program.content);
  const [base, setBase] = useState(program.version);
  const [saved, setSaved] = useState(program.content);
  const [savedReport, setSavedReport] = useState<Report | null>(program.report);
  const [report, setReport] = useState<Report | null>(program.report);
  const [checking, setChecking] = useState(false);
  const [view, setView] = useState<View>(() => (localStorage.getItem('tnc.view') as View) || 'code');
  const [tab, setTab] = useState<Tab>('check');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<string | null>(null);
  const [jump, setJump] = useState<{ line: number; n: number } | null>(null);
  const dirty = draft !== saved;

  /** A version the server now holds becomes the editor's base. */
  const adopt = (p: ProgramDetail) => {
    setBase(p.version);
    setSaved(p.content);
    setDraft(p.content);
    setSavedReport(p.report);
    setReport(p.report);
    setConflict(null);
    onSaved(p);
  };

  useEffect(() => {
    try {
      localStorage.setItem('tnc.view', view);
    } catch {
      /* private mode */
    }
  }, [view]);

  // live check while typing (not saved)
  useEffect(() => {
    if (!dirty) {
      setReport(savedReport);
      setChecking(false);
      return;
    }
    setChecking(true);
    const t = setTimeout(() => {
      api
        .check(draft, program.machine)
        .then(setReport)
        .catch(() => {})
        .finally(() => setChecking(false));
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // don't lose edits on close
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: (force: boolean) =>
      api.saveProgram(program.id, {
        content: draft,
        base_version: force ? undefined : base,
        message: message.trim() || undefined,
        source: view === 'code' ? 'edit' : 'simulator',
      }),
    onSuccess: (p) => {
      adopt(p);
      setMessage('');
      qc.invalidateQueries({ queryKey: ['programs'] });
      qc.invalidateQueries({ queryKey: ['versions', program.id] });
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) setConflict(e.message);
    },
  });
  const doSave = () => dirty && !save.isPending && save.mutate(false);

  const tools = useQuery({ queryKey: ['tools', program.machine], queryFn: () => api.tools(program.machine) });

  const onSim = (m: SimMessage) => {
    if (m.type === 'tnc:changed' && m.machine === program.machine && m.name === simName(program.name)) setDraft(m.text);
  };

  const reload = async () => adopt(await api.program(program.id));

  return (
    <div className="workspace">
      <div className="ws-head">
        <div className="ws-title">
          <Link to="/" className="muted">
            Programs
          </Link>
          <span className="muted">/</span>
          <h2>{program.name}</h2>
          <span className="badge muted">TNC {program.machine}</span>
          <span className="muted small">
            v{base}
            {dirty && ' · unsaved changes'}
          </span>
        </div>
        <div className="row gap-s">
          <div className="seg">
            {(['code', 'split', 'sim'] as View[]).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {v === 'code' ? 'Editor' : v === 'split' ? 'Split' : 'Simulator'}
              </button>
            ))}
          </div>
          <input className="msg" placeholder="What changed? (optional)" value={message} onChange={(e) => setMessage(e.target.value)} />
          <button className="primary" disabled={!dirty || save.isPending} onClick={doSave} title="Ctrl/⌘ S">
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {conflict && (
        <div className="card notice warn">
          <b>Changed elsewhere.</b> {conflict}
          <div className="row gap-s">
            <button onClick={reload}>Load theirs (drop mine)</button>
            <button className="danger" onClick={() => save.mutate(true)}>
              Save mine as the newest version
            </button>
          </div>
        </div>
      )}
      {save.error && !conflict && <div className="error">{save.error.message}</div>}

      <div className={'ws-body view-' + view}>
        {view !== 'sim' && (
          <div className="ws-editor">
            <Editor value={draft} onChange={setDraft} report={report} onSave={doSave} jump={jump} />
          </div>
        )}
        {view !== 'code' && (
          <div className="ws-sim">
            <SimFrame
              program={{ name: program.name, text: draft, machine: program.machine, tools: tools.data?.tools }}
              onMessage={onSim}
            />
          </div>
        )}
        {view === 'code' && (
          <aside className="ws-side">
            <div className="tabs">
              {(['check', 'versions', 'share', 'details'] as Tab[]).map((t) => (
                <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                  {t[0].toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            <div className="tab-body">
              {tab === 'check' && <ReportPanel report={report} checking={checking} onLine={(line) => setJump({ line, n: Date.now() })} />}
              {tab === 'versions' && (
                <Versions
                  program={program}
                  current={base}
                  dirty={dirty}
                  onRestored={adopt}
                  onPreview={(text) => setDraft(text)}
                />
              )}
              {tab === 'share' && <Shares programId={program.id} version={base} />}
              {tab === 'details' && <Details program={program} version={base} />}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function Versions({
  program,
  current,
  dirty,
  onRestored,
  onPreview,
}: {
  program: ProgramDetail;
  current: number;
  dirty: boolean;
  onRestored: (p: ProgramDetail) => void;
  onPreview: (text: string) => void;
}) {
  const qc = useQueryClient();
  const versions = useQuery({ queryKey: ['versions', program.id, current], queryFn: () => api.versions(program.id) });
  const restore = useMutation({
    mutationFn: (v: number) => api.restore(program.id, v),
    onSuccess: (p) => {
      onRestored(p);
      qc.invalidateQueries({ queryKey: ['programs'] });
      qc.invalidateQueries({ queryKey: ['versions', program.id] });
    },
  });
  const load = async (v: number) => {
    if (dirty && !confirm('Replace your unsaved changes with version ' + v + '?')) return;
    const d = await api.version(program.id, v);
    onPreview(d.content);
  };
  if (versions.isLoading) return <div className="panel-empty">Loading…</div>;
  return (
    <div>
      {restore.error && <div className="error">{restore.error.message}</div>}
      <ul className="versions">
        {versions.data?.map((v) => (
          <li key={v.version} className={v.version === current ? 'current' : ''}>
            <div className="row between">
              <b>v{v.version}</b>
              <StatusBadge ok={v.ok} errors={v.error_count} />
            </div>
            <div className="muted small" title={when(v.created_at)}>
              {ago(v.created_at)} · {v.source}
              {v.author ? ` · ${v.author}` : ''} · {bytes(v.size)} · {duration(v.cycle_time)}
            </div>
            {v.message && <div className="small">{v.message}</div>}
            {v.version !== current && (
              <div className="row gap-s">
                <button className="small" onClick={() => load(v.version)} title="Put this text in the editor; saving makes it the newest version">
                  Open in editor
                </button>
                <button className="small" onClick={() => restore.mutate(v.version)} disabled={restore.isPending}>
                  Restore
                </button>
                <a className="button small ghost" href={api.downloadUrl(program.id, { version: v.version })}>
                  Download
                </a>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Shares({ programId, version }: { programId: string; version: number }) {
  const qc = useQueryClient();
  const shares = useQuery({ queryKey: ['shares', programId], queryFn: () => api.shares(programId) });
  const [pin, setPin] = useState(false);
  const [days, setDays] = useState(0);
  const [copied, setCopied] = useState('');
  const create = useMutation({
    mutationFn: () => api.createShare(programId, { version: pin ? version : undefined, expires_days: days || undefined }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shares', programId] }),
  });
  const revoke = useMutation({
    mutationFn: (t: string) => api.revokeShare(t),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shares', programId] }),
  });
  const copy = (url: string) => navigator.clipboard?.writeText(url).then(() => setCopied(url));
  return (
    <div className="shares">
      <p className="muted small">A read-only link: anyone with it sees the program and its check, and can download it. Signed-in users can copy it into their library.</p>
      <div className="stack">
        <label className="check">
          <input type="checkbox" checked={pin} onChange={(e) => setPin(e.target.checked)} /> Pin to v{version} (else always the newest)
        </label>
        <label>
          Expires
          <select value={days} onChange={(e) => setDays(+e.target.value)}>
            <option value={0}>never</option>
            <option value={1}>in 1 day</option>
            <option value={7}>in 7 days</option>
            <option value={30}>in 30 days</option>
          </select>
        </label>
        <button className="primary" onClick={() => create.mutate()} disabled={create.isPending}>
          Create link
        </button>
      </div>
      {create.error && <div className="error">{create.error.message}</div>}
      <ul className="versions">
        {shares.data?.map((s) => {
          const live = !s.revoked_at && !(s.expires_at && s.expires_at < new Date().toISOString());
          return (
            <li key={s.token} className={live ? '' : 'dim'}>
              <div className="row between">
                <code className="small ellipsis">{s.url}</code>
              </div>
              <div className="muted small">
                {s.version ? `v${s.version}` : 'newest'} · made {ago(s.created_at)}
                {s.expires_at && ` · expires ${when(s.expires_at)}`}
                {s.revoked_at && ' · revoked'}
              </div>
              {live && (
                <div className="row gap-s">
                  <button className="small" onClick={() => copy(s.url)}>
                    {copied === s.url ? 'Copied' : 'Copy'}
                  </button>
                  <a className="button small ghost" href={s.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                  <button className="small danger" onClick={() => revoke.mutate(s.token)}>
                    Revoke
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Details({ program, version }: { program: ProgramDetail; version: number }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const { info } = useAuth();
  const projects = useQuery({ queryKey: ['projects'], queryFn: api.projects });
  const [name, setName] = useState(program.name.replace(/\.H$/, ''));
  const [machine, setMachine] = useState(program.machine);
  const [project, setProject] = useState(program.project_id ?? '');
  const nameRef = useRef(program.name);
  const update = useMutation({
    mutationFn: () => api.updateProgram(program.id, { name, machine, project_id: project || null }),
    onSuccess: (p) => {
      nameRef.current = p.name;
      qc.invalidateQueries({ queryKey: ['program', program.id] });
      qc.invalidateQueries({ queryKey: ['programs'] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteProgram(program.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['programs'] });
      nav('/');
    },
  });
  return (
    <div className="stack">
      <label>
        Name
        <input value={name} maxLength={16} onChange={(e) => setName(e.target.value.toUpperCase())} />
      </label>
      <label>
        Machine
        <select value={machine} onChange={(e) => setMachine(e.target.value)}>
          {(info?.machines ?? ['426', '430']).map((m) => (
            <option key={m} value={m}>
              TNC {m}
            </option>
          ))}
        </select>
      </label>
      <label>
        Project
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">— none —</option>
          {projects.data?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <button onClick={() => update.mutate()} disabled={update.isPending}>
        Apply
      </button>
      {update.error && <div className="error">{update.error.message}</div>}
      {update.isSuccess && <div className="muted small">Saved as {nameRef.current}.</div>}

      <hr />
      <div className="row gap-s wrap">
        <a className="button" href={api.downloadUrl(program.id, { version })}>
          Download {program.name}
        </a>
        <a className="button ghost" href={api.downloadUrl(program.id, { version, encoding: 'cp1252' })} title="Windows-1252, what the control's file transfer reads">
          Download for the control (cp1252)
        </a>
      </div>
      <p className="muted small">
        Created {when(program.created_at)} · last saved {when(program.updated_at)}
      </p>
      <hr />
      <button className="danger" onClick={() => confirm(`Move ${program.name} to the trash? Every version is kept.`) && remove.mutate()}>
        Move to trash
      </button>
    </div>
  );
}
