-- GODIA PRIME CONNECT ENTERPRISE LTD
-- Migration 0005: GODIA SMART POS subscriptions
-- Additive migration: preserves existing tables and records.
-- Supports daily, monthly, annual plans and free-trial access.

PRAGMA foreign_keys = ON;

-- 1. SMART POS payment records.
CREATE TABLE IF NOT EXISTS gpc_smart_pos_payments (
    id TEXT PRIMARY KEY,

    user_id TEXT NOT NULL,

    plan_code TEXT NOT NULL
        CHECK (
            plan_code IN (
                'smart_pos_daily',
                'smart_pos_monthly',
                'smart_pos_annual'
            )
        ),

    amount INTEGER NOT NULL
        CHECK (amount > 0),

    currency TEXT NOT NULL DEFAULT 'KES'
        CHECK (currency = 'KES'),

    payment_method TEXT NOT NULL DEFAULT 'mpesa'
        CHECK (payment_method = 'mpesa'),

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'processing',
                'confirmed',
                'failed',
                'cancelled'
            )
        ),

    phone TEXT NOT NULL,

    merchant_request_id TEXT,

    checkout_request_id TEXT UNIQUE,

    mpesa_receipt_number TEXT UNIQUE,

    result_code TEXT,

    result_description TEXT,

    created_at TEXT NOT NULL,

    updated_at TEXT NOT NULL,

    confirmed_at TEXT,

    FOREIGN KEY (user_id)
        REFERENCES gpc_users(id)
);

CREATE INDEX IF NOT EXISTS
    idx_gpc_smart_pos_payments_user
ON gpc_smart_pos_payments(user_id, created_at);

CREATE INDEX IF NOT EXISTS
    idx_gpc_smart_pos_payments_status
ON gpc_smart_pos_payments(status, created_at);


-- 2. SMART POS subscription and trial access.
CREATE TABLE IF NOT EXISTS gpc_smart_pos_subscriptions (
    id TEXT PRIMARY KEY,

    user_id TEXT NOT NULL,

    plan_code TEXT NOT NULL
        CHECK (
            plan_code IN (
                'smart_pos_trial',
                'smart_pos_daily',
                'smart_pos_monthly',
                'smart_pos_annual'
            )
        ),

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (
            status IN (
                'active',
                'expired',
                'cancelled'
            )
        ),

    access_source TEXT NOT NULL
        CHECK (
            access_source IN (
                'free_trial',
                'mpesa'
            )
        ),

    starts_at TEXT NOT NULL,

    expires_at TEXT NOT NULL,

    payment_id TEXT UNIQUE,

    created_at TEXT NOT NULL,

    updated_at TEXT NOT NULL,

    FOREIGN KEY (user_id)
        REFERENCES gpc_users(id),

    FOREIGN KEY (payment_id)
        REFERENCES gpc_smart_pos_payments(id),

    CHECK (
        (access_source = 'free_trial'
            AND plan_code = 'smart_pos_trial'
            AND payment_id IS NULL)
        OR
        (access_source = 'mpesa'
            AND plan_code IN (
                'smart_pos_daily',
                'smart_pos_monthly',
                'smart_pos_annual'
            )
            AND payment_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS
    idx_gpc_smart_pos_subscriptions_user
ON gpc_smart_pos_subscriptions(
    user_id,
    status,
    expires_at
);

CREATE INDEX IF NOT EXISTS
    idx_gpc_smart_pos_subscriptions_expiry
ON gpc_smart_pos_subscriptions(status, expires_at);
