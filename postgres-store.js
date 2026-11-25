'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

// Convert PostgreSQL JSONB values and timestamps back into the store's runtime format.
const json = value => value == null ? null : (typeof value === 'string' ? JSON.parse(value) : value);
const dateValue = value => value ? new Date(value) : null;

// A comparable picture of the store: one JSON string per row, keyed like the tables.
function fingerprint(db) {
  const byId = (list, key = 'id') => new Map((list || []).map(item => [String(item[key]), JSON.stringify(item)]));
  return {
    state: JSON.stringify([Number(db.version) || 1, db.setupKey || null]),
    settings: JSON.stringify(db.settings || {}),
    admin: db.admin ? JSON.stringify(db.admin) : null,
    collections: byId(db.collections),
    products: byId(db.products),
    customers: byId(db.customers),
    orders: byId(db.orders),
    reservations: byId(db.reservations),
    sessions: new Map(Object.entries(db.sessions || {}).map(([k, v]) => [k, String(Number(v))])),
    customerSessions: new Map(Object.entries(db.customerSessions || {}).map(([k, v]) => [k, JSON.stringify([v.customerId, Number(v.expiresAt)])]))
  };
}
async function deleteMissing(client, table, column, prev, next) {
  const gone = [...prev.keys()].filter(key => !next.has(key));
  if (gone.length) await client.query(`DELETE FROM ${table} WHERE ${column} = ANY($1::text[])`, [gone]);
}
async function upsertOrder(client, order, data) {
  await client.query(
    `INSERT INTO orders (id, reference, status, payment_mode, checkout_request_id, customer_id, stripe_session_id, created_at, paid_at, currency,
       subtotal_cents, tax_cents, shipping_cents, total_cents, customer_details, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb)
     ON CONFLICT (id) DO UPDATE SET reference = EXCLUDED.reference, status = EXCLUDED.status, payment_mode = EXCLUDED.payment_mode,
       checkout_request_id = EXCLUDED.checkout_request_id, customer_id = EXCLUDED.customer_id, stripe_session_id = EXCLUDED.stripe_session_id,
       created_at = EXCLUDED.created_at, paid_at = EXCLUDED.paid_at, currency = EXCLUDED.currency, subtotal_cents = EXCLUDED.subtotal_cents,
       tax_cents = EXCLUDED.tax_cents, shipping_cents = EXCLUDED.shipping_cents, total_cents = EXCLUDED.total_cents,
       customer_details = EXCLUDED.customer_details, data = EXCLUDED.data`,
    [order.id, order.reference, order.status, order.paymentMode || 'preview', order.checkoutRequestId || null,
      order.customerId || null, order.stripeSessionId || null, dateValue(order.createdAt) || new Date(), dateValue(order.paidAt),
      order.currency || 'GBP', Number(order.subtotalCents) || 0, Number(order.taxCents) || 0,
      Number(order.shippingCents) || 0, Number(order.totalCents) || 0, JSON.stringify(order.customer || {}), data]
  );
  await client.query('DELETE FROM order_items WHERE order_id = $1', [order.id]);
  for (const [lineNumber, item] of (order.items || []).entries()) {
    await client.query(
      `INSERT INTO order_items (order_id, line_number, product_id, name, quantity, unit_price_cents, currency, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [order.id, lineNumber + 1, item.id || null, item.name, Number(item.quantity) || 1,
        Number(item.priceCents) || 0, item.currency || order.currency || 'GBP', JSON.stringify(item)]
    );
  }
}

class PostgresStore {
  constructor(connectionString) {
    if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL.');
    this.pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 8000
    });
    this.pool.on('error', error => console.error(JSON.stringify({event:'database_pool_error',code:error.code||'database_error'})));
    this.schema = path.join(__dirname, 'db', 'schema.sql');
    this.saved = null; // what the database holds after the last successful load or save
  }

  async initialize() {
    const sql = await fs.readFile(this.schema, 'utf8');
    await this.pool.query(sql);
    await this.pool.query('SELECT 1');
  }

  async load() {
    // Load normalized tables and rebuild the shared store object expected by the API.
    const state = await this.pool.query('SELECT version, setup_key FROM app_state WHERE id = 1');
    if (!state.rowCount) return null;
    const [settings, owner, collections, products, customers, orders, items, reservations, sessions, customerSessions] = await Promise.all([
      this.pool.query('SELECT data FROM store_settings WHERE id = 1'),
      this.pool.query('SELECT data FROM owner_credentials WHERE id = 1'),
      this.pool.query('SELECT data FROM collections ORDER BY name'),
      this.pool.query('SELECT data FROM products ORDER BY id'),
      this.pool.query('SELECT data FROM customers ORDER BY created_at'),
      this.pool.query('SELECT id, data FROM orders ORDER BY created_at DESC'),
      this.pool.query('SELECT order_id, line_number, data FROM order_items ORDER BY order_id, line_number'),
      this.pool.query('SELECT data FROM reservations ORDER BY created_at DESC'),
      this.pool.query('SELECT token_hash, expires_at FROM owner_sessions'),
      this.pool.query('SELECT token_hash, customer_id, expires_at FROM customer_sessions')
    ]);

    const orderItems = new Map();
    for (const row of items.rows) {
      if (!orderItems.has(row.order_id)) orderItems.set(row.order_id, []);
      orderItems.get(row.order_id).push(json(row.data));
    }
    const ordersData = orders.rows.map(row => {
      const order = json(row.data);
      order.items = orderItems.get(row.id) || [];
      return order;
    });
    const ownerSessions = Object.fromEntries(sessions.rows.map(row => [row.token_hash, Number(row.expires_at)]));
    const clientSessions = Object.fromEntries(customerSessions.rows.map(row => [row.token_hash, {
      customerId: row.customer_id,
      expiresAt: Number(row.expires_at)
    }]));
    const ownerData = owner.rowCount ? json(owner.rows[0].data) : null;

    const loaded = {
      version: Number(state.rows[0].version) || 1,
      setupKey: state.rows[0].setup_key,
      admin: ownerData,
      settings: settings.rowCount ? json(settings.rows[0].data) : {},
      collections: collections.rows.map(row => json(row.data)),
      products: products.rows.map(row => json(row.data)),
      customers: customers.rows.map(row => json(row.data)),
      orders: ordersData,
      reservations: reservations.rows.map(row => json(row.data)),
      sessions: ownerSessions,
      customerSessions: clientSessions,
      processedStripeEvents: []
    };
    // Remember exactly what is in the database so later saves only write what changed.
    this.saved = fingerprint(loaded);
    return loaded;
  }

  // Saves the store. After the first load (or first full save) only rows that changed since
  // the last successful save are written, all inside one transaction, so a save costs the
  // same whether the shop has ten orders or ten thousand.
  async save(db) {
    const next = fingerprint(db);
    if (!this.saved) {
      await this.fullSave(db);
      this.saved = next;
      return;
    }
    const prev = this.saved;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (prev.state !== next.state) {
        await client.query(
          `INSERT INTO app_state (id, version, setup_key, updated_at) VALUES (1, $1, $2, now())
           ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, setup_key = EXCLUDED.setup_key, updated_at = now()`,
          [Number(db.version) || 1, db.setupKey || null]
        );
      }
      if (prev.settings !== next.settings) {
        await client.query('INSERT INTO store_settings (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [next.settings]);
      }
      if (prev.admin !== next.admin) {
        if (next.admin) await client.query('INSERT INTO owner_credentials (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [next.admin]);
        else await client.query('DELETE FROM owner_credentials WHERE id = 1');
      }

      // Removals first (children before parents), so freed unique values can be reused.
      await deleteMissing(client, 'customer_sessions', 'token_hash', prev.customerSessions, next.customerSessions);
      await deleteMissing(client, 'owner_sessions', 'token_hash', prev.sessions, next.sessions);
      await deleteMissing(client, 'orders', 'id', prev.orders, next.orders); // order_items cascade
      await deleteMissing(client, 'reservations', 'id', prev.reservations, next.reservations);
      await deleteMissing(client, 'products', 'id', prev.products, next.products);

      // Inserts and updates (parents before children).
      for (const collection of db.collections || []) {
        if (prev.collections.get(collection.id) === next.collections.get(collection.id)) continue;
        await client.query(
          `INSERT INTO collections (id, slug, name, active, data) VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name, active = EXCLUDED.active, data = EXCLUDED.data`,
          [collection.id, collection.slug, collection.name, collection.active !== false, next.collections.get(collection.id)]
        );
      }
      for (const customer of db.customers || []) {
        if (prev.customers.get(customer.id) === next.customers.get(customer.id)) continue;
        await client.query(
          `INSERT INTO customers (id, email, created_at, data) VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, created_at = EXCLUDED.created_at, data = EXCLUDED.data`,
          [customer.id, String(customer.email).toLowerCase(), dateValue(customer.createdAt) || new Date(), next.customers.get(customer.id)]
        );
      }
      for (const product of db.products || []) {
        if (prev.products.get(product.id) === next.products.get(product.id)) continue;
        await client.query(
          `INSERT INTO products (id, slug, type, category, collection_id, price_cents, stock, published, is_demo, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
           ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, type = EXCLUDED.type, category = EXCLUDED.category,
             collection_id = EXCLUDED.collection_id, price_cents = EXCLUDED.price_cents, stock = EXCLUDED.stock,
             published = EXCLUDED.published, is_demo = EXCLUDED.is_demo, data = EXCLUDED.data`,
          [product.id, product.slug, product.type, product.category || '', product.collectionId || null,
            product.priceCents, Number(product.stock) || 0, !!product.published, product.isDemo !== false, next.products.get(product.id)]
        );
      }
      for (const order of db.orders || []) {
        if (prev.orders.get(order.id) === next.orders.get(order.id)) continue;
        await upsertOrder(client, order, next.orders.get(order.id));
      }
      for (const reservation of db.reservations || []) {
        if (prev.reservations.get(reservation.id) === next.reservations.get(reservation.id)) continue;
        await client.query(
          `INSERT INTO reservations (id, reference, status, created_at, data) VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (id) DO UPDATE SET reference = EXCLUDED.reference, status = EXCLUDED.status, created_at = EXCLUDED.created_at, data = EXCLUDED.data`,
          [reservation.id, reservation.reference, reservation.status || 'new', dateValue(reservation.createdAt) || new Date(), next.reservations.get(reservation.id)]
        );
      }
      for (const [tokenHash, value] of next.sessions) {
        if (prev.sessions.get(tokenHash) === value) continue;
        await client.query('INSERT INTO owner_sessions (token_hash, expires_at) VALUES ($1, $2) ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at', [tokenHash, Number(value)]);
      }
      for (const [tokenHash, session] of Object.entries(db.customerSessions || {})) {
        if (prev.customerSessions.get(tokenHash) === next.customerSessions.get(tokenHash)) continue;
        await client.query(
          `INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES ($1, $2, $3)
           ON CONFLICT (token_hash) DO UPDATE SET customer_id = EXCLUDED.customer_id, expires_at = EXCLUDED.expires_at`,
          [tokenHash, session.customerId, Number(session.expiresAt)]
        );
      }

      // Parents that are no longer referenced.
      await deleteMissing(client, 'customers', 'id', prev.customers, next.customers);
      await deleteMissing(client, 'collections', 'id', prev.collections, next.collections);
      await client.query('COMMIT');
      this.saved = next;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  // Rewrites every table from the snapshot. Used for the very first save of a new database.
  async fullSave(db) {
    // Persist one complete snapshot in a transaction so readers see consistent state.
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO app_state (id, version, setup_key, updated_at)
         VALUES (1, $1, $2, now())
         ON CONFLICT (id) DO UPDATE SET version = EXCLUDED.version, setup_key = EXCLUDED.setup_key, updated_at = now()`,
        [Number(db.version) || 1, db.setupKey || null]
      );
      await client.query(
        `INSERT INTO store_settings (id, data) VALUES (1, $1::jsonb)
         ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
        [JSON.stringify(db.settings || {})]
      );
      if (db.admin) {
        await client.query(
          `INSERT INTO owner_credentials (id, data) VALUES (1, $1::jsonb)
           ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
          [JSON.stringify(db.admin)]
        );
      } else {
        await client.query('DELETE FROM owner_credentials WHERE id = 1');
      }

      // The current V1 admin edits one store through one Node process. Write the
      // catalogue and order snapshot atomically so restarts never expose a half-save.
      await client.query('DELETE FROM order_items');
      await client.query('DELETE FROM orders');
      await client.query('DELETE FROM reservations');
      await client.query('DELETE FROM products');
      await client.query('DELETE FROM collections');
      await client.query('DELETE FROM customer_sessions');
      await client.query('DELETE FROM owner_sessions');
      await client.query('DELETE FROM customers');

      for (const collection of db.collections || []) {
        await client.query(
          'INSERT INTO collections (id, slug, name, active, data) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [collection.id, collection.slug, collection.name, collection.active !== false, JSON.stringify(collection)]
        );
      }
      for (const product of db.products || []) {
        await client.query(
          `INSERT INTO products (id, slug, type, category, collection_id, price_cents, stock, published, is_demo, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)`,
          [product.id, product.slug, product.type, product.category || '', product.collectionId || null,
            product.priceCents, Number(product.stock) || 0, !!product.published, product.isDemo !== false, JSON.stringify(product)]
        );
      }
      for (const customer of db.customers || []) {
        await client.query(
          'INSERT INTO customers (id, email, created_at, data) VALUES ($1, $2, $3, $4::jsonb)',
          [customer.id, String(customer.email).toLowerCase(), dateValue(customer.createdAt) || new Date(), JSON.stringify(customer)]
        );
      }
      for (const order of db.orders || []) {
        await client.query(
          `INSERT INTO orders (id, reference, status, payment_mode, checkout_request_id, customer_id, stripe_session_id, created_at, paid_at, currency,
             subtotal_cents, tax_cents, shipping_cents, total_cents, customer_details, data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb)`,
          [order.id, order.reference, order.status, order.paymentMode || 'preview', order.checkoutRequestId || null,
            order.customerId || null, order.stripeSessionId || null, dateValue(order.createdAt) || new Date(), dateValue(order.paidAt),
            order.currency || 'GBP', Number(order.subtotalCents) || 0, Number(order.taxCents) || 0,
            Number(order.shippingCents) || 0, Number(order.totalCents) || 0,
            JSON.stringify(order.customer || {}), JSON.stringify(order)]
        );
        for (const [lineNumber, item] of (order.items || []).entries()) {
          await client.query(
            `INSERT INTO order_items (order_id, line_number, product_id, name, quantity, unit_price_cents, currency, data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
            [order.id, lineNumber + 1, item.id || null, item.name, Number(item.quantity) || 1,
              Number(item.priceCents) || 0, item.currency || order.currency || 'GBP', JSON.stringify(item)]
          );
        }
      }
      for (const reservation of db.reservations || []) {
        await client.query(
          'INSERT INTO reservations (id, reference, status, created_at, data) VALUES ($1, $2, $3, $4, $5::jsonb)',
          [reservation.id, reservation.reference, reservation.status || 'new', dateValue(reservation.createdAt) || new Date(), JSON.stringify(reservation)]
        );
      }
      for (const [tokenHash, expiresAt] of Object.entries(db.sessions || {})) {
        await client.query('INSERT INTO owner_sessions (token_hash, expires_at) VALUES ($1, $2)', [tokenHash, Number(expiresAt)]);
      }
      for (const [tokenHash, session] of Object.entries(db.customerSessions || {})) {
        await client.query(
          'INSERT INTO customer_sessions (token_hash, customer_id, expires_at) VALUES ($1, $2, $3)',
          [tokenHash, session.customerId, Number(session.expiresAt)]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async hasWebhookEvent(eventId) {
    const result = await this.pool.query('SELECT 1 FROM stripe_webhook_events WHERE event_id = $1', [eventId]);
    return result.rowCount > 0;
  }

  async rememberWebhookEvent(eventId) {
    await this.pool.query('INSERT INTO stripe_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING', [eventId]);
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = { PostgresStore };
