import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { when } from '../lib/format';
import { Editor } from '../components/Editor';
import { ReportPanel } from '../components/ReportPanel';

/** /s/:token — a program someone shared. Readable without an account. */
export function SharePage() {
  const { token = '' } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const share = useQuery({ queryKey: ['share', token], queryFn: () => api.publicShare(token), retry: false });
  const [jump, setJump] = useState<{ line: number; n: number } | null>(null);
  const copy = useMutation({ mutationFn: () => api.copyShare(token), onSuccess: (p) => nav(`/programs/${p.id}`) });

  if (share.isLoading) return <div className="panel-empty">Loading…</div>;
  if (share.error)
    return (
      <div className="center-page">
        <div className="card">
          <h2>Link not available</h2>
          <p className="muted">It was revoked, it expired, or the program was deleted.</p>
          <Link to="/">TNC Library</Link>
        </div>
      </div>
    );
  const s = share.data!;
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/" className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          <span>TNC Library</span>
        </Link>
        <div className="topbar-right">
          <span className="muted">shared by {s.owner_name}</span>
        </div>
      </header>
      <main className="content">
        <div className="workspace">
          <div className="ws-head">
            <div className="ws-title">
              <h2>{s.name}</h2>
              <span className="badge muted">TNC {s.machine}</span>
              <span className="muted small">
                v{s.version}
                {s.version !== s.latest_version && ` (newest is v${s.latest_version})`} · {when(s.updated_at)}
              </span>
            </div>
            <div className="row gap-s">
              <a className="button" href={api.publicDownloadUrl(token)}>
                Download
              </a>
              <a className="button ghost" href={api.publicDownloadUrl(token, 'cp1252')}>
                For the control (cp1252)
              </a>
              {user ? (
                <button className="primary" onClick={() => copy.mutate()} disabled={copy.isPending}>
                  Copy to my library
                </button>
              ) : (
                <Link className="button primary" to="/">
                  Sign in to copy
                </Link>
              )}
            </div>
          </div>
          {copy.error && <div className="error">{copy.error.message}</div>}
          <div className="ws-body view-code">
            <div className="ws-editor">
              <Editor value={s.content} readOnly report={s.report} jump={jump} />
            </div>
            <aside className="ws-side">
              <div className="tab-body">
                <ReportPanel report={s.report} onLine={(line) => setJump({ line, n: Date.now() })} />
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  );
}
