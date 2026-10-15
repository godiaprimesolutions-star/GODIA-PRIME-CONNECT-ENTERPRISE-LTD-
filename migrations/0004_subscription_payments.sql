-- GODIA PRIME CONNECT
-- Migration 0004: Subscription payments
-- Additive only: preserves existing tables and records.
-- Apply to the confirmed existing D1 database.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS gpc_subscription_payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan_code TEXT NOT NULL
        CHECK (plan_code IN (
            'manufacturer_monthly',
            'supplier_monthly',
            'distributor_monthly',
            'duka_monthly',
            'employer_job_post'
        )),
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'KES'
        CHECK (currency = 'KES'),
    payment_method TEXT NOT NULL DEFAULT 'mpesa'
        CHECK (payment_method = 'mpesa'),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending',
            'processing',
            'confirmed',
            'failed',
            'cancelled'
        )),
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
    idx_gpc_subscription_payments_user
ON gpc_subscription_payments(user_id, created_at);

CREATE INDEX IF NOT EXISTS
    idx_gpc_subscription_payments_status
ON gpc_subscription_payments(status, created_at);

CREATE TABLE IF NOT EXISTS gpc_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan_code TEXT NOT NULL
        CHECK (plan_code IN (
            'manufacturer_monthly',
            'supplier_monthly',
            'distributor_monthly',
            'duka_monthly',
            'employer_job_post'
        )),
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN (
            'active',
            'expired',
            'cancelled'
        )),
    starts_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    payment_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id)
        REFERENCES gpc_users(id),
    FOREIGN KEY (payment_id)
        REFERENCES gpc_subscription_payments(id)
);

CREATE INDEX IF NOT EXISTS
    idx_gpc_subscriptions_user_status
ON gpc_subscriptions(user_id, status, expires_at);

CREATE TABLE IF NOT EXISTS gpc_mpesa_callback_events (
    id TEXT PRIMARY KEY,
    checkout_request_id TEXT NOT NULL UNIQUE,
    result_code TEXT NOT NULL,
    processed_at TEXT NOT NULL
);
