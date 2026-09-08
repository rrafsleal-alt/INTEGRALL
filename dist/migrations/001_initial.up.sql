CREATE TABLE IF NOT EXISTS integrall_catalog (
  id SMALLINT PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT integrall_catalog_singleton CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS integrall_orders (
  id TEXT PRIMARY KEY,
  client_order_id TEXT UNIQUE NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integrall_orders_created_idx ON integrall_orders (created_at DESC);
CREATE INDEX IF NOT EXISTS integrall_orders_status_idx ON integrall_orders ((data->>'status'));

CREATE TABLE IF NOT EXISTS integrall_customers (
  contact_key TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS integrall_customers_updated_idx ON integrall_customers (updated_at DESC);

CREATE TABLE IF NOT EXISTS integrall_media (
  id TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
