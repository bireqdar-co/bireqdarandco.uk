CREATE TABLE IF NOT EXISTS app_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  version integer NOT NULL,
  setup_key text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS store_settings (
  id smallint PRIMARY KEY CHECK (id = 1),
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_credentials (
  id smallint PRIMARY KEY CHECK (id = 1),
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  type text NOT NULL CHECK (type IN ('jewellery','watch','bullion','bespoke')),
  category text NOT NULL DEFAULT '',
  collection_id text REFERENCES collections(id) ON DELETE RESTRICT,
  price_cents bigint,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  published boolean NOT NULL DEFAULT false,
  is_demo boolean NOT NULL DEFAULT true,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS products_storefront_idx ON products (published, type, collection_id);

CREATE TABLE IF NOT EXISTS customers (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id text PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  status text NOT NULL,
  payment_mode text NOT NULL,
  checkout_request_id text,
  customer_id text REFERENCES customers(id) ON DELETE SET NULL,
  stripe_session_id text UNIQUE,
  created_at timestamptz NOT NULL,
  paid_at timestamptz,
  currency text NOT NULL,
  subtotal_cents bigint NOT NULL,
  tax_cents bigint NOT NULL DEFAULT 0,
  shipping_cents bigint NOT NULL DEFAULT 0,
  total_cents bigint NOT NULL,
  customer_details jsonb NOT NULL,
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_payment_pending_idx ON orders (status, payment_mode, created_at);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_request_id text;
UPDATE orders SET checkout_request_id = NULL WHERE checkout_request_id = '';
CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_request_id_idx ON orders (checkout_request_id) WHERE checkout_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_items (
  order_id text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  line_number integer NOT NULL,
  product_id text,
  name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  unit_price_cents bigint NOT NULL,
  currency text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (order_id, line_number)
);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items (product_id);

CREATE TABLE IF NOT EXISTS reservations (
  id text PRIMARY KEY,
  reference text NOT NULL UNIQUE,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS owner_sessions (
  token_hash text PRIMARY KEY,
  expires_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
