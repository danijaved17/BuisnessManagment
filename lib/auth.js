// Admin authentication shared by the local server and the Vercel functions.
// Passwords: scrypt hashes. Sessions: HMAC-signed tokens with an expiry (stateless).
const crypto = require('node:crypto');

const TTL = 30 * 24 * 3600 * 1000;           // sessions last 30 days
const sha = s => crypto.createHash('sha256').update(String(s)).digest();

function safeEqual(a, b) {
  return crypto.timingSafeEqual(sha(a), sha(b));
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}

function checkPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(key, want);
}

// Short fingerprint of the credential: changing the password invalidates every old session.
const fingerprint = credential => sha('fp|' + credential).toString('hex').slice(0, 12);

function sign(secret, user, fp) {
  const body = Buffer.from(JSON.stringify({ u: user, v: fp, exp: Date.now() + TTL })).toString('base64url');
  return body + '.' + crypto.createHmac('sha256', secret).update(body).digest('base64url');
}

function verify(secret, token, fp) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() && p.v === fp ? p : null;
  } catch { return null; }
}

// Brute-force guard: 8 failed sign-ins per 15 minutes per address.
const fails = new Map();
const limiter = {
  blocked(ip) {
    const f = fails.get(ip);
    return !!f && f.n >= 8 && Date.now() - f.t < 15 * 60 * 1000;
  },
  fail(ip) {
    const f = fails.get(ip);
    fails.set(ip, f && Date.now() - f.t < 15 * 60 * 1000 ? { n: f.n + 1, t: f.t } : { n: 1, t: Date.now() });
  },
  ok(ip) { fails.delete(ip); }
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

module.exports = { safeEqual, hashPassword, checkPassword, fingerprint, sign, verify, limiter, sleep };
