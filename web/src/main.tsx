import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { Layout } from './components/Layout';
import { SignIn } from './pages/SignIn';
import { Library } from './pages/Library';
import { Program } from './pages/Program';
import { Simulator } from './pages/Simulator';
import { Tools } from './pages/Tools';
import { Account } from './pages/Account';
import { Admin } from './pages/Admin';
import { SharePage } from './pages/SharePage';
import './styles.css';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

/** Signed-in pages; otherwise the sign-in (or first-account) form. */
function Private() {
  const { user, loading, info } = useAuth();
  if (loading) return <div className="panel-empty">Connecting to the server…</div>;
  if (!info) return <div className="panel-empty error">The TNC server does not answer at /api/v1.</div>;
  if (!user) return <SignIn />;
  return <Layout />;
}

function AdminOnly() {
  const { user } = useAuth();
  return user?.role === 'admin' ? <Admin /> : <Navigate to="/" replace />;
}

const router = createBrowserRouter([
  { path: '/s/:token', element: <SharePage /> },
  {
    element: <Private />,
    children: [
      { index: true, element: <Library /> },
      { path: 'programs/:id', element: <Program /> },
      { path: 'simulator', element: <Simulator /> },
      { path: 'tools', element: <Tools /> },
      { path: 'account', element: <Account /> },
      { path: 'admin', element: <AdminOnly /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
