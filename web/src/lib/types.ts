// Shapes of the tnc-server API (server/crates/tnc-server/src/routes). Keep in step with the Rust structs.

export type Machine = '426' | '430' | (string & {});

export interface Info {
  name: string;
  version: string;
  api: number;
  interpreter: string | null;
  machines: Machine[];
  needs_setup: boolean;
  signup: boolean;
  ai: {
    enabled: boolean;
    provider: string;
    default_model: string;
    models: string[];
    max_tokens: number;
    monthly_budget_usd: number;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  created_at: string;
}

export interface ProgramSummary {
  id: string;
  name: string;
  machine: Machine;
  project_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  size: number;
  ok: boolean | null;
  error_count: number | null;
  cycle_time: number | null;
  deleted_at: string | null;
}

export interface Diagnostic {
  line: number;
  block: number | null;
  msg: string;
  raw: string;
}

export interface Event {
  sev: string;
  line: number;
  block: number | null;
  msg: string;
}

export interface Report {
  ok: boolean;
  errors: Diagnostic[];
  events: Event[];
  blocks: number;
  stats: {
    move_count: number;
    path_feed: number;
    path_rapid: number;
    cycle_time: number;
    min_z: number;
    max_z: number;
    removed_volume: number;
    tools_used: { t: number; name: string | null; r: number; moves: number; time: number }[];
  };
  stock: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } | null;
  listing?: string;
  interpreter: string;
}

export interface ProgramDetail extends ProgramSummary {
  content: string;
  report: Report | null;
  message: string | null;
  source: string;
}

export interface VersionRow {
  version: number;
  created_at: string;
  size: number;
  sha256: string;
  message: string | null;
  source: string;
  author: string | null;
  ok: boolean | null;
  error_count: number | null;
  cycle_time: number | null;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  program_count: number;
}

export interface Share {
  token: string;
  version: number | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  url: string;
}

export interface PublicShare {
  name: string;
  machine: Machine;
  version: number;
  latest_version: number;
  content: string;
  report: Report | null;
  owner_name: string;
  updated_at: string;
}

export interface Tool {
  t: number;
  name: string;
  l: number;
  r: number;
}

export interface ToolTable {
  machine: Machine;
  tools: Tool[];
  holder: string;
  updated_at: string | null;
  builtin: Tool[];
}

export interface ImportReport {
  created: { id: string; name: string; machine: Machine; version: number; ok: boolean | null }[];
  updated: { id: string; name: string; machine: Machine; version: number; ok: boolean | null }[];
  unchanged: { id: string; name: string; machine: Machine; version: number; ok: boolean | null }[];
  tools_added: number;
  tool_tables: string[];
  projects: number;
  skipped: { name: string; reason: string }[];
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  disabled: boolean;
  created_at: string;
  programs: number;
  last_seen: string | null;
}

export interface AiUsage {
  month_start: string;
  cost_usd: number;
  calls: number;
  budget_usd: number;
  enabled: boolean;
}
