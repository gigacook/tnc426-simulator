-- TNC server schema v1. Times are RFC 3339 UTC text; ids are UUID v7 text (time-ordered).

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);

-- only a SHA-256 of the token is stored; the token itself lives in the cookie / client
CREATE TABLE sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX projects_owner ON projects(owner_id);

-- a program is a name on a machine; its text lives in program_versions
CREATE TABLE programs (
  id               TEXT PRIMARY KEY,
  owner_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id       TEXT REFERENCES projects(id) ON DELETE SET NULL,
  machine          TEXT NOT NULL,
  name             TEXT NOT NULL,
  current_version  INTEGER NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  deleted_at       TEXT
);
CREATE UNIQUE INDEX programs_live_name ON programs(owner_id, machine, name) WHERE deleted_at IS NULL;
CREATE INDEX programs_owner ON programs(owner_id, updated_at);

-- every save is a version; report = the interpreter's check of that text (tnc-engine Report, JSON)
CREATE TABLE program_versions (
  program_id  TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  content     TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  size        INTEGER NOT NULL,
  message     TEXT,
  source      TEXT NOT NULL DEFAULT 'edit',   -- edit | import | ai | restore | simulator
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  ok          INTEGER,                        -- NULL: not checked (engine unavailable)
  error_count INTEGER,
  cycle_time  REAL,
  report      TEXT,
  interpreter TEXT,
  PRIMARY KEY (program_id, version)
);

CREATE TABLE tool_tables (
  owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  machine     TEXT NOT NULL,
  tools       TEXT NOT NULL,                  -- JSON [{t,name,l,r}]
  holder      TEXT NOT NULL DEFAULT 'ISO50',
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (owner_id, machine)
);

CREATE TABLE shares (
  token       TEXT PRIMARY KEY,
  program_id  TEXT NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  version     INTEGER,                        -- NULL: always the latest
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT,
  revoked_at  TEXT
);
CREATE INDEX shares_program ON shares(program_id);

CREATE TABLE settings (
  owner_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE TABLE ai_usage (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  model             TEXT NOT NULL,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  cost              REAL NOT NULL DEFAULT 0,
  status            INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);
CREATE INDEX ai_usage_user ON ai_usage(user_id, created_at);
