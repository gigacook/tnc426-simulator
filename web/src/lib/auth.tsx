import { createContext, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './api';
import type { Info, User } from './types';

interface Auth {
  info: Info | undefined;
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['info'], queryFn: api.info, staleTime: 60_000 });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api.me().catch((e) => (e instanceof ApiError && e.status === 401 ? null : Promise.reject(e))),
    staleTime: 60_000,
  });
  const value: Auth = {
    info: info.data,
    user: me.data ?? null,
    loading: info.isLoading || me.isLoading,
    refresh: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['me'] }), qc.invalidateQueries({ queryKey: ['info'] })]);
    },
    signOut: async () => {
      await api.logout().catch(() => {});
      qc.clear();
      await qc.invalidateQueries();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): Auth {
  const a = useContext(Ctx);
  if (!a) throw new Error('useAuth outside AuthProvider');
  return a;
}
