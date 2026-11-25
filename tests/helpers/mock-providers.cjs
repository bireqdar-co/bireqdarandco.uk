'use strict';
// Test-only preload (node --require). Replaces the network calls the server makes to
// Stripe and Resend with local fakes, so tests never reach a real payment or email
// provider. Every intercepted request is appended to MOCK_OUTBOX as one JSON line.
//
// Behaviour switches (read from a JSON control file so a running test can change them):
//   MOCK_CONTROL -> { "stripe": "ok" | "fail" | "timeout", "resend": "ok" | "fail" }
const fs = require('node:fs');
const crypto = require('node:crypto');

const outbox = process.env.MOCK_OUTBOX;
const controlFile = process.env.MOCK_CONTROL;
const realFetch = globalThis.fetch;

function control() {
  try { return JSON.parse(fs.readFileSync(controlFile, 'utf8')); } catch { return {}; }
}
function record(entry) {
  if (outbox) fs.appendFileSync(outbox, JSON.stringify({ at: Date.now(), ...entry }) + '\n');
}
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
const stripeSessions = new Map();

globalThis.fetch = async function mockedFetch(input, init = {}) {
  const url = String(input instanceof Request ? input.url : input);
  const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
  if (url.startsWith('https://api.stripe.com/')) {
    const mode = control().stripe || 'ok';
    const params = Object.fromEntries(new URLSearchParams(String(init.body || '')));
    // Never record the API key itself.
    record({ provider: 'stripe', url, idempotencyKey: headers['idempotency-key'] || '', params, authScheme: String(headers.authorization || '').split(' ')[0] });
    if (mode === 'timeout') throw Object.assign(new Error('mock timeout'), { name: 'TimeoutError' });
    if (mode === 'fail') return json(402, { error: { message: 'Your card was declined.', type: 'card_error' } });
    const expire = url.match(/\/v1\/checkout\/sessions\/([^/]+)\/expire$/);
    if (expire) {
      // control().expire: 'ok' (default) or 'completed' (the client has already paid).
      if (control().expire === 'completed') return json(400, { error: { message: 'Only Checkout Sessions with a status of open can be expired. This session has a status of complete.', type: 'invalid_request_error' } });
      return json(200, { id: decodeURIComponent(expire[1]), object: 'checkout.session', status: 'expired' });
    }
    const key = headers['idempotency-key'];
    if (key && stripeSessions.has(key)) return json(200, stripeSessions.get(key));
    const id = `cs_test_${crypto.randomBytes(12).toString('hex')}`;
    const session = { id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}` };
    if (key) stripeSessions.set(key, session);
    return json(200, session);
  }
  if (url.startsWith('https://api.resend.com/')) {
    const mode = control().resend || 'ok';
    let body = {};
    try { body = JSON.parse(String(init.body || '{}')); } catch {}
    record({ provider: 'resend', url, idempotencyKey: headers['idempotency-key'] || '', to: body.to, subject: body.subject, text: body.text, html: body.html, mode });
    if (mode === 'fail') return json(500, { name: 'application_error', message: 'mock outage' });
    return json(200, { id: `email_${crypto.randomBytes(8).toString('hex')}` });
  }
  if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url)) return realFetch(input, init);
  // Any other outbound call during tests is a bug: fail loudly instead of reaching the internet.
  record({ provider: 'blocked', url });
  throw new Error(`Blocked outbound request during tests: ${url}`);
};

// Google sign-in fake (only when MOCK_GOOGLE=1). A test credential is "mockgoogle." followed by
// base64url JSON claims, padded so it passes the server's length check.
if (process.env.MOCK_GOOGLE === '1') {
  const Module = require('node:module');
  const originalLoad = Module._load;
  class FakeOAuth2Client {
    constructor(clientId) { this.clientId = clientId; }
    async verifyIdToken({ idToken, audience }) {
      const match = String(idToken).match(/^mockgoogle\.([A-Za-z0-9_-]+)\./);
      if (!match || audience !== this.clientId) throw new Error('invalid token');
      const claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      record({ provider: 'google', email: claims.email });
      return { getPayload: () => claims };
    }
  }
  Module._load = function patchedLoad(request, ...rest) {
    if (request === 'google-auth-library') return { OAuth2Client: FakeOAuth2Client };
    return originalLoad.call(this, request, ...rest);
  };
}
