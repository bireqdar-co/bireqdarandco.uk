'use strict';
// Staff studio (admin) authentication, role-based access, uploads and enquiry tests.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('../helpers/harness.cjs');

const ADMIN_ROUTES = [
  ['GET', '/api/admin/data'], ['GET', '/api/admin/staff'], ['GET', '/api/admin/me'], ['PUT', '/api/admin/settings'], ['POST', '/api/admin/products'],
  ['PUT', '/api/admin/products/tennis-chain-925-silver'], ['DELETE', '/api/admin/products/tennis-chain-925-silver'], ['PATCH', '/api/admin/products/tennis-chain-925-silver/stock'],
  ['POST', '/api/admin/upload'], ['POST', '/api/admin/collections'], ['PUT', '/api/admin/orders/x'], ['PUT', '/api/admin/reservations/x'], ['DELETE', '/api/admin/demo-data'], ['POST', '/api/admin/staff']
];
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('Staff studio', () => {
  let server, owner;
  before(async () => { server = await h.startServer(); });
  after(async () => { await server.stop(); });

  it('ADM-001 every studio API route refuses anonymous requests', async () => {
    const anon = server.client();
    for (const [method, route] of ADMIN_ROUTES) {
      const r = await anon.request(method, route, { json: {} });
      assert.equal(r.status, 401, `${method} ${route} returned ${r.status}`);
      assert.ok(!r.text.includes('passwordHash'));
    }
  });

  it('ADM-002 owner setup requires the setup key and can only happen once', async () => {
    const wrong = await server.client().post('/api/admin/setup', { setupKey: 'wrong-key', username: 'intruder', password: 'Intruder-pass-123' });
    assert.equal(wrong.status, 403);
    owner = await h.ownerClient(server);
    const again = await server.client().post('/api/admin/setup', { setupKey: h.SETUP_KEY, username: 'second', password: 'Second-owner-123' });
    assert.equal(again.status, 409);
  });

  it('ADM-003 a correct password alone never opens the studio (two-factor is mandatory)', async () => {
    const c = server.client();
    const login = await c.post('/api/admin/login', { username: 'owner.test', password: 'Owner-password-123' });
    assert.equal(login.status, 200);
    assert.equal(login.data.mfaRequired, true);
    assert.equal(login.setCookie.length, 0, 'no session cookie before the second factor');
    assert.equal((await c.get('/api/admin/data')).status, 401);
    const bad = await c.post('/api/admin/mfa/verify', { challenge: login.data.challenge, code: '000000' });
    assert.equal(bad.status, 401);
  });

  it('ADM-004 authenticator codes are locked out after five wrong attempts per sign-in', async () => {
    const c = server.client();
    const login = await c.post('/api/admin/login', { username: 'owner.test', password: 'Owner-password-123' });
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await c.post('/api/admin/mfa/verify', { challenge: login.data.challenge, code: String(100000 + i) })).status);
    assert.deepEqual(statuses.slice(0, 5), [401, 401, 401, 401, 401]);
    assert.equal(statuses[5], 401);
    const code = await h.freshTotp(server._ownerSecret, server);
    assert.equal((await c.post('/api/admin/mfa/verify', { challenge: login.data.challenge, code })).status, 401, 'locked challenge stays locked even with a valid code');
  });

  it('ADM-005 wrong studio passwords are rate limited per username', async () => {
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await server.client().post('/api/admin/login', { username: 'victim.user', password: 'guess-' + i + '-xxxxxxx' })).status);
    assert.ok(statuses.includes(429), statuses.join(','));
  });

  it('ADM-006 the studio session cookie is HttpOnly, Secure and SameSite=Strict', async () => {
    const cookie = (await (async () => { const c = server.client(); const login = await c.post('/api/admin/login', { username: 'owner.test', password: 'Owner-password-123' }); const code = await h.freshTotp(server._ownerSecret, server); const r = await c.post('/api/admin/mfa/verify', { challenge: login.data.challenge, code }); return r.setCookie; })()).find(x => x.startsWith('bireqdar_session='));
    assert.ok(cookie);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=Strict']) assert.ok(cookie.includes(attr), attr);
  });

  it('ADM-007 catalogue staff (workers) cannot reach owner-only areas', async () => {
    const created = await owner.post('/api/admin/staff', { username: 'worker.one', password: 'Worker-password-1' });
    assert.equal(created.status, 201);
    const worker = server.client();
    const login = await worker.post('/api/admin/login', { username: 'worker.one', password: 'Worker-password-1' });
    assert.equal(login.data.mfaSetupRequired, true);
    const step = await worker.post('/api/admin/mfa/verify', { challenge: login.data.challenge, code: require('../../staff-auth.js').totpCode(login.data.secret) });
    assert.equal(step.status, 200);
    const data = await worker.get('/api/admin/data');
    assert.equal(data.status, 200);
    for (const key of ['orders', 'reservations', 'customers']) assert.ok(!(key in data.data), `worker sees ${key}`);
    for (const [method, route] of [['GET', '/api/admin/staff'], ['PUT', '/api/admin/settings'], ['POST', '/api/admin/staff'], ['PUT', '/api/admin/orders/x'], ['DELETE', '/api/admin/demo-data'], ['POST', '/api/admin/collections']]) {
      assert.equal((await worker.request(method, route, { json: {} })).status, 403, `${method} ${route}`);
    }
    assert.equal((await worker.post('/api/admin/products', { name: 'Worker piece', type: 'jewellery', priceCents: 1000, collectionId: 'col-gold' })).status, 201, 'workers can manage the catalogue');
  });

  it('ADM-008 uploads accept only genuine PNG, JPEG or WebP images', async () => {
    const ok = await owner.post('/api/admin/upload', { data: `data:image/png;base64,${PNG_1PX}` });
    assert.equal(ok.status, 201);
    assert.match(ok.data.image, /^\/uploads\/[0-9a-f-]{36}\.png$/);
    assert.equal((await server.client().get(ok.data.image, { raw: true })).status, 200);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64');
    const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
    for (const data of [`data:image/svg+xml;base64,${svg}`, `data:image/png;base64,${html}`, `data:image/jpeg;base64,${PNG_1PX}`, 'javascript:alert(1)', '', `data:text/html;base64,${html}`]) {
      assert.equal((await owner.post('/api/admin/upload', { data })).status, 400, data.slice(0, 30));
    }
  });

  it('ADM-009 product fields that point at files cannot escape the asset folders', async () => {
    for (const model3d of ['../../server.js', '/etc/passwd.glb', 'assets/../../data/store.json.glb', 'https://evil.example/x.glb']) {
      const r = await owner.post('/api/admin/products', { name: 'Path test', type: 'jewellery', collectionId: 'col-gold', priceCents: 100, model3d });
      assert.equal(r.status, 400, model3d);
    }
    const spin = await owner.post('/api/admin/products', { name: 'Spin test', type: 'jewellery', collectionId: 'col-gold', priceCents: 100, spinFrames: ['../server.js'] });
    assert.equal(spin.status, 400);
  });

  it('ADM-010 order status changes follow the payment rules', async () => {
    const p = await h.createProduct(owner, { stock: 3, priceCents: 9900 });
    const r = await server.client().post('/api/checkout', h.guestCheckout([{ id: p.id, quantity: 1 }]));
    const order = await h.findOrder(owner, r.data.reference);
    assert.equal((await owner.put(`/api/admin/orders/${order.id}`, { status: 'shipped' })).status, 409, 'unpaid orders cannot ship');
    assert.equal((await owner.put(`/api/admin/orders/${order.id}`, { status: 'paid' })).status, 400, 'staff cannot mark an order paid');
    assert.equal((await owner.put(`/api/admin/orders/${order.id}`, { status: 'refunded' })).status, 400);
  });

  it('ADM-011 stock changes are bounded integers', async () => {
    const p = await h.createProduct(owner, { stock: 1 });
    // A null/absent delta (and Infinity, which JSON sends as null) is treated as 0 (no change), which is harmless.
    for (const delta of [1.5, 'x', 5000, -5000, '10; DROP TABLE products']) assert.equal((await owner.patch(`/api/admin/products/${p.id}/stock`, { delta })).status, 400, String(delta));
    const r = await owner.patch(`/api/admin/products/${p.id}/stock`, { delta: -10 });
    assert.equal(r.data.product.stock, 0, 'stock never goes negative');
  });

  it('ADM-012 enquiry text containing markup is stored as text and escaped by the studio', async () => {
    const payload = '<img src=x onerror="window.__pwned=1">';
    const r = await server.client().post('/api/reservations', { name: 'Eve Tester', email: 'eve@example.com', message: payload, reference: payload });
    assert.equal(r.status, 201);
    const data = await owner.get('/api/admin/data');
    assert.ok(data.data.reservations.some(x => x.message === payload), 'stored verbatim as data');
    const studioScript = await server.client().get('/admin.js', { raw: true });
    assert.match(studioScript.text, /const esc=s=>String\(s\?\?''\)\.replace\(\/\[&<>"'\]\/g/, 'studio has an HTML escaper');
  });

  it('ENQ-001 enquiries validate input, honour the honeypot and are rate limited', async () => {
    const c = server.client();
    assert.equal((await c.post('/api/reservations', { name: 'A', email: 'bad', message: 'x' })).status, 400);
    assert.equal((await c.post('/api/reservations', { name: 'Ann', email: 'ann@example.com', message: '' })).status, 400);
    const before = (await owner.get('/api/admin/data')).data.reservations.length;
    const bot = await c.post('/api/reservations', { name: 'Bot', email: 'bot@example.com', message: 'spam', website: 'http://spam.example' });
    assert.equal(bot.status, 200);
    assert.equal((await owner.get('/api/admin/data')).data.reservations.length, before, 'honeypot submissions are not stored');
    const svg = Buffer.from('<svg/>').toString('base64');
    assert.equal((await c.post('/api/reservations', { type: 'bespoke', name: 'Ann', email: 'ann@example.com', style: 'Ring', description: 'x', attachment: `data:image/svg+xml;base64,${svg}` })).status, 400);
    assert.equal((await c.post('/api/reservations', { type: 'bespoke', name: 'Ann', email: 'ann@example.com', style: 'Spaceship', description: 'x' })).status, 400);
    const flood = server.client(); const statuses = [];
    for (let i = 0; i < 10; i++) statuses.push((await flood.post('/api/reservations', { name: 'Flood', email: 'f@example.com', message: 'm' + i })).status);
    assert.ok(statuses.includes(429), statuses.join(','));
  });

  it('ADM-013 removing a team member ends their sessions immediately', async () => {
    const created = await owner.post('/api/admin/staff', { username: 'worker.two', password: 'Worker-password-2' });
    const worker = server.client();
    const login = await worker.post('/api/admin/login', { username: 'worker.two', password: 'Worker-password-2' });
    await worker.post('/api/admin/mfa/verify', { challenge: login.data.challenge, code: require('../../staff-auth.js').totpCode(login.data.secret) });
    assert.equal((await worker.get('/api/admin/me')).status, 200);
    assert.equal((await owner.del(`/api/admin/staff/${created.data.member.id}`)).status, 200);
    assert.equal((await worker.get('/api/admin/me')).status, 401);
  });
});
