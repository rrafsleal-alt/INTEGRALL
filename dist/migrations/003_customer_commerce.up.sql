CREATE INDEX IF NOT EXISTS integrall_orders_customer_email_idx
  ON integrall_orders (LOWER(COALESCE(data #>> '{customer,email}','')));

CREATE TABLE IF NOT EXISTS integrall_customer_accounts (
  email TEXT PRIMARY KEY,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS integrall_customer_login_codes (
  email TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  attempts SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integrall_customer_login_codes_expiry_idx ON integrall_customer_login_codes (expires_at);

CREATE TABLE IF NOT EXISTS integrall_customer_sessions (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL REFERENCES integrall_customer_accounts(email) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integrall_customer_sessions_email_idx ON integrall_customer_sessions (email);
CREATE INDEX IF NOT EXISTS integrall_customer_sessions_expiry_idx ON integrall_customer_sessions (expires_at);

CREATE TABLE IF NOT EXISTS integrall_reviews (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  email TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
  verified_order_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, email)
);
CREATE INDEX IF NOT EXISTS integrall_reviews_product_status_idx ON integrall_reviews (product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS integrall_reviews_status_idx ON integrall_reviews (status, created_at DESC);

CREATE TABLE IF NOT EXISTS integrall_restock_subscriptions (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','notified','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS integrall_restock_active_idx ON integrall_restock_subscriptions (status, product_id, variant_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS integrall_restock_unique_active_idx
  ON integrall_restock_subscriptions (product_id, variant_id, LOWER(email)) WHERE status = 'active';
