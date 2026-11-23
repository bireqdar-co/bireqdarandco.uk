// Staff (owner / worker) two-factor authentication helpers.
// TOTP follows RFC 6238 (SHA-1, 30-second steps, 6 digits), which every common
// authenticator app supports (Google Authenticator, Microsoft Authenticator,
// 1Password, Authy, Apple Passwords). No third-party packages are used.
const crypto = require('node:crypto');

const ISSUER = 'BIREQDAR&CO.';
const STEP_MS = 30 * 1000;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(text) {
  const clean = String(text || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0; const out = [];
  for (const char of clean) {
    value = (value << 5) | B32.indexOf(char); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function safeEqualText(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function hotp(secretBase32, counter) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}
function currentStep(now = Date.now()) { return Math.floor(now / STEP_MS); }
function totpCode(secretBase32, now = Date.now()) { return hotp(secretBase32, currentStep(now)); }

// Returns the matched time step, or null. Accepts one step of clock drift and
// refuses any step at or before lastStep so a code cannot be replayed.
function verifyTotp(secretBase32, code, lastStep = null, now = Date.now()) {
  const digits = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const step = currentStep(now);
  for (const drift of [-1, 0, 1]) {
    const candidate = step + drift;
    if (lastStep !== null && lastStep !== undefined && candidate <= lastStep) continue;
    if (safeEqualText(hotp(secretBase32, candidate), digits)) return candidate;
  }
  return null;
}
function newSecret() { return base32Encode(crypto.randomBytes(20)); }
function otpauthUrl(account, secret) {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(ISSUER)}&algorithm=SHA1&digits=6&period=30`;
}

// Optional encryption at rest: set STAFF_MFA_KEY (any long random string) and
// authenticator secrets are stored with AES-256-GCM instead of plain base32.
function encryptionKey() {
  const raw = process.env.STAFF_MFA_KEY || '';
  return raw.length >= 16 ? crypto.createHash('sha256').update(raw).digest() : null;
}
function sealSecret(secret) {
  const key = encryptionKey();
  if (!key) return `plain:${secret}`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${body.toString('base64')}`;
}
function openSecret(stored) {
  const text = String(stored || '');
  if (text.startsWith('plain:')) return text.slice(6);
  if (!text.startsWith('v1:')) return '';
  const key = encryptionKey();
  if (!key) throw new Error('STAFF_MFA_KEY is required to read encrypted authenticator secrets.');
  const [iv, tag, body] = text.slice(3).split('.').map(part => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}

// One-time recovery codes (shown once, stored only as SHA-256 hashes).
const hashCode = code => crypto.createHash('sha256').update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
function newRecoveryCodes(count = 8) {
  const codes = Array.from({ length: count }, () => {
    const raw = base32Encode(crypto.randomBytes(7)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
  return { codes, hashes: codes.map(hashCode) };
}
function consumeRecoveryCode(record, code) {
  const digits = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (digits.length !== 10 || !Array.isArray(record.recoveryCodes)) return false;
  const hash = hashCode(digits);
  const index = record.recoveryCodes.findIndex(stored => safeEqualText(stored, hash));
  if (index < 0) return false;
  record.recoveryCodes.splice(index, 1);
  return true;
}

// Short-lived sign-in challenges kept in memory between the password step and
// the code step. They expire after five minutes and allow five code attempts.
const challenges = new Map();
function createChallenge(principalId, extra = {}) {
  for (const [key, value] of challenges) if (value.expiresAt <= Date.now()) challenges.delete(key);
  const id = crypto.randomBytes(24).toString('base64url');
  challenges.set(id, { principalId, expiresAt: Date.now() + 5 * 60 * 1000, attempts: 0, ...extra });
  return id;
}
function readChallenge(id) {
  const challenge = challenges.get(String(id || ''));
  if (!challenge) return null;
  if (challenge.expiresAt <= Date.now()) { challenges.delete(id); return null; }
  return challenge;
}
function dropChallenge(id) { challenges.delete(String(id || '')); }

module.exports = {
  totpCode, verifyTotp, newSecret, otpauthUrl, sealSecret, openSecret,
  newRecoveryCodes, consumeRecoveryCode, createChallenge, readChallenge, dropChallenge,
  hasEncryptionKey: () => !!encryptionKey(),
};
