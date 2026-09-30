import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ago } from '../lib/format';

export function Admin() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['admin-users'], queryFn: api.adminUsers });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-users'] });
  const [f, setF] = useState({ email: '', name: '', password: '', admin: false });
  const create = useMutation({
    mutationFn: () => api.adminCreateUser(f),
    onSuccess: () => {
      setF({ email: '', name: '', password: '', admin: false });
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: (a: { id: string; b: Parameters<typeof api.adminUpdateUser>[1] }) => api.adminUpdateUser(a.id, a.b),
    onSuccess: refresh,
  });

  return (
    <div className="page stack-l">
      <h2>Users</h2>
      {users.error && <div className="error">{users.error.message}</div>}
      {update.error && <div className="error">{update.error.message}</div>}
      <table className="grid">
        <thead>
          <tr>
            <th>Name</th>
            <th>E-mail</th>
            <th>Role</th>
            <th>Programs</th>
            <th>Last seen</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.data?.map((u) => (
            <tr key={u.id} className={u.disabled ? 'dim' : ''}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>{u.programs}</td>
              <td>{ago(u.last_seen)}</td>
              <td className="row gap-s">
                {u.id !== user?.id && (
                  <>
                    <button className="small" onClick={() => update.mutate({ id: u.id, b: { role: u.role === 'admin' ? 'user' : 'admin' } })}>
                      {u.role === 'admin' ? 'Make user' : 'Make admin'}
                    </button>
                    <button className="small" onClick={() => update.mutate({ id: u.id, b: { disabled: !u.disabled } })}>
                      {u.disabled ? 'Enable' : 'Disable'}
                    </button>
                  </>
                )}
                <button
                  className="small ghost"
                  onClick={() => {
                    const p = prompt(`New password for ${u.name} (8+ characters)`);
                    if (p) update.mutate({ id: u.id, b: { password: p } });
                  }}
                >
                  Set password
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <form
        className="card stack"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <h3>Add an account</h3>
        <div className="row gap-s wrap">
          <input type="email" placeholder="E-mail" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <input placeholder="Name" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <input
            type="password"
            placeholder="Password (8+)"
            minLength={8}
            required
            autoComplete="new-password"
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
          <label className="check">
            <input type="checkbox" checked={f.admin} onChange={(e) => setF({ ...f, admin: e.target.checked })} /> admin
          </label>
          <button className="primary" disabled={create.isPending}>
            Add
          </button>
        </div>
        {create.error && <div className="error">{create.error.message}</div>}
      </form>
    </div>
  );
}
