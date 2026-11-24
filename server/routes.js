// REST-API für Login, Smallgroups, Challenges, Galerie, Punkte und Admin-Funktionen
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { one, all, run, tx, UPLOAD_DIR, getSetting, setSetting } from './db.js';
import {
  HttpError, hashPassword, verifyPassword, createSession, destroySession,
  requireUser, requireAdmin, createToken, consumeToken, limit,
} from './auth.js';
import { verifyMail, resetMail, mailConfigured } from './mail.js';
import { DEFAULT_CATEGORIES, DEFAULT_LETTERS } from './game.js';
import { initPush, pushPublicKey, allowedEndpoint, sendPush } from './push.js';

const bad = (m) => new HttpError(400, m);
const now = () => Date.now();
const MIN = 60_000;
const VERIFY_TTL = 7 * 24 * 60 * MIN;
const RESET_TTL = 2 * 60 * MIN;
const verificationOn = () => process.env.EMAIL_VERIFICATION !== 'off';

function text(v, { name, min = 1, max = 200 }) {
  const s = String(v ?? '').trim();
  if (s.length < min) throw bad(min <= 1 ? `${name} fehlt` : `${name}: mindestens ${min} Zeichen`);
  if (s.length > max) throw bad(`${name}: höchstens ${max} Zeichen`);
  return s;
}
const int = (v, def = 0) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);
function email(v) {
  const e = String(v ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) || e.length > 120) throw bad('Bitte eine gültige E-Mail-Adresse angeben');
  return e;
}
function password(v) {
  const pw = String(v || '');
  if (pw.length < 8) throw bad('Passwort: mindestens 8 Zeichen');
  if (pw.length > 200) throw bad('Passwort ist zu lang');
  return pw;
}
const appUrl = (req) => (process.env.APP_URL || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : `${req.protocol}://${req.get('host')}`)).replace(/\/$/, '');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newJoinCode() {
  for (;;) {
    const code = Array.from(crypto.randomBytes(5), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    if (!one('SELECT 1 FROM groups WHERE join_code = ?', code)) return code;
  }
}
function createGroup(name, createdBy = null) {
  const n = text(name, { name: 'Smallgroup-Name', min: 2, max: 40 });
  if (one('SELECT 1 FROM groups WHERE name = ?', n)) throw bad('Diesen Smallgroup-Namen gibt es schon – frag deine Smallgroup nach dem Einladungslink');
  return run('INSERT INTO groups (name, join_code, created_by, created_at) VALUES (?, ?, ?, ?)', n, newJoinCode(), createdBy, now()).id;
}
function groupByCode(code) {
  const g = one('SELECT id FROM groups WHERE join_code = ?', String(code || '').trim().toUpperCase());
  if (!g) throw new HttpError(404, 'Diesen Smallgroup-Code gibt es nicht');
  return g.id;
}
function resolveGroup({ groupMode, groupName, groupCode }, userId = null) {
  if (groupMode === 'create') return createGroup(groupName, userId);
  if (groupMode === 'join') return groupByCode(groupCode);
  throw bad('Bitte eine Smallgroup erstellen oder beitreten');
}

// ---------- Uploads ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic' }[file.mimetype] || '.img';
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 20 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});
const removeFile = (f) => f && fs.rm(path.join(UPLOAD_DIR, path.basename(f)), { force: true }, () => {});
const uploadedFiles = (req) => [
  ...(Array.isArray(req.files) ? req.files : Object.values(req.files || {}).flat()),
  ...(req.file ? [req.file] : []),
];
const cleanupUploads = (req) => uploadedFiles(req).forEach((f) => removeFile(f.filename));

// ---------- Abfragen ----------
function meData(u) {
  const group = u.group_id ? one('SELECT id, name, join_code AS code, created_by FROM groups WHERE id = ?', u.group_id) : null;
  if (group) {
    group.members = all('SELECT id, display_name AS name FROM users WHERE group_id = ? ORDER BY display_name', group.id);
    group.isCreator = group.created_by === u.id;
    delete group.created_by;
  }
  return { user: { id: u.id, email: u.username, name: u.display_name, role: u.role }, group };
}

function leaderboard() {
  return all(`SELECT g.id, g.name,
      COALESCE(SUM(p.amount), 0) AS total,
      COALESCE(SUM(CASE WHEN p.source = 'challenge' THEN p.amount END), 0) AS challenge,
      COALESCE(SUM(CASE WHEN p.source = 'game' THEN p.amount END), 0) AS game,
      COALESCE(SUM(CASE WHEN p.source = 'bonus' THEN p.amount END), 0) AS bonus,
      (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) AS members
    FROM groups g LEFT JOIN points p ON p.group_id = g.id
    GROUP BY g.id ORDER BY total DESC, g.name COLLATE NOCASE`);
}

const PHOTO_COLS = `p.id, '/uploads/' || p.file AS url, '/uploads/' || COALESCE(p.thumb, p.file) AS thumb, u.display_name AS by`;
const photosOf = (submissionId) => all(`SELECT ${PHOTO_COLS}
  FROM photos p LEFT JOIN users u ON u.id = p.user_id WHERE p.submission_id = ? ORDER BY p.id`, submissionId);

function submissionsFor(where, ...params) {
  const subs = all(`SELECT s.id, s.challenge_id AS challengeId, c.title AS challengeTitle, c.points AS maxPoints,
      s.group_id AS groupId, g.name AS groupName, s.comment, s.points, s.updated_at AS updatedAt
    FROM submissions s JOIN groups g ON g.id = s.group_id JOIN challenges c ON c.id = s.challenge_id
    WHERE ${where} AND EXISTS (SELECT 1 FROM photos p WHERE p.submission_id = s.id)
    ORDER BY (s.points IS NOT NULL), s.updated_at DESC`, ...params);
  for (const s of subs) s.photos = photosOf(s.id);
  return subs;
}

function parseDeadline(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) throw bad('Ungültige Deadline');
  return t;
}

async function sendVerification(req, user) {
  const token = createToken(user.id, 'verify', VERIFY_TTL);
  await verifyMail(user.username, user.display_name, `${appUrl(req)}/bestaetigen/${token}`);
}

// Zeit für Push-Texte, in Schweizer Zeit
const fmtEvent = (ts) => new Date(ts).toLocaleString('de-CH', { timeZone: 'Europe/Zurich', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function apiRouter({ io, game }) {
  const r = express.Router();
  const refresh = (topic) => io.emit('refresh', topic);
  initPush();

  // Ankündigung speichern, live an alle in der App melden und optional als Push verschicken
  async function announce({ title, body = '', kind = 'info', eventAt = null, location = '', link = null, push = false, userId }) {
    const id = run(`INSERT INTO announcements (title, body, kind, event_at, location, link, pushed, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, title, body, kind, eventAt, location, link, push ? 1 : 0, userId, now()).id;
    refresh('announcements');
    io.emit('announcement:new', { id, title, kind, userId });
    let pushResult = null;
    if (push) {
      const icon = kind === 'event' ? '⚡ ' : kind === 'challenge' ? '📸 ' : '📢 ';
      const details = [eventAt ? `🕒 ${fmtEvent(eventAt)}` : '', location ? `📍 ${location}` : ''].filter(Boolean).join('  ');
      pushResult = await sendPush({
        title: icon + title,
        body: [details, body].filter(Boolean).join('\n').slice(0, 200),
        url: link || '#/',
        tag: `ann-${id}`,
      }, { excludeUserId: userId });
    }
    return { id, push: pushResult };
  }
  const moveSocketsToGroup = (userId, oldGroup, newGroup) => {
    if (oldGroup) io.in(`user:${userId}`).socketsLeave(`group:${oldGroup}`);
    if (newGroup) io.in(`user:${userId}`).socketsJoin(`group:${newGroup}`);
  };

  // ---------- Öffentlich ----------
  r.get('/config', (req, res) => {
    res.json({
      registrationCode: !!process.env.REGISTRATION_CODE,
      emailVerification: verificationOn(),
      leaderboardHidden: getSetting('leaderboardHidden', false),
      defaults: { categories: DEFAULT_CATEGORIES, letters: DEFAULT_LETTERS },
    });
  });

  // Einladungslink: Name der Smallgroup anzeigen
  r.get('/invite/:code', (req, res) => {
    limit(`invite:${req.ip}`, 300, 10 * MIN);
    const g = one('SELECT name FROM groups WHERE join_code = ?', String(req.params.code || '').trim().toUpperCase());
    if (!g) throw new HttpError(404, 'Dieser Einladungslink ist ungültig');
    res.json({ name: g.name });
  });

  r.post('/register', async (req, res) => {
    limit(`register:${req.ip}`, 300, 10 * MIN);
    const b = req.body || {};
    const code = process.env.REGISTRATION_CODE;
    if (code && String(b.regCode || '').trim().toLowerCase() !== code.trim().toLowerCase()) {
      throw new HttpError(403, 'Der Camp-Code stimmt nicht');
    }
    const name = text(b.displayName, { name: 'Name', min: 2, max: 40 });
    const mail = email(b.email);
    const pw = password(b.password);
    const existing = one('SELECT verified FROM users WHERE username = ?', mail);
    if (existing) {
      throw Object.assign(new HttpError(409, existing.verified
        ? 'Mit dieser E-Mail gibt es schon ein Konto – logge dich ein oder setze dein Passwort zurück.'
        : 'Mit dieser E-Mail gibt es schon ein Konto, das noch nicht bestätigt ist.'), { code: existing.verified ? 'exists' : 'unverified' });
    }
    const verified = verificationOn() ? 0 : 1;
    const userId = tx(() => {
      const id = run(`INSERT INTO users (username, display_name, password_hash, verified, created_at) VALUES (?, ?, ?, ?, ?)`,
        mail, name, hashPassword(pw), verified, now()).id;
      run('UPDATE users SET group_id = ? WHERE id = ?', resolveGroup(b, id), id);
      return id;
    });
    refresh('groups');
    if (verified) {
      createSession(req, res, userId);
      return res.json({ ok: true, verify: false });
    }
    let mailError = false;
    try {
      await sendVerification(req, one('SELECT id, username, display_name FROM users WHERE id = ?', userId));
    } catch (e) {
      console.error('Mailversand fehlgeschlagen:', e.message);
      mailError = true;
    }
    res.json({ ok: true, verify: true, email: mail, mailError });
  });

  r.post('/login', (req, res) => {
    const login = String(req.body?.email || '').trim().toLowerCase();
    limit(`login-ip:${req.ip}`, 600, MIN);
    limit(`login:${login}`, 10, 10 * MIN, 'Zu viele Versuche für dieses Konto – warte 10 Minuten oder setze dein Passwort zurück.');
    const u = one('SELECT id, password_hash, verified FROM users WHERE username = ?', login);
    if (!u || !verifyPassword(String(req.body?.password || ''), u.password_hash)) throw new HttpError(401, 'E-Mail oder Passwort falsch');
    if (!u.verified) {
      throw Object.assign(new HttpError(403, 'Bitte bestätige zuerst deine E-Mail-Adresse (Link in der Mail).'), { code: 'unverified' });
    }
    createSession(req, res, u.id);
    res.json({ ok: true });
  });

  r.post('/resend', async (req, res) => {
    const mail = email(req.body?.email);
    limit(`mail-ip:${req.ip}`, 200, 10 * MIN);
    limit(`mail:${mail}`, 3, 15 * MIN, 'Wir haben dir gerade schon Mails geschickt – schau auch im Spam-Ordner nach und versuche es in 15 Minuten nochmals.');
    const u = one('SELECT id, username, display_name, verified FROM users WHERE username = ?', mail);
    if (u && !u.verified) await sendVerification(req, u);
    res.json({ ok: true }); // absichtlich gleiche Antwort, egal ob das Konto existiert
  });

  r.post('/verify', (req, res) => {
    limit(`token:${req.ip}`, 200, 10 * MIN);
    const userId = consumeToken(String(req.body?.token || ''), 'verify');
    if (!userId) throw bad('Dieser Bestätigungslink ist ungültig oder abgelaufen. Logge dich ein, um einen neuen zu bekommen.');
    run('UPDATE users SET verified = 1 WHERE id = ?', userId);
    createSession(req, res, userId);
    refresh('groups');
    res.json({ ok: true });
  });

  r.post('/forgot', async (req, res) => {
    const mail = email(req.body?.email);
    limit(`mail-ip:${req.ip}`, 200, 10 * MIN);
    limit(`mail:${mail}`, 3, 15 * MIN, 'Wir haben dir gerade schon Mails geschickt – schau auch im Spam-Ordner nach und versuche es in 15 Minuten nochmals.');
    const u = one("SELECT id, username, display_name FROM users WHERE username = ? AND role = 'user'", mail);
    if (u) {
      const token = createToken(u.id, 'reset', RESET_TTL);
      await resetMail(u.username, u.display_name, `${appUrl(req)}/passwort-neu/${token}`);
    }
    res.json({ ok: true });
  });

  r.post('/reset', (req, res) => {
    limit(`token:${req.ip}`, 200, 10 * MIN);
    const pw = password(req.body?.password);
    const userId = consumeToken(String(req.body?.token || ''), 'reset');
    if (!userId) throw bad('Dieser Link ist ungültig oder abgelaufen. Fordere einfach einen neuen an.');
    run('UPDATE users SET password_hash = ?, verified = 1 WHERE id = ?', hashPassword(pw), userId);
    run('DELETE FROM sessions WHERE user_id = ?', userId);
    createSession(req, res, userId);
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    destroySession(req, res);
    res.json({ ok: true });
  });

  // ---------- Eingeloggt ----------
  r.get('/me', (req, res) => res.json(req.user ? meData(req.user) : { user: null }));

  r.post('/me/group', requireUser, (req, res) => {
    if (req.user.role === 'admin') throw bad('Admins sind in keiner Smallgroup');
    const old = req.user.group_id;
    const groupId = tx(() => resolveGroup(req.body || {}, req.user.id));
    run('UPDATE users SET group_id = ? WHERE id = ?', groupId, req.user.id);
    moveSocketsToGroup(req.user.id, old, groupId);
    refresh('groups');
    game.broadcast();
    res.json({ ok: true });
  });

  r.get('/leaderboard', requireUser, (req, res) => {
    const hidden = getSetting('leaderboardHidden', false);
    if (hidden && req.user.role !== 'admin') return res.json({ hidden: true, groups: [] });
    res.json({ hidden, groups: leaderboard() });
  });

  r.get('/groups/:id/points', requireUser, (req, res) => {
    const id = int(req.params.id);
    if (req.user.role !== 'admin' && req.user.group_id !== id) throw new HttpError(403, 'Nur für die eigene Smallgroup');
    res.json(all('SELECT id, amount, reason, source, created_at AS createdAt FROM points WHERE group_id = ? ORDER BY id DESC', id));
  });

  r.get('/challenges', requireUser, (req, res) => {
    const admin = req.user.role === 'admin';
    res.json(all(`SELECT c.id, c.title, c.description, c.points, c.deadline, c.published,
        CASE WHEN c.image IS NULL THEN NULL ELSE '/uploads/' || c.image END AS image,
        CASE WHEN c.image IS NULL THEN NULL ELSE '/uploads/' || COALESCE(c.thumb, c.image) END AS thumb,
        s.points AS myPoints,
        (SELECT COUNT(*) FROM photos p WHERE p.submission_id = s.id) AS myPhotos,
        (SELECT COUNT(*) FROM submissions s2 WHERE s2.challenge_id = c.id AND s2.points IS NULL
           AND EXISTS (SELECT 1 FROM photos p2 WHERE p2.submission_id = s2.id)) AS pending,
        (SELECT COUNT(*) FROM submissions s3 WHERE s3.challenge_id = c.id
           AND EXISTS (SELECT 1 FROM photos p3 WHERE p3.submission_id = s3.id)) AS submitted
      FROM challenges c LEFT JOIN submissions s ON s.challenge_id = c.id AND s.group_id = ?
      ${admin ? '' : 'WHERE c.published = 1'}
      ORDER BY c.created_at DESC`, req.user.group_id ?? -1));
  });

  r.get('/challenges/:id', requireUser, (req, res) => {
    const admin = req.user.role === 'admin';
    const c = one(`SELECT id, title, description, points, deadline, published,
        CASE WHEN image IS NULL THEN NULL ELSE '/uploads/' || image END AS image
      FROM challenges WHERE id = ? ${admin ? '' : 'AND published = 1'}`, int(req.params.id));
    if (!c) throw new HttpError(404, 'Challenge nicht gefunden');
    const mine = req.user.group_id
      ? one('SELECT id, comment, points FROM submissions WHERE challenge_id = ? AND group_id = ?', c.id, req.user.group_id)
      : null;
    if (mine) mine.photos = photosOf(mine.id);
    res.json({ challenge: c, mine, all: admin ? submissionsFor('s.challenge_id = ?', c.id) : undefined });
  });

  r.post('/challenges/:id/photos', requireUser, upload.fields([{ name: 'photos', maxCount: 10 }, { name: 'thumbs', maxCount: 10 }]), (req, res) => {
    const photos = req.files?.photos || [];
    const thumbs = req.files?.thumbs || [];
    try {
      if (!req.user.group_id) throw bad('Du bist in keiner Smallgroup');
      const c = one('SELECT id, deadline FROM challenges WHERE id = ? AND published = 1', int(req.params.id));
      if (!c) throw new HttpError(404, 'Challenge nicht gefunden');
      if (c.deadline && now() > c.deadline) throw bad('Die Deadline für diese Challenge ist vorbei');
      if (!photos.length) throw bad('Bitte mindestens ein Bild auswählen');
      tx(() => {
        run(`INSERT INTO submissions (challenge_id, group_id, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(challenge_id, group_id) DO UPDATE SET updated_at = excluded.updated_at`, c.id, req.user.group_id, now());
        const s = one('SELECT id, points FROM submissions WHERE challenge_id = ? AND group_id = ?', c.id, req.user.group_id);
        if (s.points !== null) throw bad('Eure Einreichung wurde schon bewertet');
        photos.forEach((f, i) => {
          run('INSERT INTO photos (submission_id, user_id, file, thumb, created_at) VALUES (?, ?, ?, ?, ?)',
            s.id, req.user.id, f.filename, thumbs[i]?.filename ?? null, now());
        });
        thumbs.slice(photos.length).forEach((f) => removeFile(f.filename));
        if (typeof req.body?.comment === 'string' && req.body.comment.trim()) {
          run('UPDATE submissions SET comment = ? WHERE id = ?', req.body.comment.trim().slice(0, 500), s.id);
        }
      });
    } catch (e) {
      cleanupUploads(req);
      throw e;
    }
    refresh('submissions');
    refresh('gallery');
    // Live-Hinweis an alle: "Davids Crew hat ein neues Foto hochgeladen"
    const info = one('SELECT g.name AS groupName, c.title AS challengeTitle FROM groups g, challenges c WHERE g.id = ? AND c.id = ?',
      req.user.group_id, int(req.params.id));
    io.emit('photo:new', { ...info, count: photos.length, userId: req.user.id });
    res.json({ ok: true });
  });

  r.put('/challenges/:id/comment', requireUser, (req, res) => {
    const s = one('SELECT id FROM submissions WHERE challenge_id = ? AND group_id = ?', int(req.params.id), req.user.group_id ?? -1);
    if (!s) throw bad('Ladet zuerst ein Bild hoch');
    run('UPDATE submissions SET comment = ?, updated_at = ? WHERE id = ?', String(req.body?.comment || '').trim().slice(0, 500), now(), s.id);
    res.json({ ok: true });
  });

  r.delete('/photos/:id', requireUser, (req, res) => {
    const p = one(`SELECT p.id, p.file, p.thumb, s.group_id, s.points FROM photos p JOIN submissions s ON s.id = p.submission_id WHERE p.id = ?`, int(req.params.id));
    if (!p) throw new HttpError(404, 'Bild nicht gefunden');
    if (req.user.role !== 'admin') {
      if (p.group_id !== req.user.group_id) throw new HttpError(403, 'Nicht eure Einreichung');
      if (p.points !== null) throw bad('Schon bewertet – Bild kann nicht mehr gelöscht werden');
    }
    run('DELETE FROM photos WHERE id = ?', p.id);
    removeFile(p.file);
    removeFile(p.thumb);
    refresh('submissions');
    refresh('gallery');
    res.json({ ok: true });
  });

  // Galerie: alle Fotos, neuste zuerst. Drei Arten (kind):
  //   official = vom ICF-Youth-Team, snapshot = Schnappschuss von Teilnehmenden, photo = Challenge-Foto
  //   ?source=all|official|snapshots|challenges|community (= Schnappschüsse + Challenge-Fotos), ?challenge=ID
  //   ?before=<createdAt>:<kind>:<id> → nächste Seite
  r.get('/gallery', requireUser, (req, res) => {
    const admin = req.user.role === 'admin';
    const challenge = int(req.query.challenge);
    let source = challenge ? 'challenges' : String(req.query.source || 'all');
    if (source === 'groups') source = 'community'; // alter Name
    const wantOfficial = ['all', 'official'].includes(source);
    const wantSnapshots = ['all', 'snapshots', 'community'].includes(source);
    const wantChallenges = ['all', 'challenges', 'community'].includes(source);
    const parts = [];
    const params = [];
    // Spalten überall in derselben Reihenfolge (UNION verbindet nach Position)
    if (wantOfficial || wantSnapshots) {
      const flags = [wantOfficial ? 1 : null, wantSnapshots ? 0 : null].filter((v) => v !== null);
      parts.push(`SELECT CASE WHEN gp.official = 1 THEN 'official' ELSE 'snapshot' END AS kind, gp.id,
          '/uploads/' || gp.file AS url, '/uploads/' || COALESCE(gp.thumb, gp.file) AS thumb,
          CASE WHEN gp.official = 1 THEN 'ICF Youth' ELSE COALESCE(g.name, u.display_name, 'Camp') END AS groupName,
          gp.group_id AS groupId, NULL AS challengeId, gp.caption AS challengeTitle, gp.caption AS caption,
          CASE WHEN gp.official = 1 THEN NULL ELSE u.display_name END AS by, gp.user_id AS userId, gp.created_at AS createdAt
        FROM gallery_photos gp LEFT JOIN groups g ON g.id = gp.group_id LEFT JOIN users u ON u.id = gp.user_id
        WHERE gp.official IN (${flags.join(', ')})`);
    }
    if (wantChallenges) {
      parts.push(`SELECT 'photo' AS kind, p.id, '/uploads/' || p.file AS url, '/uploads/' || COALESCE(p.thumb, p.file) AS thumb,
          g.name AS groupName, g.id AS groupId, c.id AS challengeId, c.title AS challengeTitle, '' AS caption,
          u.display_name AS by, p.user_id AS userId, p.created_at AS createdAt
        FROM photos p JOIN submissions s ON s.id = p.submission_id JOIN groups g ON g.id = s.group_id
        JOIN challenges c ON c.id = s.challenge_id LEFT JOIN users u ON u.id = p.user_id
        WHERE ${admin ? '1 = 1' : 'c.published = 1'}${challenge ? ' AND c.id = ?' : ''}`);
      if (challenge) params.push(challenge);
    }
    if (!parts.length) throw bad('Unbekannte Auswahl');
    let sql = `SELECT kind, id, url, thumb, groupName, groupId, challengeId, challengeTitle, caption, by, userId, createdAt
      FROM (${parts.join(' UNION ALL ')})`;
    const [t, k, i] = String(req.query.before || '').split(':');
    if (t && k && i) {
      sql += ' WHERE createdAt < ? OR (createdAt = ? AND (kind > ? OR (kind = ? AND id < ?)))';
      params.push(int(t), int(t), k, k, int(i));
    }
    const max = Math.min(100, Math.max(1, int(req.query.limit, 60)));
    const photos = all(`${sql} ORDER BY createdAt DESC, kind ASC, id DESC LIMIT ?`, ...params, max);
    const first = !req.query.before;
    res.json({
      photos,
      more: photos.length === max,
      challenges: first ? all(`SELECT c.id, c.title, COUNT(p.id) AS count
        FROM challenges c JOIN submissions s ON s.challenge_id = c.id JOIN photos p ON p.submission_id = s.id
        ${admin ? '' : 'WHERE c.published = 1'} GROUP BY c.id ORDER BY c.created_at DESC`) : undefined,
      officialCount: first ? one('SELECT COUNT(*) AS n FROM gallery_photos WHERE official = 1').n : undefined,
      snapshotCount: first ? one('SELECT COUNT(*) AS n FROM gallery_photos WHERE official = 0').n : undefined,
    });
  });

  // Schnappschüsse: alle können Camp-Fotos teilen (ohne Challenge)
  r.post('/gallery', requireUser, upload.fields([{ name: 'photos', maxCount: 10 }, { name: 'thumbs', maxCount: 10 }]), (req, res) => {
    const photos = req.files?.photos || [];
    const thumbs = req.files?.thumbs || [];
    const official = req.user.role === 'admin' ? 1 : 0;
    let caption = '';
    try {
      limit(`snapshot:${req.user.id}`, 40, 10 * MIN, 'Du hast gerade sehr viele Fotos geteilt – warte kurz und versuch es dann nochmals.');
      if (!photos.length) throw bad('Bitte mindestens ein Bild auswählen');
      caption = String(req.body?.caption || '').trim().slice(0, 120);
      tx(() => photos.forEach((f, i) => {
        run('INSERT INTO gallery_photos (user_id, group_id, official, file, thumb, caption, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          req.user.id, official ? null : req.user.group_id, official, f.filename, thumbs[i]?.filename ?? null, caption, now());
      }));
      thumbs.slice(photos.length).forEach((f) => removeFile(f.filename));
    } catch (e) { cleanupUploads(req); throw e; }
    refresh('gallery');
    const groupName = req.user.group_id ? one('SELECT name FROM groups WHERE id = ?', req.user.group_id)?.name : null;
    io.emit('photo:new', official
      ? { official: true, groupName: 'ICF Youth', caption, count: photos.length, userId: req.user.id }
      : { snapshot: true, groupName: groupName || req.user.display_name, by: req.user.display_name, caption, count: photos.length, userId: req.user.id });
    res.json({ ok: true });
  });

  // Foto ohne Challenge löschen: eigene Schnappschüsse oder als Admin alles
  r.delete('/gallery/:id', requireUser, (req, res) => {
    const p = one('SELECT id, file, thumb, user_id FROM gallery_photos WHERE id = ?', int(req.params.id));
    if (!p) throw new HttpError(404, 'Foto nicht gefunden');
    if (req.user.role !== 'admin' && p.user_id !== req.user.id) throw new HttpError(403, 'Du kannst nur deine eigenen Fotos löschen');
    run('DELETE FROM gallery_photos WHERE id = ?', p.id);
    removeFile(p.file);
    removeFile(p.thumb);
    refresh('gallery');
    res.json({ ok: true });
  });

  // ---------- Ankündigungen ----------
  r.get('/announcements', requireUser, (req, res) => {
    const max = Math.min(50, Math.max(1, int(req.query.limit, 20)));
    res.json({
      items: all(`SELECT id, title, body, kind, event_at AS eventAt, location, link, pushed, created_at AS createdAt
        FROM announcements ORDER BY created_at DESC, id DESC LIMIT ?`, max),
      total: one('SELECT COUNT(*) AS n FROM announcements').n,
    });
  });

  // ---------- Push-Benachrichtigungen ----------
  r.get('/push/key', requireUser, (req, res) => res.json({ publicKey: pushPublicKey() }));
  r.post('/push/subscribe', requireUser, (req, res) => {
    const b = req.body || {};
    const endpoint = String(b.endpoint || '');
    const p256dh = String(b.keys?.p256dh || '');
    const auth = String(b.keys?.auth || '');
    if (!allowedEndpoint(endpoint) || !p256dh || !auth || endpoint.length > 1000 || p256dh.length > 200 || auth.length > 100) {
      throw bad('Dieses Gerät kann keine Push-Benachrichtigungen empfangen');
    }
    run(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
      req.user.id, endpoint, p256dh, auth, now());
    res.json({ ok: true });
  });
  r.post('/push/unsubscribe', requireUser, (req, res) => {
    run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', String(req.body?.endpoint || ''), req.user.id);
    res.json({ ok: true });
  });

  // ---------- Stadt Land Youth ----------
  r.post('/game/join', requireUser, (req, res) => { game.join(req.user); res.json({ ok: true }); });
  r.post('/game/seat', requireUser, (req, res) => { game.takeSeat(req.user); res.json({ ok: true }); });
  r.post('/game/seat/release', requireUser, (req, res) => { game.releaseSeat(req.user); res.json({ ok: true }); });

  // ---------- Admin ----------
  const a = express.Router();
  a.use(requireAdmin);

  // Challenges
  const challengeFields = (b) => ({
    title: text(b.title, { name: 'Titel', max: 80 }),
    description: String(b.description || '').trim().slice(0, 4000),
    points: Math.max(0, Math.min(10000, int(b.points))),
    deadline: parseDeadline(b.deadline),
    published: b.published === '0' || b.published === false ? 0 : 1,
  });
  const coverUpload = upload.fields([{ name: 'image', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]);
  // Neue (sichtbare) Challenge auf Wunsch auf der Startseite ankündigen und/oder per Push melden
  const announceChallenge = (req, id, f) => {
    const wantAnnounce = req.body?.announce === '1';
    const wantPush = req.body?.push === '1';
    if (!f.published || (!wantAnnounce && !wantPush)) return null;
    return announce({
      title: `Neue Challenge: ${f.title}`,
      body: f.description.replace(/\s+/g, ' ').slice(0, 160),
      kind: 'challenge',
      link: `#/challenges/${id}`,
      push: wantPush,
      userId: req.user.id,
    });
  };
  a.post('/challenges', coverUpload, async (req, res) => {
    let id;
    let f;
    try {
      f = challengeFields(req.body || {});
      const img = req.files?.image?.[0]?.filename ?? null;
      const thumb = img ? req.files?.thumb?.[0]?.filename ?? null : null;
      id = run(`INSERT INTO challenges (title, description, points, deadline, published, image, thumb, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, f.title, f.description, f.points, f.deadline, f.published, img, thumb, now()).id;
      refresh('challenges');
    } catch (e) { cleanupUploads(req); throw e; }
    const ann = await announceChallenge(req, id, f);
    res.json({ ok: true, id, push: ann?.push ?? null });
  });
  a.put('/challenges/:id', coverUpload, async (req, res) => {
    try {
      const c = one('SELECT id, image, thumb FROM challenges WHERE id = ?', int(req.params.id));
      if (!c) throw new HttpError(404, 'Challenge nicht gefunden');
      const f = challengeFields(req.body || {});
      let { image, thumb } = c;
      const newImg = req.files?.image?.[0]?.filename;
      if (newImg || req.body?.removeImage === '1') {
        removeFile(c.image);
        removeFile(c.thumb);
        image = newImg ?? null;
        thumb = newImg ? req.files?.thumb?.[0]?.filename ?? null : null;
      }
      run(`UPDATE challenges SET title = ?, description = ?, points = ?, deadline = ?, published = ?, image = ?, thumb = ? WHERE id = ?`,
        f.title, f.description, f.points, f.deadline, f.published, image, thumb, c.id);
      refresh('challenges');
      refresh('gallery');
      const ann = await announceChallenge(req, c.id, f);
      res.json({ ok: true, push: ann?.push ?? null });
    } catch (e) { cleanupUploads(req); throw e; }
  });
  a.delete('/challenges/:id', (req, res) => {
    const c = one('SELECT id, image, thumb FROM challenges WHERE id = ?', int(req.params.id));
    if (!c) throw new HttpError(404, 'Challenge nicht gefunden');
    const files = all('SELECT p.file, p.thumb FROM photos p JOIN submissions s ON s.id = p.submission_id WHERE s.challenge_id = ?', c.id);
    tx(() => {
      run(`DELETE FROM points WHERE ref IN (SELECT 'submission:' || id FROM submissions WHERE challenge_id = ?)`, c.id);
      run('DELETE FROM challenges WHERE id = ?', c.id);
    });
    files.forEach((f) => { removeFile(f.file); removeFile(f.thumb); });
    removeFile(c.image);
    removeFile(c.thumb);
    refresh('challenges');
    refresh('points');
    refresh('gallery');
    res.json({ ok: true });
  });

  // Ankündigungen & Quick-Events
  a.post('/announcements', async (req, res) => {
    const b = req.body || {};
    const kind = b.kind === 'event' ? 'event' : 'info';
    const result = await announce({
      title: text(b.title, { name: 'Titel', max: 100 }),
      body: String(b.body || '').trim().slice(0, 1000),
      kind,
      eventAt: kind === 'event' ? parseDeadline(b.eventAt) : null,
      location: kind === 'event' ? String(b.location || '').trim().slice(0, 80) : '',
      push: b.push === true || b.push === '1',
      userId: req.user.id,
    });
    res.json({ ok: true, ...result });
  });
  a.delete('/announcements/:id', (req, res) => {
    run('DELETE FROM announcements WHERE id = ?', int(req.params.id));
    refresh('announcements');
    res.json({ ok: true });
  });
  a.get('/push/stats', (req, res) => {
    res.json(one('SELECT COUNT(*) AS devices, COUNT(DISTINCT user_id) AS people FROM push_subscriptions'));
  });

  // Fotos vom ICF-Youth-Team (ohne Challenge) – erscheinen in der Galerie und auf der Startseite
  a.post('/gallery', upload.fields([{ name: 'photos', maxCount: 10 }, { name: 'thumbs', maxCount: 10 }]), (req, res) => {
    const photos = req.files?.photos || [];
    const thumbs = req.files?.thumbs || [];
    try {
      if (!photos.length) throw bad('Bitte mindestens ein Bild auswählen');
      const caption = String(req.body?.caption || '').trim().slice(0, 120);
      tx(() => photos.forEach((f, i) => {
        run('INSERT INTO gallery_photos (user_id, file, thumb, caption, created_at) VALUES (?, ?, ?, ?, ?)',
          req.user.id, f.filename, thumbs[i]?.filename ?? null, caption, now());
      }));
      thumbs.slice(photos.length).forEach((f) => removeFile(f.filename));
      refresh('gallery');
      io.emit('photo:new', { official: true, groupName: 'ICF Youth', caption, count: photos.length, userId: req.user.id });
      res.json({ ok: true });
    } catch (e) { cleanupUploads(req); throw e; }
  });
  a.put('/gallery/:id', (req, res) => {
    run('UPDATE gallery_photos SET caption = ? WHERE id = ?', String(req.body?.caption || '').trim().slice(0, 120), int(req.params.id));
    refresh('gallery');
    res.json({ ok: true });
  });
  a.delete('/gallery/:id', (req, res) => {
    const p = one('SELECT id, file, thumb FROM gallery_photos WHERE id = ?', int(req.params.id));
    if (!p) throw new HttpError(404, 'Foto nicht gefunden');
    run('DELETE FROM gallery_photos WHERE id = ?', p.id);
    removeFile(p.file);
    removeFile(p.thumb);
    refresh('gallery');
    res.json({ ok: true });
  });

  // Einreichungen bewerten
  a.get('/submissions', (req, res) => {
    res.json(req.query.pending === '1' ? submissionsFor('s.points IS NULL') : submissionsFor('1 = 1'));
  });
  a.post('/submissions/:id/points', (req, res) => {
    const s = one(`SELECT s.id, s.group_id, c.title FROM submissions s JOIN challenges c ON c.id = s.challenge_id WHERE s.id = ?`, int(req.params.id));
    if (!s) throw new HttpError(404, 'Einreichung nicht gefunden');
    const raw = req.body?.points;
    const pts = raw === null || raw === '' || raw === undefined ? null : Math.max(-10000, Math.min(10000, int(raw)));
    tx(() => {
      run('UPDATE submissions SET points = ? WHERE id = ?', pts, s.id);
      run('DELETE FROM points WHERE ref = ?', `submission:${s.id}`);
      if (pts) {
        run(`INSERT INTO points (group_id, amount, reason, source, ref, created_at) VALUES (?, ?, ?, 'challenge', ?, ?)`,
          s.group_id, pts, `Challenge: ${s.title}`, `submission:${s.id}`, now());
      }
    });
    refresh('points');
    refresh('submissions');
    res.json({ ok: true });
  });

  // Punkte & Bonus
  a.get('/points', (req, res) => {
    res.json(all(`SELECT p.id, p.amount, p.reason, p.source, p.created_at AS createdAt, g.name AS groupName, g.id AS groupId
      FROM points p JOIN groups g ON g.id = p.group_id ORDER BY p.id DESC LIMIT 300`));
  });
  a.post('/points', (req, res) => {
    const b = req.body || {};
    const groupIds = (Array.isArray(b.groupIds) ? b.groupIds : [b.groupId]).map((x) => int(x, -1));
    const amount = int(b.amount);
    if (!amount) throw bad('Punkte angeben (darf auch negativ sein)');
    const reason = text(b.reason, { name: 'Grund', max: 120 });
    tx(() => groupIds.forEach((gid) => {
      if (!one('SELECT 1 FROM groups WHERE id = ?', gid)) throw bad('Smallgroup nicht gefunden');
      run(`INSERT INTO points (group_id, amount, reason, source, created_at) VALUES (?, ?, ?, 'bonus', ?)`, gid, amount, reason, now());
    }));
    refresh('points');
    res.json({ ok: true });
  });
  a.delete('/points/:id', (req, res) => {
    const p = one('SELECT id, source FROM points WHERE id = ?', int(req.params.id));
    if (!p) throw new HttpError(404, 'Eintrag nicht gefunden');
    if (p.source !== 'bonus') throw bad('Challenge- und Spielpunkte bitte dort ändern, wo sie vergeben wurden');
    run('DELETE FROM points WHERE id = ?', p.id);
    refresh('points');
    res.json({ ok: true });
  });
  a.post('/settings', (req, res) => {
    if ('leaderboardHidden' in (req.body || {})) setSetting('leaderboardHidden', !!req.body.leaderboardHidden);
    refresh('points');
    res.json({ ok: true });
  });

  // Smallgroups & Benutzer
  a.get('/groups', (req, res) => {
    const groups = leaderboard();
    const codes = Object.fromEntries(all('SELECT id, join_code FROM groups').map((g) => [g.id, g.join_code]));
    for (const g of groups) {
      g.code = codes[g.id];
      g.users = all('SELECT id, username AS email, display_name AS name, verified FROM users WHERE group_id = ? ORDER BY display_name', g.id);
    }
    const loose = all(`SELECT id, username AS email, display_name AS name, role, verified FROM users WHERE group_id IS NULL ORDER BY role, display_name`);
    res.json({ groups, loose, mailConfigured });
  });
  a.post('/groups', (req, res) => {
    const id = createGroup(req.body?.name);
    refresh('groups');
    res.json({ ok: true, id });
  });
  a.put('/groups/:id', (req, res) => {
    const name = text(req.body?.name, { name: 'Name', min: 2, max: 40 });
    if (one('SELECT 1 FROM groups WHERE name = ? AND id != ?', name, int(req.params.id))) throw bad('Name schon vergeben');
    run('UPDATE groups SET name = ? WHERE id = ?', name, int(req.params.id));
    refresh('groups');
    game.broadcast();
    res.json({ ok: true });
  });
  a.delete('/groups/:id', (req, res) => {
    const id = int(req.params.id);
    const files = all('SELECT p.file, p.thumb FROM photos p JOIN submissions s ON s.id = p.submission_id WHERE s.group_id = ?', id);
    io.in(`group:${id}`).socketsLeave(`group:${id}`);
    run('DELETE FROM groups WHERE id = ?', id);
    files.forEach((f) => { removeFile(f.file); removeFile(f.thumb); });
    refresh('groups');
    refresh('points');
    refresh('gallery');
    game.broadcast();
    res.json({ ok: true });
  });
  a.put('/users/:id', (req, res) => {
    const u = one("SELECT id, group_id FROM users WHERE id = ? AND role = 'user'", int(req.params.id));
    if (!u) throw new HttpError(404, 'Person nicht gefunden');
    const b = req.body || {};
    if ('groupId' in b) {
      const gid = b.groupId ? int(b.groupId) : null;
      if (gid && !one('SELECT 1 FROM groups WHERE id = ?', gid)) throw bad('Smallgroup nicht gefunden');
      run('UPDATE users SET group_id = ? WHERE id = ?', gid, u.id);
      moveSocketsToGroup(u.id, u.group_id, gid);
    }
    if (b.password) {
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password(b.password)), u.id);
      run('DELETE FROM sessions WHERE user_id = ?', u.id);
    }
    if (b.verified === true) run('UPDATE users SET verified = 1 WHERE id = ?', u.id);
    refresh('groups');
    game.broadcast();
    res.json({ ok: true });
  });
  a.delete('/users/:id', (req, res) => {
    const u = one("SELECT id FROM users WHERE id = ? AND role = 'user'", int(req.params.id));
    if (!u) throw new HttpError(404, 'Person nicht gefunden');
    io.in(`user:${u.id}`).disconnectSockets(true);
    run('DELETE FROM users WHERE id = ?', u.id);
    refresh('groups');
    res.json({ ok: true });
  });

  // Spielsteuerung
  // Spiel eröffnen – auf Wunsch mit Push an alle ("tritt mit deiner Smallgroup bei")
  a.post('/game', async (req, res) => {
    const b = req.body || {};
    const g = game.create(b);
    let push = null;
    if (b.push === true || b.push === '1' || b.push === 'on') {
      const seats = g.maxPlayers ? ` Pro Smallgroup schreiben ${g.maxPlayers === 1 ? '1 Handy' : `${g.maxPlayers} Handys`} mit.` : '';
      push = await sendPush({
        title: `🔤 ${g.title} startet!`,
        body: `Tritt jetzt mit deiner Smallgroup bei.${seats}`,
        url: '#/spiel',
        tag: 'game',
      }, { excludeUserId: req.user.id });
    }
    res.json({ ok: true, push });
  });
  a.post('/game/round', (req, res) => { game.startRound(); res.json({ ok: true }); });
  a.post('/game/stop', (req, res) => { game.forceStop(); res.json({ ok: true }); });
  a.post('/game/discard', (req, res) => { game.discardRound(); res.json({ ok: true }); });
  a.post('/game/score', (req, res) => { game.score(req.body?.points); res.json({ ok: true }); });
  a.post('/game/finish', (req, res) => { game.finish(); res.json({ ok: true }); });
  a.post('/game/kick/:groupId', (req, res) => { game.kick(int(req.params.groupId)); res.json({ ok: true }); });

  r.use('/admin', a);
  return r;
}
