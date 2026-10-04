import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

/** Sign in; or, on a new server, create the first (admin) account. */
export function SignIn() {
  const { info, refresh } = useAuth();
  const setup = !!info?.needs_setup;
  const [mode, setMode] = useState<'in' | 'up'>(setup ? 'up' : 'in');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const up = setup || mode === 'up';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (up) await api.signup(email, name, password);
      else await api.login(email, password);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (info?.local)
    return (
      <div className="panel-empty" role="alert">
        The desktop app signs you in when it starts. Close the app and open it again.
      </div>
    );

  return (
    <div className="center-page">
      <form className="card auth" onSubmit={submit}>
        <h1>
          <img src="/favicon.svg" alt="" width={28} height={28} /> TNC Library
        </h1>
        {setup ? (
          <p className="muted">A new server. Create the first account — it becomes the admin.</p>
        ) : (
          <p className="muted">Programs, versions and tool tables for the TNC 426 / 430 simulator.</p>
        )}
        <label>
          E-mail
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {up && (
          <label>
            Name
            <input required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label>
          Password
          <input
            type="password"
            required
            minLength={up ? 8 : undefined}
            autoComplete={up ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit" className="primary" disabled={busy}>
          {up ? 'Create account' : 'Sign in'}
        </button>
        {!setup && info?.signup && (
          <button type="button" className="link" onClick={() => setMode(up ? 'in' : 'up')}>
            {up ? 'I have an account' : 'Create an account'}
          </button>
        )}
        <p className="muted small">
          The simulator also runs on its own, without an account: <a href="/sim/">open it</a>.
        </p>
      </form>
    </div>
  );
}
