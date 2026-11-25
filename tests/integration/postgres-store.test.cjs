'use strict';
// PostgreSQL storage integration tests: schema constraints, round-trips and rollback.
// Uses a throwaway database created from TEST_DATABASE_URL; skipped without it.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const skip = !process.env.TEST_DATABASE_URL && 'needs TEST_DATABASE_URL';

describe('PostgreSQL store', { skip }, () => {
  let store, Client, dbName, admin, dbUrl;
  before(async () => {
    ({ Client } = require(path.join(ROOT, 'node_modules', 'pg')));
    admin = process.env.TEST_DATABASE_URL;
    dbName = `bq_store_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const c = new Client({ connectionString: admin }); await c.connect(); await c.query(`CREATE DATABASE ${dbName}`); await c.end();
    const u = new URL(admin); u.pathname = `/${dbName}`; dbUrl = u.toString();
    const { PostgresStore } = require(path.join(ROOT, 'postgres-store.js'));
    store = new PostgresStore(dbUrl);
    await store.initialize();
  });
  after(async () => {
    await store?.close().catch(() => {});
    const c = new Client({ connectionString: admin }); await c.connect(); await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`); await c.end();
  });

  const snapshot = (over = {}) => ({
    version: 15, setupKey: null, admin: null, settings: { currency: 'GBP', shippingCents: 0 },
    collections: [{ id: 'col-gold', slug: 'gold', name: 'Gold', active: true }],
    products: [{ id: 'p1', slug: 'p-one', type: 'jewellery', category: 'rings', collectionId: 'col-gold', priceCents: 250000, stock: 1, published: true, isDemo: false, name: 'Ring' }],
    customers: [{ id: 'c1', email: 'client@example.com', createdAt: new Date().toISOString(), name: 'Client' }],
    orders: [{ id: 'o1', reference: 'BC-AAAAAAAAAA', status: 'paid', paymentMode: 'stripe', customerId: 'c1', createdAt: new Date().toISOString(), currency: 'GBP', subtotalCents: 250000, totalCents: 250000, customer: { email: 'client@example.com' }, items: [{ id: 'p1', name: 'Ring', quantity: 1, priceCents: 250000, currency: 'GBP' }] }],
    reservations: [], sessions: {}, customerSessions: { ['a'.repeat(64)]: { customerId: 'c1', expiresAt: Date.now() + 1000 } }, ...over
  });

  it('DB-001 schema initialisation is idempotent', async () => {
    await store.initialize();
    await store.initialize();
  });

  it('DB-002 a saved snapshot loads back identically (money stays in exact pence)', async () => {
    await store.save(snapshot());
    const loaded = await store.load();
    assert.equal(loaded.products[0].priceCents, 250000);
    assert.equal(loaded.orders[0].items[0].priceCents, 250000);
    assert.equal(loaded.orders[0].reference, 'BC-AAAAAAAAAA');
    assert.equal(loaded.customerSessions['a'.repeat(64)].customerId, 'c1');
  });

  it('DB-003 a save that breaks a constraint is rolled back completely', async () => {
    await store.save(snapshot());
    const broken = snapshot({ products: [{ ...snapshot().products[0], stock: -1, name: 'Changed name' }] });
    await assert.rejects(store.save(broken), /stock_check|violates check constraint/);
    const loaded = await store.load();
    assert.equal(loaded.products[0].stock, 1, 'previous data is intact');
    assert.equal(loaded.products[0].name, 'Ring');
  });

  it('DB-004 duplicate references, emails and slugs are refused by the database', async () => {
    const base = snapshot();
    await assert.rejects(store.save({ ...base, orders: [base.orders[0], { ...base.orders[0], id: 'o2' }] }), /duplicate key/);
    await assert.rejects(store.save({ ...base, customers: [base.customers[0], { ...base.customers[0], id: 'c2' }] }), /duplicate key/);
    await assert.rejects(store.save({ ...base, products: [base.products[0], { ...base.products[0], id: 'p2' }] }), /duplicate key/);
    assert.equal((await store.load()).orders.length, 1);
  });

  it('DB-005 a session for a customer that does not exist is refused (referential integrity)', async () => {
    await assert.rejects(store.save(snapshot({ customerSessions: { ['b'.repeat(64)]: { customerId: 'ghost', expiresAt: Date.now() } } })), /foreign key/);
  });

  it('DB-006 webhook event IDs are remembered once', async () => {
    assert.equal(await store.hasWebhookEvent('evt_1'), false);
    await store.rememberWebhookEvent('evt_1');
    await store.rememberWebhookEvent('evt_1');
    assert.equal(await store.hasWebhookEvent('evt_1'), true);
  });

  // Counts the SQL statements one save sends.
  async function countStatements(target, fn) {
    let count = 0;
    const connect = target.pool.connect.bind(target.pool);
    target.pool.connect = async () => { const c = await connect(); const q = c.query.bind(c); c.query = (...a) => { count++; return q(...a); }; return c; };
    try { await fn(); } finally { target.pool.connect = connect; }
    return count;
  }
  const bigSnapshot = n => {
    const base = snapshot();
    const orders = Array.from({ length: n }, (_, i) => ({ ...base.orders[0], id: `o${i}`, reference: `BC-${String(i).padStart(10, '0')}`, stripeSessionId: null }));
    return { ...base, orders };
  };

  it('DB-008 after the first save, a change writes only the rows that changed', async () => {
    const snap = bigSnapshot(1000);
    await store.save(snap);
    snap.orders[500].status = 'shipped';
    const statements = await countStatements(store, () => store.save(snap));
    assert.ok(statements <= 6, `one changed order took ${statements} statements`);
    const started = Date.now();
    snap.products[0].stock = 0;
    await store.save(snap);
    assert.ok(Date.now() - started < 200, 'a single change saves quickly with 1,000 orders');
    const loaded = await store.load();
    assert.equal(loaded.orders.find(o => o.id === 'o500').status, 'shipped');
    assert.equal(loaded.products[0].stock, 0);
    assert.equal(loaded.orders.length, 1000);
  });

  it('DB-009 removed rows are deleted and new rows inserted', async () => {
    const snap = bigSnapshot(3);
    snap.reservations = [{ id: 'r1', reference: 'BQ-1', status: 'new', createdAt: new Date().toISOString() }];
    await store.save(snap);
    snap.orders = snap.orders.slice(1);
    snap.reservations = [];
    snap.customerSessions = {};
    snap.products.push({ id: 'p2', slug: 'p-two', type: 'jewellery', collectionId: 'col-gold', priceCents: 100, stock: 2, published: true, name: 'Pendant' });
    await store.save(snap);
    const loaded = await store.load();
    assert.deepEqual(loaded.orders.map(o => o.id).sort(), ['o1', 'o2']);
    assert.equal(loaded.reservations.length, 0);
    assert.deepEqual(loaded.customerSessions, {});
    assert.ok(loaded.products.some(p => p.id === 'p2'));
    const c = new Client({ connectionString: dbUrl }); await c.connect();
    const items = await c.query("SELECT count(*)::int AS n FROM order_items WHERE order_id = 'o0'");
    await c.end();
    assert.equal(items.rows[0].n, 0, 'line items of a removed order are removed too');
  });

  it('DB-010 a failed save leaves nothing half-written, and the next save catches up', async () => {
    const snap = bigSnapshot(2);
    await store.save(snap);
    snap.orders[0].status = 'processing';
    snap.products[0].stock = -5; // violates the CHECK constraint
    await assert.rejects(store.save(snap));
    let loaded = await store.load();
    assert.equal(loaded.orders.find(o => o.id === 'o0').status, 'paid', 'order change rolled back with the failed save');
    snap.products[0].stock = 3;
    await store.save(snap);
    loaded = await store.load();
    assert.equal(loaded.orders.find(o => o.id === 'o0').status, 'processing');
    assert.equal(loaded.products[0].stock, 3);
  });

  it('DB-011 a second store instance (a restart) loads the data and saves incrementally from it', async () => {
    const snap = bigSnapshot(5);
    await store.save(snap);
    const { PostgresStore } = require(path.join(ROOT, 'postgres-store.js'));
    const restarted = new PostgresStore(dbUrl);
    const data = await restarted.load();
    data.orders[0].status = 'delivered';
    const statements = await countStatements(restarted, () => restarted.save(data));
    await restarted.close();
    assert.ok(statements <= 6, `${statements} statements after restart`);
    assert.equal((await store.load()).orders.find(o => o.id === data.orders[0].id).status, 'delivered');
  });

  it('DB-007 password hashes are stored, never plain-text passwords', async () => {
    const c = new Client({ connectionString: dbUrl }); await c.connect();
    const rows = await c.query("SELECT data::text AS d FROM customers");
    await c.end();
    for (const r of rows.rows) assert.ok(!/"password"\s*:/.test(r.d));
  });
});
