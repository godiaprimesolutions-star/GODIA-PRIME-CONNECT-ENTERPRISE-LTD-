PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gpc_users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT NOT NULL UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    pin_salt TEXT NOT NULL,
    pin_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'customer'
        CHECK (role IN (
            'customer',
            'shop',
            'business',
            'supplier',
            'wholesaler',
            'distributor',
            'manufacturer',
            'agent',
            'employer',
            'job_seeker',
            'admin',
            'owner'
        )),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'disabled')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_users_role
ON gpc_users(role);

CREATE INDEX IF NOT EXISTS idx_gpc_users_status
ON gpc_users(status);

CREATE TABLE IF NOT EXISTS gpc_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES gpc_users(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gpc_sessions_user
ON gpc_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_gpc_sessions_expiry
ON gpc_sessions(expires_at);

CREATE TABLE IF NOT EXISTS gpc_login_attempts (
    attempt_key TEXT PRIMARY KEY,
    failures INTEGER NOT NULL DEFAULT 0,
    window_started_at TEXT NOT NULL,
    blocked_until TEXT
);

CREATE TABLE IF NOT EXISTS gpc_audit_log (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    metadata_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (actor_user_id) REFERENCES gpc_users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_gpc_audit_created
ON gpc_audit_log(created_at);

CREATE INDEX IF NOT EXISTS idx_gpc_audit_actor
ON gpc_audit_log(actor_user_id);
