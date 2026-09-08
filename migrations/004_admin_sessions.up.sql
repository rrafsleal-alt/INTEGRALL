CREATE TABLE IF NOT EXISTS integrall_admin_sessions (
  jti TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS integrall_admin_sessions_expiry_idx
  ON integrall_admin_sessions (expires_at);
