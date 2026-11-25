'use strict';
// Customer account, session and authorisation tests. Emails are captured by the mock provider.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('../helpers/harness.cjs');

const PASSWORD = 'Correct-horse-42';
function registration(email, overrides = {}) {
  return { title: 'Mr', firstName: 'Alan', lastName: 'Turing', email, confirmEmail: email, password: PASSWORD, confirmPassword: PASSWORD, dateOfBirth: '1985-06-23', phone: '+447700900456', ageConfirmed: true, ...overrides };
}
const newEmail = () => `acct.${crypto.randomBytes(5).toString('hex')}@example.com`;
const linkFrom = (mail, param) => new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get(param);

describe('Customer accounts', () => {
  let server;
  before(async () => { server = await h.startServer({ env: { GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com', MOCK_GOOGLE: '1' } }); });
  after(async () => { await server.stop(); });

  it('ACC-001 registration sends a verification link and blocks sign-in until it is used', async () => {
    const c = server.client(), email = newEmail();
    const reg = await c.post('/api/account/register', registration(email));
    assert.equal(reg.status, 201);
    const mail = h.lastEmailTo(server, email);
    assert.ok(mail, 'verification email sent');
    assert.match(mail.text, /^.*https:\/\/shop\.test\/account\.html\?verify=/m, 'link uses the configured HTTPS site address');
    const early = await c.post('/api/account/login', { email, password: PASSWORD });
    assert.equal(early.status, 403);
    const token = linkFrom(mail, 'verify');
    assert.equal((await c.post('/api/account/verify-email', { token })).status, 200);
    assert.equal((await c.post('/api/account/verify-email', { token })).status, 400, 'verification links are single-use');
    const login = await c.post('/api/account/login', { email, password: PASSWORD });
    assert.equal(login.status, 200);
  });

  it('ACC-002 the session cookie is HttpOnly, Secure, SameSite=Lax and random', async () => {
    const c = await h.registerAndSignIn(server);
    const cookie = c.lastSetCookie.find(x => x.startsWith('bireqdar_customer_session='));
    assert.ok(cookie);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie.split(';')[0].split('=')[1], /^[a-f0-9]{64}$/);
  });

  it('ACC-003 registration validates the form on the server', async () => {
    const cases = {
      'short password': { password: 'short', confirmPassword: 'short' }, 'passwords differ': { confirmPassword: 'Different-pass-99' },
      'emails differ': { confirmEmail: 'other@example.com' }, 'under 18': { dateOfBirth: new Date(Date.now() - 17 * 365.25 * 864e5).toISOString().slice(0, 10) },
      'future birth date': { dateOfBirth: '2999-01-01' }, 'impossible date': { dateOfBirth: '1990-02-31' }, 'phone without country code': { phone: '07700900123' },
      'no age confirmation': { ageConfirmed: false }, 'markup in name': { firstName: '<img src=x>' }, 'bad title': { title: 'Lord' }, 'password over 200': { password: 'a'.repeat(201), confirmPassword: 'a'.repeat(201) }
    };
    for (const [label, override] of Object.entries(cases)) {
      const r = await server.client().post('/api/account/register', registration(newEmail(), override));
      assert.equal(r.status, 400, `${label} returned ${r.status}`);
    }
  });

  it('ACC-004 wrong password and unknown email give the same answer (no account enumeration at sign-in)', async () => {
    const c = await h.registerAndSignIn(server);
    const wrong = await server.client().post('/api/account/login', { email: c.email, password: 'Wrong-password-1' });
    const unknown = await server.client().post('/api/account/login', { email: newEmail(), password: 'Wrong-password-1' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.data.error, unknown.data.error);
  });

  it('ACC-005 duplicate registration does not reveal whether an email is registered', async () => {
    const c = await h.registerAndSignIn(server);
    const dup = await server.client().post('/api/account/register', registration(c.email));
    const fresh = await server.client().post('/api/account/register', registration(newEmail()));
    assert.equal(dup.status, fresh.status, `existing email returned ${dup.status}, new email ${fresh.status}`);
  });

  it('ACC-006 repeated wrong passwords for one account are rate limited, even across IP addresses', async () => {
    const c = await h.registerAndSignIn(server);
    const statuses = [];
    for (let i = 0; i < 7; i++) statuses.push((await server.client().post('/api/account/login', { email: c.email, password: 'Wrong-password-' + i })).status);
    assert.ok(statuses.includes(429), statuses.join(','));
    const correct = await server.client().post('/api/account/login', { email: c.email, password: PASSWORD });
    assert.equal(correct.status, 429, 'lockout also applies to the correct password during the window');
  });

  it('ACC-007 password reset: generic answer, single-use token, old sessions ended', async () => {
    const c = await h.registerAndSignIn(server);
    const unknown = await server.client().post('/api/account/forgot-password', { email: newEmail() });
    const known = await server.client().post('/api/account/forgot-password', { email: c.email });
    assert.equal(unknown.status, 200);
    assert.equal(known.status, 200);
    assert.equal(unknown.data.message, known.data.message);
    const token = linkFrom(h.lastEmailTo(server, c.email), 'reset');
    assert.ok(token);
    const tooShort = await server.client().post('/api/account/reset-password', { token, password: 'short' });
    assert.equal(tooShort.status, 400);
    const reset = await server.client().post('/api/account/reset-password', { token, password: 'Brand-new-pass-77' });
    assert.equal(reset.status, 200);
    assert.equal((await server.client().post('/api/account/reset-password', { token, password: 'Another-pass-88' })).status, 400, 'token is single-use');
    assert.equal((await c.get('/api/account')).data.authenticated, false, 'existing sessions are signed out');
    assert.equal((await server.client().post('/api/account/login', { email: c.email, password: PASSWORD })).status, 401);
    assert.equal((await server.client().post('/api/account/login', { email: c.email, password: 'Brand-new-pass-77' })).status, 200);
    for (const bad of ['', 'x', 'a'.repeat(43), '../../etc', 'A'.repeat(43) + '!']) assert.equal((await server.client().post('/api/account/reset-password', { token: bad, password: 'Brand-new-pass-77' })).status, 400);
  });

  it('ACC-008 sign-out invalidates the session on the server', async () => {
    const c = await h.registerAndSignIn(server);
    const stolen = [...c.cookies];
    assert.equal((await c.post('/api/account/logout', {})).status, 200);
    const replay = server.client();
    for (const [k, v] of stolen) replay.cookies.set(k, v);
    assert.equal((await replay.get('/api/account')).data.authenticated, false);
  });

  it('ACC-009 protected account actions require sign-in; forged cookies are ignored', async () => {
    const anon = server.client();
    assert.equal((await anon.get('/api/account')).data.authenticated, false);
    for (const route of ['/api/account/address', '/api/account/profile', '/api/account/wishlist']) assert.equal((await anon.post(route, {})).status, 401, route);
    const forged = server.client();
    forged.cookies.set('bireqdar_customer_session', 'a'.repeat(64));
    assert.equal((await forged.get('/api/account')).data.authenticated, false);
  });

  it('ACC-010 a client sees only their own orders (no IDOR between accounts)', async () => {
    const owner = await h.ownerClient(server);
    const p = await h.createProduct(owner, { stock: 5, priceCents: 5000 });
    const alice = await h.registerAndSignIn(server), bob = await h.registerAndSignIn(server);
    const order = await alice.post('/api/checkout', h.guestCheckout([{ id: p.id, quantity: 1 }]));
    assert.equal(order.status, 200, order.text);
    const bobView = await bob.get('/api/account');
    assert.ok(!bobView.data.orders.some(o => o.reference === order.data.reference));
    assert.ok(!JSON.stringify(bobView.data).includes(alice.email));
    const aliceView = await alice.get('/api/account');
    assert.ok(aliceView.data.orders.some(o => o.reference === order.data.reference));
    assert.ok(!('passwordHash' in aliceView.data.customer) && !('id' in aliceView.data.customer));
    server._owner = owner;
  });

  it('ACC-011 profile updates ignore fields the client must not control (mass assignment)', async () => {
    const c = await h.registerAndSignIn(server);
    const r = await c.post('/api/account/profile', { title: 'Dr', firstName: 'Ada', lastName: 'King', dateOfBirth: '1980-12-10', phone: '+447700900999', email: 'attacker@example.com', id: 'owner', passwordHash: 'x', emailVerifiedAt: null, role: 'owner' });
    assert.equal(r.status, 200, r.text);
    const me = await c.get('/api/account');
    assert.equal(me.data.customer.email, c.email);
    assert.equal(me.data.customer.firstName, 'Ada');
    assert.equal((await server.client().post('/api/account/login', { email: c.email, password: PASSWORD })).status, 200, 'password unchanged');
  });

  it('ACC-012 saved address is validated', async () => {
    const c = await h.registerAndSignIn(server);
    assert.equal((await c.post('/api/account/address', { address1: '1 High Street', city: 'Leeds', postalCode: 'LS1 1AA', country: 'United Kingdom', phone: '' })).status, 200);
    assert.equal((await c.post('/api/account/address', { address1: '1 High Street', city: 'Leeds', postalCode: 'NOPE', country: 'United Kingdom' })).status, 400);
    assert.equal((await c.post('/api/account/address', { address1: '<script>', city: 'Leeds', postalCode: 'LS1 1AA', country: 'UK' })).status, 400);
  });

  it('ACC-013 the wishlist only accepts pieces that are on sale publicly', async () => {
    const owner = server._owner || await h.ownerClient(server);
    const hidden = await h.createProduct(owner, { published: false, name: 'Secret unreleased piece' });
    const c = await h.registerAndSignIn(server);
    assert.equal((await c.post('/api/account/wishlist', { productId: 'tennis-chain-925-silver' })).status, 200);
    assert.equal((await c.post('/api/account/wishlist', { productId: 'tennis-chain-925-silver' })).data.wishlist.filter(x => x === 'tennis-chain-925-silver').length, 1, 'no duplicates');
    const sneaky = await c.post('/api/account/wishlist', { productId: hidden.id });
    assert.equal(sneaky.status, 404, 'unpublished pieces cannot be saved');
    const me = await c.get('/api/account');
    assert.ok(!JSON.stringify(me.data.wishlist).includes('Secret unreleased piece'), 'unpublished piece details must not leak');
    assert.equal((await c.post('/api/account/wishlist', { productId: 'tennis-chain-925-silver', action: 'remove' })).data.wishlist.length, 0);
  });

  it('ACC-014 customer sessions cannot reach the staff studio API', async () => {
    const c = await h.registerAndSignIn(server);
    for (const route of ['/api/admin/data', '/api/admin/me', '/api/admin/staff']) assert.equal((await c.get(route)).status, 401, route);
  });

  it('ACC-018 an existing client who tries to register again is emailed instead, and nothing changes', async () => {
    const c = await h.registerAndSignIn(server);
    const r = await server.client().post('/api/account/register', registration(c.email, { password: 'Hijack-attempt-99', confirmPassword: 'Hijack-attempt-99' }));
    assert.equal(r.status, 201);
    const mail = h.lastEmailTo(server, c.email);
    assert.match(mail.subject, /already have/i);
    assert.match(mail.text, /account\.html\?forgot=1/);
    assert.equal((await server.client().post('/api/account/login', { email: c.email, password: PASSWORD })).status, 200, 'original password still works');
    assert.equal((await server.client().post('/api/account/login', { email: c.email, password: 'Hijack-attempt-99' })).status, 401);
  });

  it('ACC-019 Google sign-in removes a password set by someone who never confirmed the email (pre-account takeover)', async () => {
    const victim = newEmail();
    const attacker = server.client();
    assert.equal((await attacker.post('/api/account/register', registration(victim, { password: 'Attacker-pass-123', confirmPassword: 'Attacker-pass-123' }))).status, 201);
    const owner = server.client();
    const google = await owner.post('/api/account/google', { credential: h.googleCredential({ email: victim }) });
    assert.equal(google.status, 200, google.text);
    assert.equal((await owner.get('/api/account')).data.authenticated, true);
    assert.equal((await server.client().post('/api/account/login', { email: victim, password: 'Attacker-pass-123' })).status, 401, 'attacker password no longer works');
  });

  it('ACC-020 Google sign-in keeps the password of an account whose owner already confirmed the email', async () => {
    const c = await h.registerAndSignIn(server);
    assert.equal((await server.client().post('/api/account/google', { credential: h.googleCredential({ email: c.email }) })).status, 200);
    assert.equal((await server.client().post('/api/account/login', { email: c.email, password: PASSWORD })).status, 200);
  });

  it('ACC-021 a password reset confirms the email of an unconfirmed account', async () => {
    const email = newEmail();
    await server.client().post('/api/account/register', registration(email));
    await server.client().post('/api/account/forgot-password', { email });
    const token = linkFrom(h.lastEmailTo(server, email), 'reset');
    assert.equal((await server.client().post('/api/account/reset-password', { token, password: 'Reset-by-owner-55' })).status, 200);
    assert.equal((await server.client().post('/api/account/login', { email, password: 'Reset-by-owner-55' })).status, 200);
  });

  it('ACC-015 signed-in clients can change their password', { todo: 'Not implemented: no change-password endpoint; clients must use the email reset flow.' }, () => {});
  it('ACC-016 clients can delete their account and personal data', { todo: 'Not implemented: no account deletion (UK GDPR Art. 17 requests are manual).' }, () => {});
  it('ACC-017 clients can export their personal data', { todo: 'Not implemented: no self-service data export (UK GDPR Art. 15/20 requests are manual).' }, () => {});
});
