import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { when } from '../lib/format';

export function Account() {
  const { user, info } = useAuth();
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: api.aiUsage, enabled: !!info?.ai.enabled });
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const pw = useMutation({
    mutationFn: () => api.changePassword(cur, next),
    onSuccess: () => {
      setCur('');
      setNext('');
    },
  });

  return (
    <div className="page narrow stack-l">
      <section className="card">
        <h2>{user?.name}</h2>
        <p className="muted">
          {user?.email} · {user?.role} · since {when(user?.created_at)}
        </p>
      </section>

      <section className="card">
        <h3>Password</h3>
        <form
          className="stack"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            pw.mutate();
          }}
        >
          <label>
            Current password
            <input type="password" autoComplete="current-password" required value={cur} onChange={(e) => setCur(e.target.value)} />
          </label>
          <label>
            New password (8 or more characters)
            <input type="password" autoComplete="new-password" minLength={8} required value={next} onChange={(e) => setNext(e.target.value)} />
          </label>
          <button className="primary" disabled={pw.isPending}>
            Change password
          </button>
          {pw.error && <div className="error">{pw.error.message}</div>}
          {pw.isSuccess && <div className="ok-text">Changed. Your other sessions were signed out.</div>}
        </form>
      </section>

      <section className="card">
        <h3>AI program generation</h3>
        {!info?.ai.enabled ? (
          <p className="muted">Off on this server (no OpenRouter key configured). The simulator can still use a key of your own.</p>
        ) : (
          <>
            <p className="muted">
              The server holds the OpenRouter key; the simulator's AI uses it with your session. Default model: <code>{info.ai.default_model}</code>.
            </p>
            {usage.data && (
              <div className="meter">
                <div className="meter-bar">
                  <div style={{ width: `${Math.min(100, (usage.data.cost_usd / Math.max(usage.data.budget_usd, 0.0001)) * 100)}%` }} />
                </div>
                <span className="small">
                  ${usage.data.cost_usd.toFixed(3)} of ${usage.data.budget_usd.toFixed(2)} this month · {usage.data.calls} requests
                </span>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h3>Server</h3>
        <dl className="stats">
          <dt>Server</dt>
          <dd>
            {info?.name} {info?.version}
          </dd>
          <dt>Interpreter</dt>
          <dd>{info?.interpreter ?? 'off — programs are stored unchecked'}</dd>
          <dt>Machines</dt>
          <dd>{info?.machines.map((m) => 'TNC ' + m).join(', ')}</dd>
        </dl>
      </section>
    </div>
  );
}
