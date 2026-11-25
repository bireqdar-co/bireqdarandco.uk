'use strict';
// Smoke, HTTP security header, static-file and API hygiene tests.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('../helpers/harness.cjs');

const PUBLIC_PAGES = ['/', '/index.html', '/shop.html', '/jewellery.html', '/timepieces.html', '/watch.html', '/product.html', '/cart.html', '/checkout.html', '/order.html', '/account.html', '/contact.html', '/bespoke.html', '/about.html', '/privacy.html'];

describe('Platform', () => {
  let server, c;
  before(async () => { server = await h.startServer(); c = server.client(); });
  after(async () => { await server.stop(); });

  it('SMK-001 health endpoint reports the expected storage engine', async () => {
    const r = await c.get('/api/store');
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    if (server.mode === 'production') assert.equal(r.data.database, 'postgres');
  });

  it('SMK-002 every public page responds 200 with HTML', async () => {
    for (const page of PUBLIC_PAGES) {
      const r = await c.get(page, { raw: true });
      assert.equal(r.status, 200, page);
      assert.match(r.headers.get('content-type'), /text\/html/, page);
    }
  });

  it('SMK-003 catalogue API returns published products and active collections', async () => {
    const r = await c.get('/api/catalog');
    assert.equal(r.status, 200);
    assert.ok(r.data.products.length > 0);
    assert.ok(r.data.collections.length > 0);
    for (const p of r.data.products) for (const k of ['passwordHash', 'published', 'createdBy']) assert.ok(!(k in p), `${p.id} exposes ${k}`);
  });

  it('SEC-HDR-001 security headers are present on pages and API responses', async () => {
    for (const url of ['/', '/api/catalog']) {
      const r = await c.get(url, { raw: true });
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff', url);
      assert.equal(r.headers.get('x-frame-options'), 'DENY', url);
      assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', url);
      assert.match(r.headers.get('permissions-policy') || '', /camera=\(\)/, url);
      const csp = r.headers.get('content-security-policy') || '';
      for (const directive of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]) assert.ok(csp.includes(directive), `${url} CSP missing ${directive}`);
      assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'script-src must not allow inline scripts');
      assert.match(r.headers.get('strict-transport-security') || '', /max-age=\d{7,}/, `${url} HSTS over HTTPS`);
    }
  });

  it('SEC-HDR-002 API responses are never cached and send no permissive CORS headers', async () => {
    const r = await c.get('/api/catalog', { headers: { origin: 'https://evil.example' } });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  });

  it('SEC-STA-001 server code, configuration, data and dependency files are not downloadable', async () => {
    const blocked = ['/server.js', '/postgres-store.js', '/staff-auth.js', '/package.json', '/package-lock.json', '/render.yaml', '/README.md', '/.env', '/.env.example', '/.git/config', '/.gitignore', '/data/store.json', '/db/schema.sql', '/node_modules/pg/package.json', '/scripts/vendor-three.js', '/SERVER.JS', '/Package.json'];
    for (const url of blocked) {
      const r = await c.get(url, { raw: true });
      assert.ok([403, 404].includes(r.status), `${url} returned ${r.status}`);
    }
  });

  it('SEC-STA-002 internal documentation, tests and audit reports are not publicly served', async () => {
    const internal = ['/CODE_GUIDE.md', '/db/SCHEMA.md', '/skills-lock.json', '/tests/helpers/harness.cjs', '/tests/README.md', '/testing/SECURITY_AUDIT.md', '/testing/BUG_REPORT.md'];
    for (const url of internal) {
      const r = await c.get(url, { raw: true });
      assert.ok([403, 404].includes(r.status), `${url} returned ${r.status}`);
    }
  });

  it('SEC-STA-003 path traversal attempts cannot read files outside the web root', async () => {
    const attempts = ['/..%2fserver.js', '/%2e%2e/%2e%2e/etc/passwd', '/uploads/..%2f..%2fserver.js', '/uploads/%2e%2e/server.js', '/assets/..%2f..%2fetc%2fpasswd', '/%c0%ae%c0%ae/etc/passwd', '/uploads/%2e%2e%5cserver.js'];
    for (const url of attempts) {
      const r = await c.get(url, { raw: true });
      assert.ok([400, 403, 404].includes(r.status), `${url} returned ${r.status}`);
      assert.ok(!r.text.includes('require(') && !r.text.includes('root:x:'), `${url} leaked content`);
    }
  });

  it('SEC-STA-004 the staff studio is only reachable at its private address', async () => {
    const legacy = await c.get('/admin.html', { raw: true });
    if (server.mode === 'production') assert.equal(legacy.status, 404);
    const studio = await c.get('/' + h.ADMIN_PATH, { raw: true });
    assert.equal(studio.status, 200);
    assert.match(studio.headers.get('x-robots-tag') || '', /noindex/);
    assert.equal(studio.headers.get('cache-control'), 'no-store');
  });

  it('SEC-STA-005 static files only answer GET and HEAD', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const r = await c.request(method, '/index.html', { raw: true });
      assert.equal(r.status, 405, `${method} /index.html returned ${r.status}`);
    }
  });

  it('NAV-404-001 unknown pages return 404 with a branded HTML page for browsers', async () => {
    const r = await c.get('/this-page-does-not-exist', { raw: true, headers: { accept: 'text/html' } });
    assert.equal(r.status, 404);
    assert.match(r.headers.get('content-type') || '', /text\/html/);
    assert.match(r.text, /BIREQDAR/);
    const api = await c.get('/api/does-not-exist');
    assert.equal(api.status, 404);
    assert.equal(api.data.error, 'Not found.');
  });

  it('API-001 malformed requests are rejected without leaking internals', async () => {
    const wrongType = await c.request('POST', '/api/reservations', { body: 'name=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(wrongType.status, 415);
    const badJson = await c.request('POST', '/api/reservations', { body: '{"name":', headers: { 'content-type': 'application/json' } });
    assert.equal(badJson.status, 400);
    assert.equal(badJson.data.error, 'Invalid JSON');
    const arrayBody = await c.request('POST', '/api/reservations', { body: '[1,2]', headers: { 'content-type': 'application/json' } });
    assert.equal(arrayBody.status, 400);
    for (const r of [wrongType, badJson, arrayBody]) assert.ok(!/at .*\.js:\d+/.test(r.text), 'stack trace leaked');
  });

  it('API-002 request bodies over 7 MB are refused', async () => {
    const big = JSON.stringify({ name: 'x', email: 'a@b.co', message: 'y'.repeat(7.5 * 1024 * 1024) });
    const r = await c.request('POST', '/api/reservations', { body: big, headers: { 'content-type': 'application/json' } });
    assert.equal(r.status, 413);
  });

  it('SEC-CSRF-001 state-changing requests without a same-site Origin are refused', async () => {
    const body = { name: 'Test', email: 'csrf@example.com', message: 'hello' };
    const none = await c.post('/api/reservations', body, { headers: { origin: null } });
    assert.equal(none.status, 403);
    const evil = await c.post('/api/reservations', body, { headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    const lookalike = await c.post('/api/reservations', body, { headers: { origin: 'https://shop.test.evil.example' } });
    assert.equal(lookalike.status, 403);
  });
});
