import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';

export function Layout() {
  const { user, info, signOut } = useAuth();
  return (
    <div className="shell">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          <span>TNC Library</span>
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Programs
          </NavLink>
          <NavLink to="/simulator">Simulator</NavLink>
          <NavLink to="/tools">Tool tables</NavLink>
          <NavLink to="/account">Account</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin">Users</NavLink>}
        </nav>
        <div className="topbar-right">
          {info && !info.interpreter && <span className="badge warn" title="Programs are stored but not checked">interpreter off</span>}
          <span className="muted">{user?.name}</span>
          <button className="ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
