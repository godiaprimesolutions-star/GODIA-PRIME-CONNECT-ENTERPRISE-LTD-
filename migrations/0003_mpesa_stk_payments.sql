-- Additive migration: does not drop or reset existing GODIA tables or records.
CREATE TABLE IF NOT EXISTS gpc_mpesa_payments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES gpc_users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  phone_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
  merchant_request_id TEXT,
  checkout_request_id TEXT NOT NULL UNIQUE,
  result_code INTEGER,
  result_description TEXT,
  mpesa_receipt_number TEXT,
  transaction_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gpc_mpesa_payments_user_created ON gpc_mpesa_payments(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gpc_mpesa_payments_status ON gpc_mpesa_payments(status, updated_at);
