// Hosted (Vercel) admin config comes from environment variables:
//   ADMIN_USER      (optional, default "admin")
//   ADMIN_PASSWORD  (required)   – change it in Vercel to change the password / sign everyone out
//   SESSION_SECRET  (optional)   – extra secret for signing sessions
const A = require('../lib/auth');

const user = () => process.env.ADMIN_USER || 'admin';
const password = () => process.env.ADMIN_PASSWORD || process.env.APP_PASSWORD || '';
const secret = () => (process.env.SESSION_SECRET || '') + '|' + password();
const fp = () => A.fingerprint(password());
const ip = req => String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();

function authorized(req) {
  if (!password()) return false;                                    // never run unprotected
  const t = String(req.headers['authorization'] || '').replace(/^Bearer /, '') || String(req.headers['x-token'] || '');
  return !!A.verify(secret(), t, fp());
}

async function login(req) {
  const { username, password: pw } = req.body || {};
  if (!password()) return { code: 503, body: { error: 'Server not configured: set ADMIN_PASSWORD.' } };
  const who = ip(req);
  if (A.limiter.blocked(who)) return { code: 429, body: { error: 'Too many attempts. Try again in 15 minutes.' } };
  const ok = A.safeEqual(String(username || '').trim().toLowerCase(), user().toLowerCase()) & A.safeEqual(pw || '', password());
  if (!ok) { A.limiter.fail(who); await A.sleep(600); return { code: 401, body: { error: 'Wrong username or password.' } }; }
  A.limiter.ok(who);
  return { code: 200, body: { token: A.sign(secret(), user(), fp()), user: user() } };
}

module.exports = { authorized, login, configured: () => !!password() };
