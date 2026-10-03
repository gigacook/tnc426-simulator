import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../lib/auth';

export function Layout() {
  const { user, info, signOut } = useAuth();
  // phones: the page links fold behind a Menu button (disclosure); wide screens show them inline
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          <span>TNC Library</span>
        </NavLink>
        <button
          ref={toggle}
          type="button"
          className="ghost nav-toggle"
          aria-expanded={open}
          aria-controls="site-nav"
          onClick={() => setOpen((o) => !o)}
        >
          <span aria-hidden="true">☰</span> Menu
        </button>
        <nav id="site-nav" aria-label="Pages" className={open ? 'open' : undefined}>
          <NavLink to="/" end>
            Programs
          </NavLink>
          <NavLink to="/simulator">Simulator</NavLink>
          <NavLink to="/tools">Tool tables</NavLink>
          <NavLink to="/account">Account</NavLink>
          {user?.role === 'admin' && <NavLink to="/admin">Users</NavLink>}
        </nav>
        <div className="topbar-right">
          {info && !info.interpreter && (
            <span className="badge warn" title="Programs are stored but not checked">
              interpreter off
            </span>
          )}
          <span className="muted">{user?.name}</span>
          {!info?.local && (
            <button className="ghost" onClick={signOut}>
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="content" id="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
