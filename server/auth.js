// Login, Passwörter (scrypt) und Sessions (Cookie)
import crypto from 'node:crypto';
import { one, run } from './db.js';

const COOKIE = 'jf_sid';
const MAX_AGE_DAYS = 30;

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = crypto.scryptSync(pw, salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function loadUser(id) {
  return one('SELECT id, username, display_name, role, group_id FROM users WHERE id = ?', id) || null;
}

export function userFromCookieHeader(header) {
  const token = parseCookies(header)[COOKIE];
  if (!token) return null;
  const s = one('SELECT user_id, created_at FROM sessions WHERE token = ?', token);
  if (!s || Date.now() - s.created_at > MAX_AGE_DAYS * 864e5) return null;
  return loadUser(s.user_id);
}

export function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', token, userId, Date.now());
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: MAX_AGE_DAYS * 864e5, path: '/',
  });
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
  res.clearCookie(COOKIE, { path: '/' });
}

export function authMiddleware(req, _res, next) {
  req.user = userFromCookieHeader(req.headers.cookie);
  next();
}

export function requireUser(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Bitte zuerst einloggen');
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) throw new HttpError(401, 'Bitte zuerst einloggen');
  if (req.user.role !== 'admin') throw new HttpError(403, 'Nur für Admins');
  next();
}

// Admin-Konto beim Start anlegen bzw. Passwort aus den Umgebungsvariablen übernehmen
export function ensureAdmin() {
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const envPw = process.env.ADMIN_PASSWORD;
  const existing = one('SELECT id, password_hash FROM users WHERE username = ?', username);
  if (existing) {
    run("UPDATE users SET role = 'admin', verified = 1 WHERE id = ?", existing.id);
    // Passwort geändert? Dann alle bisherigen Admin-Geräte ausloggen.
    if (envPw && !verifyPassword(envPw, existing.password_hash)) {
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(envPw), existing.id);
      run('DELETE FROM sessions WHERE user_id = ?', existing.id);
    }
    return;
  }
  const pw = envPw || crypto.randomBytes(6).toString('base64url');
  run(`INSERT INTO users (username, display_name, password_hash, role, verified, created_at)
       VALUES (?, 'Admin', ?, 'admin', 1, ?)`, username, hashPassword(pw), Date.now());
  if (!envPw) console.log(`\n  ➜ Admin-Login erstellt:  Benutzer "${username}"  Passwort "${pw}"\n    (Setze ADMIN_PASSWORD, um ein eigenes Passwort zu verwenden.)\n`);
}

// Einmal-Links für Mails (Bestätigung, Passwort zurücksetzen). In der DB liegt nur der Hash.
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export function createToken(userId, purpose, ttlMs) {
  const token = crypto.randomBytes(32).toString('base64url');
  run('DELETE FROM tokens WHERE user_id = ? AND purpose = ?', userId, purpose);
  run('INSERT INTO tokens (hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)', sha(token), userId, purpose, Date.now() + ttlMs);
  return token;
}
export function consumeToken(token, purpose) {
  const row = one('SELECT user_id, expires_at FROM tokens WHERE hash = ? AND purpose = ?', sha(token), purpose);
  if (!row) return null;
  run('DELETE FROM tokens WHERE hash = ?', sha(token));
  return row.expires_at > Date.now() ? row.user_id : null;
}

// Bremse gegen Passwort-Raten und Mail-Spam.
// Wichtig fürs Camp: Alle hängen im selben WLAN (gleiche IP) – darum pro E-Mail zählen
// und pro IP nur sehr grosszügig begrenzen.
const buckets = new Map();
export function limit(key, max, windowMs, message = 'Zu viele Versuche – warte kurz und versuche es nochmals.') {
  const now = Date.now();
  const list = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, message);
  list.push(now);
  buckets.set(key, list);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of buckets) if (!list.some((t) => now - t < 3_600_000)) buckets.delete(k);
}, 600_000).unref?.(); // unref nur in Node (im Browser-Demo gibt es das nicht)
