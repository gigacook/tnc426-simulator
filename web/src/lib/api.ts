// The tnc-server JSON API. The session rides in the HttpOnly cookie the server sets at sign-in,
// so nothing secret is kept in JavaScript; writes are same-origin (the server checks Origin).
import type {
  AdminUserRow, AiUsage, ImportReport, Info, Machine, ProgramDetail, ProgramSummary, Project,
  PublicShare, Report, Share, Tool, ToolTable, User, VersionRow,
} from './types';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body instanceof Blob || typeof body === 'string') {
    init.body = body;
    (init.headers as Record<string, string>)['Content-Type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(BASE + path, init);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data && data.error) || {};
    const { code, message, ...details } = e;
    throw new ApiError(res.status, code || 'http_' + res.status, message || res.statusText, details);
  }
  return data as T;
}

const qs = (o: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== false) p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
};

export const api = {
  info: () => req<Info>('GET', '/info'),

  me: () => req<User>('GET', '/me'),
  login: (email: string, password: string) => req<{ user: User }>('POST', '/auth/login', { email, password }),
  signup: (email: string, name: string, password: string) => req<{ user: User }>('POST', '/auth/signup', { email, name, password }),
  logout: () => req<void>('POST', '/auth/logout'),
  changePassword: (current: string, next: string) => req<void>('POST', '/auth/password', { current, new: next }),

  programs: (q: { machine?: string; project?: string; q?: string; trash?: boolean } = {}) =>
    req<ProgramSummary[]>('GET', '/programs' + qs(q)),
  program: (id: string) => req<ProgramDetail>('GET', `/programs/${id}`),
  createProgram: (b: { name: string; machine: Machine; content?: string; project_id?: string | null; message?: string; source?: string }) =>
    req<ProgramDetail>('POST', '/programs', b),
  saveProgram: (id: string, b: { content: string; base_version?: number; message?: string; source?: string }) =>
    req<ProgramDetail & { changed: boolean }>('PUT', `/programs/${id}`, b),
  updateProgram: (id: string, b: { name?: string; machine?: Machine; project_id?: string | null }) =>
    req<ProgramSummary>('PATCH', `/programs/${id}`, b),
  deleteProgram: (id: string) => req<void>('DELETE', `/programs/${id}`),
  undeleteProgram: (id: string) => req<ProgramSummary>('POST', `/programs/${id}/undelete`),
  versions: (id: string) => req<VersionRow[]>('GET', `/programs/${id}/versions`),
  version: (id: string, v: number) => req<ProgramDetail>('GET', `/programs/${id}/versions/${v}`),
  restore: (id: string, v: number) => req<ProgramDetail>('POST', `/programs/${id}/versions/${v}/restore`),
  downloadUrl: (id: string, o: { version?: number; encoding?: 'utf8' | 'cp1252' } = {}) => `${BASE}/programs/${id}/download${qs(o)}`,
  check: (content: string, machine: Machine) => req<Report>('POST', '/check', { content, machine }),

  projects: () => req<Project[]>('GET', '/projects'),
  createProject: (name: string) => req<Project>('POST', '/projects', { name }),
  renameProject: (id: string, name: string) => req<Project>('PATCH', `/projects/${id}`, { name }),
  deleteProject: (id: string) => req<void>('DELETE', `/projects/${id}`),

  tools: (machine: Machine) => req<ToolTable>('GET', `/tools/${machine}`),
  saveTools: (machine: Machine, tools: Tool[], holder?: string) => req<ToolTable>('PUT', `/tools/${machine}`, { tools, holder }),
  uploadToolT: (machine: Machine, file: Blob) => req<ToolTable>('PUT', `/tools/${machine}/tool.t`, file),
  toolTUrl: (machine: Machine) => `${BASE}/tools/${machine}/tool.t`,

  shares: (id: string) => req<Share[]>('GET', `/programs/${id}/shares`),
  createShare: (id: string, b: { version?: number; expires_days?: number } = {}) => req<Share>('POST', `/programs/${id}/shares`, b),
  revokeShare: (token: string) => req<void>('DELETE', `/shares/${token}`),
  copyShare: (token: string) => req<ProgramSummary>('POST', `/shares/${token}/copy`),
  publicShare: (token: string) => req<PublicShare>('GET', `/public/shares/${token}`),
  publicDownloadUrl: (token: string, encoding?: 'cp1252') => `${BASE}/public/shares/${token}/download${qs({ encoding })}`,

  importFiles: (files: File[], machine: Machine, projectId?: string | null) => {
    const fd = new FormData();
    fd.set('machine', machine);
    if (projectId) fd.set('project_id', projectId);
    for (const f of files) fd.append('file', f, f.name);
    return req<ImportReport>('POST', '/import', fd);
  },
  exportUrl: () => `${BASE}/export`,

  settings: () => req<Record<string, unknown>>('GET', '/settings'),
  saveSettings: (s: Record<string, unknown>) => req<Record<string, unknown>>('PUT', '/settings', s),
  aiUsage: () => fetch('/api/ai/v1/usage', { credentials: 'same-origin' }).then((r) => (r.ok ? (r.json() as Promise<AiUsage>) : null)),

  adminUsers: () => req<AdminUserRow[]>('GET', '/admin/users'),
  adminCreateUser: (b: { email: string; name: string; password: string; admin: boolean }) => req<User>('POST', '/admin/users', b),
  adminUpdateUser: (id: string, b: { name?: string; role?: string; disabled?: boolean; password?: string }) =>
    req<AdminUserRow>('PATCH', `/admin/users/${id}`, b),
};
