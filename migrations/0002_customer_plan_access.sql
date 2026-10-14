-- Temporary owner-controlled customer POS/free-plan overrides. Additive migration only.
-- Apply to the confirmed GODIA D1 database after reviewing its identity.
CREATE TABLE IF NOT EXISTS gpc_customer_plan_access (
  user_id TEXT PRIMARY KEY REFERENCES gpc_users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('grant_free','lock')),
  expires_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  set_by_user_id TEXT NOT NULL REFERENCES gpc_users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gpc_customer_plan_access_expiry_idx ON gpc_customer_plan_access(expires_at);
