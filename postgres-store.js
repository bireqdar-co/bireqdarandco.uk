'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { Pool } = require('pg');

const json = value => value == null ? null : (typeof value === 'string' ? JSON.parse(value) : value);
const dateValue = value => value ? new Date(value) : null;

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
  }

  async initialize() {
    const sql = await fs.readFile(this.schema, 'utf8');
    await this.pool.query(sql);
    await this.pool.query('SELECT 1');
  }

  async load() {
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

    return {
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
  }

  async save(db) {
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
