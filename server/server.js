// Business Manager server: static files + a tiny sync API over SQLite.
// Zero dependencies — needs Node 22.13+ (uses the built-in node:sqlite).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';          // set HOST=0.0.0.0 to reach it from your phone/LAN
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PUBLIC = path.join(__dirname, '..', 'public');
const A = require('../lib/auth');
const COLS = new Set(['businesses', 'shops', 'rentPayments', 'roznamcha']);

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- Admin account: ADMIN_PASSWORD env var, or created on first run from this computer ----
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, require('node:crypto').randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8');
const loadAdmin = () => {
  if (process.env.ADMIN_PASSWORD) return { username: process.env.ADMIN_USER || 'admin', env: true, pw: process.env.ADMIN_PASSWORD };
  try { return JSON.parse(fs.readFileSync(ADMIN_FILE, 'utf8')); } catch { return null; }
};
const adminFp = a => A.fingerprint(a.env ? a.pw : a.hash);
const adminOk = (a, pw) => a.env ? A.safeEqual(pw, a.pw) : A.checkPassword(pw, a.hash);
const isLoopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const authorized = req => {
  const a = loadAdmin();
  if (!a) return false;
  const t = String(req.headers['authorization'] || '').replace(/^Bearer /, '') || String(req.headers['x-token'] || '');
  return !!A.verify(SECRET, t, adminFp(a));
};
const db = new DatabaseSync(path.join(DATA_DIR, 'bizmanager.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS records (
    id         TEXT PRIMARY KEY,
    col        TEXT NOT NULL,
    data       TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    seq        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
`);

const getOne = db.prepare('SELECT updated_at FROM records WHERE id = ?');
const nextSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM records');
const upsert = db.prepare(`
  INSERT INTO records (id, col, data, updated_at, deleted, seq) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET col = excluded.col, data = excluded.data,
    updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq`);
const since = db.prepare('SELECT id, col, data, updated_at, deleted, seq FROM records WHERE seq > ? ORDER BY seq LIMIT 5000');
const maxSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS n FROM records');

// Last-write-wins per record.
function applyChanges(records) {
  let applied = 0;
  db.exec('BEGIN');
  try {
    for (const r of records) {
      if (!r || typeof r.id !== 'string' || !COLS.has(r.col) || !Number.isFinite(r.updatedAt)) continue;
      const cur = getOne.get(r.id);
      if (cur && cur.updated_at >= r.updatedAt) continue;
      upsert.run(r.id, r.col, JSON.stringify(r.data ?? {}), r.updatedAt, r.deleted ? 1 : 0, nextSeq.get().n);
      applied++;
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return applied;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png'
};

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);

    if (url.pathname === '/api/health') return send(res, 200, { ok: true });
    if (url.pathname === '/api/auth-status') {
      return send(res, 200, { required: true, setupNeeded: !loadAdmin(), canSetup: isLoopback(req) });
    }
    if (url.pathname === '/api/setup' && req.method === 'POST') {
      if (loadAdmin()) return send(res, 409, { error: 'An admin account already exists.' });
      if (!isLoopback(req)) return send(res, 403, { error: 'First-time setup must be done on the computer running the server.' });
      const b = JSON.parse(await readBody(req, 10000));
      const username = String(b.username || '').trim();
      if (!username || String(b.password || '').length < 8) return send(res, 400, { error: 'Choose a username and a password of at least 8 characters.' });
      const admin = { username, hash: A.hashPassword(b.password) };
      fs.writeFileSync(ADMIN_FILE, JSON.stringify(admin), { mode: 0o600 });
      return send(res, 200, { token: A.sign(SECRET, username, adminFp(admin)), user: username });
    }
    if (url.pathname === '/api/login' && req.method === 'POST') {
      const a = loadAdmin();
      if (!a) return send(res, 409, { error: 'No admin account yet. Open the app on the server computer to create one.' });
      const ip = req.socket.remoteAddress;
      if (A.limiter.blocked(ip)) return send(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });
      const b = JSON.parse(await readBody(req, 10000));
      const ok = A.safeEqual(String(b.username || '').trim().toLowerCase(), a.username.toLowerCase()) & adminOk(a, String(b.password || ''));
      if (!ok) { A.limiter.fail(ip); await A.sleep(600); return send(res, 401, { error: 'Wrong username or password.' }); }
      A.limiter.ok(ip);
      return send(res, 200, { token: A.sign(SECRET, a.username, adminFp(a)), user: a.username });
    }
    if (!authorized(req)) return send(res, 401, { error: 'unauthorized' });

    if (url.pathname === '/api/sync' && req.method === 'GET') {
      const rows = since.all(Number(url.searchParams.get('since')) || 0);
      const cursor = rows.length ? rows[rows.length - 1].seq : (Number(url.searchParams.get('since')) || maxSeq.get().n);
      return send(res, 200, {
        cursor,
        records: rows.map(r => ({ id: r.id, col: r.col, data: JSON.parse(r.data), updatedAt: r.updated_at, deleted: r.deleted }))
      });
    }
    if (url.pathname === '/api/sync' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      return send(res, 200, { applied: applyChanges(Array.isArray(body.records) ? body.records : []) });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Business Manager running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Database: ${path.join(DATA_DIR, 'bizmanager.db')}${loadAdmin() ? '' : '  — open the app to create the admin account'}`);
});
