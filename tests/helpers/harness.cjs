'use strict';
// Test harness: starts an isolated copy of server.js on a free port with its own data
// folder, upload folder and (when TEST_DATABASE_URL is set) its own throwaway PostgreSQL
// database. Stripe and Resend are replaced by tests/helpers/mock-providers.cjs.
//
// Nothing here touches the live site, the real database or real customer data.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const APP_ORIGIN = 'https://shop.test';
const SETUP_KEY = 'test-setup-key-' + 'x'.repeat(40);
const ADMIN_PATH = 'studio-test-private-address';
const WEBHOOK_SECRET = 'whsec_test_' + crypto.randomBytes(16).toString('hex');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function createDatabase() {
  const admin = process.env.TEST_DATABASE_URL;
  if (!admin) return null;
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const name = `bq_test_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const client = new Client({ connectionString: admin });
  await client.connect();
  await client.query(`CREATE DATABASE ${name}`);
  await client.end();
  const url = new URL(admin); url.pathname = `/${name}`;
  return { name, url: url.toString(), admin };
}
async function dropDatabase(db) {
  if (!db) return;
  const { Client } = require(path.join(ROOT, 'node_modules', 'pg'));
  const client = new Client({ connectionString: db.admin });
  await client.connect();
  await client.query(`DROP DATABASE IF EXISTS ${db.name} WITH (FORCE)`);
  await client.end();
}

/**
 * Start a server.
 * options.mode: 'production' (needs TEST_DATABASE_URL) or 'development'.
 * options.env: extra environment variables.
 */
async function startServer(options = {}) {
  const mode = options.mode || (process.env.TEST_DATABASE_URL ? 'production' : 'development');
  if (mode === 'production' && !process.env.TEST_DATABASE_URL) throw new Error('Production-mode tests need TEST_DATABASE_URL.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bq-test-'));
  const dataDir = path.join(dir, 'data'), uploadDir = path.join(dir, 'uploads');
  fs.mkdirSync(dataDir); fs.mkdirSync(uploadDir);
  const outbox = path.join(dir, 'outbox.jsonl'), controlFile = path.join(dir, 'control.json');
  fs.writeFileSync(outbox, ''); fs.writeFileSync(controlFile, '{}');
  const db = mode === 'production' ? await createDatabase() : null;
  const port = await freePort();
  const env = {
    PATH: process.env.PATH, HOME: process.env.HOME,
    NODE_ENV: mode, HOST: '127.0.0.1', PORT: String(port),
    DATA_DIR: dataDir, UPLOAD_DIR: uploadDir,
    APP_URL: APP_ORIGIN, RENDER_EXTERNAL_URL: APP_ORIGIN,
    ADMIN_SETUP_KEY: SETUP_KEY, ADMIN_PATH,
    STAFF_MFA_KEY: 'test-mfa-key-' + 'y'.repeat(40),
    STRIPE_SECRET_KEY: 'sk_test_mock_' + 'z'.repeat(24),
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    RESEND_API_KEY: 're_test_mock', RESEND_FROM_EMAIL: 'orders@shop.test',
    LIVE_CHECKOUT_ENABLED: 'false',
    MOCK_OUTBOX: outbox, MOCK_CONTROL: controlFile,
    ...(db ? { DATABASE_URL: db.url } : {}),
    ...(options.env || {})
  };
  for (const [k, v] of Object.entries(env)) if (v === null) delete env[k];
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'mock-providers.cjs'), path.join(ROOT, 'server.js')], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', d => { logs += d; });
  child.stderr.on('data', d => { logs += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start in time.\n' + logs)), 20000);
    const check = () => { if (logs.includes('listening on')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', check);
    child.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited with ${code}\n${logs}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const server = {
    mode, base, port, dir, dataDir, uploadDir, db, child,
    logs: () => logs,
    outbox: () => fs.readFileSync(outbox, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)),
    setMock: value => fs.writeFileSync(controlFile, JSON.stringify(value)),
    client: (opts) => new Client(base, opts),
    async stop() {
      if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise(r => child.once('exit', r)); }
      await dropDatabase(db).catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
  return server;
}

let ipCounter = 1;
/** Minimal HTTP client with a cookie jar and a distinct client IP (via CF-Connecting-IP, trusted only on Render). */
class Client {
  constructor(base, opts = {}) {
    this.base = base;
    this.cookies = new Map();
    this.ip = opts.ip || `198.51.100.${(ipCounter++ % 250) + 1}`;
    this.origin = opts.origin === undefined ? APP_ORIGIN : opts.origin;
    this.lastSetCookie = [];
  }
  cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
  async request(method, url, { json, body, headers = {}, raw = false } = {}) {
    const h = { 'cf-connecting-ip': this.ip, 'x-forwarded-proto': 'https', ...headers };
    if (this.cookies.size) h.cookie = this.cookieHeader();
    if (this.origin && !('origin' in headers) && method !== 'GET' && method !== 'HEAD') h.origin = this.origin;
    if (headers.origin === null) delete h.origin;
    let payload = body;
    if (json !== undefined && method !== 'GET' && method !== 'HEAD') { payload = JSON.stringify(json); h['content-type'] = h['content-type'] || 'application/json'; }
    const res = await fetch(this.base + url, { method, headers: h, body: payload, redirect: 'manual' });
    this.lastSetCookie = res.headers.getSetCookie();
    for (const c of this.lastSetCookie) {
      const [pair] = c.split(';'); const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (/Max-Age=0/i.test(c) || value === '') this.cookies.delete(name); else this.cookies.set(name, value);
    }
    const text = await res.text();
    let data = null;
    if (!raw) { try { data = JSON.parse(text); } catch { data = null; } }
    return { status: res.status, headers: res.headers, text, data, setCookie: this.lastSetCookie };
  }
  get(url, o) { return this.request('GET', url, o); }
  post(url, json, o = {}) { return this.request('POST', url, { ...o, json }); }
  put(url, json, o = {}) { return this.request('PUT', url, { ...o, json }); }
  patch(url, json, o = {}) { return this.request('PATCH', url, { ...o, json }); }
  del(url, o = {}) { return this.request('DELETE', url, o); }
}

// ---- Domain helpers --------------------------------------------------------------
const staffAuth = require(path.join(ROOT, 'staff-auth.js'));

/** Completes owner setup and two-factor enrolment; returns a signed-in owner client. */
async function ownerClient(server) {
  const c = server.client();
  const setup = await c.post('/api/admin/setup', { setupKey: SETUP_KEY, username: 'owner.test', password: 'Owner-password-123' });
  let secret, challenge;
  if (setup.status === 201) { secret = setup.data.secret; challenge = setup.data.challenge; server._ownerSecret = secret; }
  else {
    const login = await c.post('/api/admin/login', { username: 'owner.test', password: 'Owner-password-123' });
    if (login.status !== 200) throw new Error('Owner login failed: ' + login.text);
    challenge = login.data.challenge; secret = server._ownerSecret;
  }
  const code = await freshTotp(secret, server);
  const verify = await c.post('/api/admin/mfa/verify', { challenge, code });
  if (verify.status !== 200) throw new Error('Owner MFA failed: ' + verify.text);
  return c;
}
/** TOTP codes are single-use per 30 s step; wait for the next step if this one was used. */
async function freshTotp(secret, server) {
  const step = Math.floor(Date.now() / 30000);
  server._usedSteps = server._usedSteps || new Set();
  if (server._usedSteps.has(step)) await new Promise(r => setTimeout(r, 30000 - (Date.now() % 30000) + 200));
  server._usedSteps.add(Math.floor(Date.now() / 30000));
  return staffAuth.totpCode(secret);
}

async function createProduct(owner, overrides = {}) {
  const body = {
    name: 'Test Piece ' + crypto.randomBytes(3).toString('hex'), type: 'jewellery', category: 'rings', collectionId: 'col-gold',
    short: 'Test listing', description: 'Created by automated tests.', priceCents: 125000, stock: 1, currency: 'GBP',
    image: '/assets/catalogue/tennis-chain-hero.jpg', published: true, isDemo: false, inquiryOnly: false, vatRate: 20, ...overrides
  };
  const res = await owner.post('/api/admin/products', body);
  if (res.status !== 201) throw new Error('createProduct failed: ' + res.text);
  return res.data.product;
}

function guestCheckout(items, overrides = {}) {
  return {
    name: 'Ada Lovelace', email: 'ada.test@example.com', phone: '+44 7700 900123', address1: '1 Test Street', address2: '',
    city: 'London', postalCode: 'SW1A 1AA', country: 'United Kingdom', acceptTerms: true, requestId: crypto.randomUUID(), items, ...overrides
  };
}

function signStripe(payload, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const body = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return { body, header: `t=${timestamp},v1=${sig}` };
}
async function sendWebhook(client, event, opts = {}) {
  const { body, header } = signStripe(event, opts.secret, opts.timestamp);
  return client.request('POST', '/api/stripe-webhook', { body, headers: { 'stripe-signature': opts.header || header, 'content-type': 'application/json', origin: null } });
}
function completedEvent(order, session, overrides = {}) {
  return {
    id: 'evt_' + crypto.randomBytes(8).toString('hex'), type: 'checkout.session.completed',
    data: { object: { id: session, metadata: { orderId: order.id }, client_reference_id: order.reference, payment_status: 'paid', amount_total: order.totalCents, currency: String(order.currency).toLowerCase(), total_details: { amount_tax: 0 }, ...overrides } }
  };
}
async function findOrder(owner, reference) {
  const data = await owner.get('/api/admin/data');
  return data.data.orders.find(o => o.reference === reference);
}
function lastEmailTo(server, email) {
  return server.outbox().filter(e => e.provider === 'resend' && [].concat(e.to || []).includes(email)).pop();
}

// Registers a client through the real verification flow (email captured by the mock).
async function registerAndSignIn(server) {
  const c = server.client();
  const email = `client.${crypto.randomBytes(4).toString('hex')}@example.com`;
  const reg = await c.post('/api/account/register', { title: 'Ms', firstName: 'Grace', lastName: 'Hopper', email, confirmEmail: email, password: 'Correct-horse-42', confirmPassword: 'Correct-horse-42', dateOfBirth: '1990-01-01', phone: '+447700900123', ageConfirmed: true });
  if (reg.status !== 201) throw new Error('register failed ' + reg.text);
  const mail = lastEmailTo(server, email);
  const token = new URL(mail.text.match(/https?:\/\/\S+/)[0]).searchParams.get('verify');
  const ver = await c.post('/api/account/verify-email', { token });
  if (ver.status !== 200) throw new Error('verify failed ' + ver.text);
  const login = await c.post('/api/account/login', { email, password: 'Correct-horse-42' });
  if (login.status !== 200) throw new Error('login failed ' + login.text);
  c.email = email;
  return c;
}

/** Builds a credential accepted by the fake Google client (MOCK_GOOGLE=1). */
function googleCredential(claims) {
  return `mockgoogle.${Buffer.from(JSON.stringify({ email_verified: true, sub: 'google-' + crypto.randomBytes(6).toString('hex'), name: 'Test Client', given_name: 'Test', family_name: 'Client', ...claims })).toString('base64url')}.${'x'.repeat(120)}`;
}

module.exports = { googleCredential, registerAndSignIn, startServer, Client, ownerClient, createProduct, guestCheckout, sendWebhook, signStripe, completedEvent, findOrder, lastEmailTo, freshTotp, APP_ORIGIN, SETUP_KEY, ADMIN_PATH, WEBHOOK_SECRET, ROOT, hasDatabase: !!process.env.TEST_DATABASE_URL };
