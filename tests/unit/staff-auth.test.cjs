'use strict';
// Unit tests for the staff two-factor helpers (staff-auth.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.STAFF_MFA_KEY = process.env.STAFF_MFA_KEY || 'unit-test-mfa-key-' + 'k'.repeat(30);
const auth = require(path.resolve(__dirname, '..', '..', 'staff-auth.js'));

// RFC 6238 Appendix B secret "12345678901234567890" in base32.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('UNIT-001 TOTP matches the RFC 6238 SHA-1 test vectors', () => {
  const vectors = [[59, '287082'], [1111111109, '081804'], [1111111111, '050471'], [1234567890, '005924'], [2000000000, '279037']];
  for (const [seconds, code] of vectors) assert.equal(auth.totpCode(RFC_SECRET, seconds * 1000), code, `t=${seconds}`);
});

test('UNIT-002 TOTP accepts one step of clock drift and rejects older codes', () => {
  const now = 1_800_000_000_000;
  const previous = auth.totpCode(RFC_SECRET, now - 30_000);
  const twoBack = auth.totpCode(RFC_SECRET, now - 60_000);
  assert.notEqual(auth.verifyTotp(RFC_SECRET, previous, null, now), null);
  assert.equal(auth.verifyTotp(RFC_SECRET, twoBack, null, now), null);
});

test('UNIT-003 TOTP refuses a replayed time step', () => {
  const now = 1_800_000_000_000;
  const code = auth.totpCode(RFC_SECRET, now);
  const step = auth.verifyTotp(RFC_SECRET, code, null, now);
  assert.notEqual(step, null);
  assert.equal(auth.verifyTotp(RFC_SECRET, code, step, now), null, 'same step must not be accepted twice');
});

test('UNIT-004 TOTP rejects malformed input', () => {
  for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 5x']) assert.equal(auth.verifyTotp(RFC_SECRET, bad), null, String(bad));
});

test('UNIT-005 Generated secrets are 160-bit base32 and unique', () => {
  const a = auth.newSecret(), b = auth.newSecret();
  assert.match(a, /^[A-Z2-7]{32}$/);
  assert.notEqual(a, b);
});

test('UNIT-006 Sealed authenticator secrets round-trip and are not stored in clear text', () => {
  const secret = auth.newSecret();
  const sealed = auth.sealSecret(secret);
  assert.ok(!JSON.stringify(sealed).includes(secret), 'sealed value must not contain the secret');
  assert.equal(auth.openSecret(sealed), secret);
});

test('UNIT-007 Recovery codes are hashed and each works only once', () => {
  const { codes, hashes } = auth.newRecoveryCodes();
  assert.ok(codes.length >= 8);
  assert.ok(!JSON.stringify(hashes).includes(codes[0]), 'hashes must not contain the code');
  const record = { recoveryCodes: hashes };
  assert.equal(auth.consumeRecoveryCode(record, codes[0]), true);
  assert.equal(auth.consumeRecoveryCode(record, codes[0]), false, 'second use must fail');
  assert.equal(auth.consumeRecoveryCode(record, 'not-a-code'), false);
});

test('UNIT-008 Sign-in challenges expire after use', () => {
  const id = auth.createChallenge('owner');
  assert.ok(auth.readChallenge(id));
  auth.dropChallenge(id);
  assert.equal(auth.readChallenge(id), null);
  assert.equal(auth.readChallenge('made-up-challenge'), null);
});
