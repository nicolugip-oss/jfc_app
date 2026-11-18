// REST-API für Login, Smallgroups, Challenges, Punkte und Admin-Funktionen
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { one, all, run, tx, UPLOAD_DIR, getSetting, setSetting } from './db.js';
import {
  HttpError, hashPassword, verifyPassword, createSession, destroySession,
  requireUser, requireAdmin, loginRateLimit,
} from './auth.js';
import { DEFAULT_CATEGORIES, DEFAULT_LETTERS } from './game.js';

const bad = (m) => new HttpError(400, m);
const now = () => Date.now();

function text(v, { name, min = 1, max = 200 }) {
  const s = String(v ?? '').trim();
  if (s.length < min) throw bad(min <= 1 ? `${name} fehlt` : `${name}: mindestens ${min} Zeichen`);
  if (s.length > max) throw bad(`${name}: höchstens ${max} Zeichen`);
  return s;
}
const int = (v, def = 0) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : def);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newJoinCode() {
  for (;;) {
    const code = Array.from(crypto.randomBytes(5), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
    if (!one('SELECT 1 FROM groups WHERE join_code = ?', code)) return code;
  }
}
function createGroup(name) {
  const n = text(name, { name: 'Smallgroup-Name', min: 2, max: 40 });
  if (one('SELECT 1 FROM groups WHERE name = ?', n)) throw bad('Diesen Smallgroup-Namen gibt es schon – nimm einen anderen oder tritt mit dem Code bei');
  return run('INSERT INTO groups (name, join_code, created_at) VALUES (?, ?, ?)', n, newJoinCode(), now()).id;
}
function groupByCode(code) {
  const g = one('SELECT id FROM groups WHERE join_code = ?', String(code || '').trim().toUpperCase());
  if (!g) throw new HttpError(404, 'Diesen Smallgroup-Code gibt es nicht');
  return g.id;
}
function resolveGroup({ groupMode, groupName, groupCode }) {
  if (groupMode === 'create') return createGroup(groupName);
  if (groupMode === 'join') return groupByCode(groupCode);
  throw bad('Bitte eine Smallgroup erstellen oder beitreten');
}

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/heic': '.heic' }[file.mimetype] || '.img';
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});
const removeFile = (f) => f && fs.rm(path.join(UPLOAD_DIR, path.basename(f)), { force: true }, () => {});
const cleanupUploads = (req) => [...(req.files || []), ...(req.file ? [req.file] : [])].forEach((f) => removeFile(f.filename));

function meData(u) {
  const group = u.group_id ? one('SELECT id, name, join_code AS code FROM groups WHERE id = ?', u.group_id) : null;
  if (group) group.members = all('SELECT id, display_name AS name FROM users WHERE group_id = ? ORDER BY display_name', group.id);
  return { user: { id: u.id, username: u.username, name: u.display_name, role: u.role }, group };
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

function submissionsFor(where, ...params) {
  const subs = all(`SELECT s.id, s.challenge_id AS challengeId, c.title AS challengeTitle, c.points AS maxPoints,
      s.group_id AS groupId, g.name AS groupName, s.comment, s.points, s.updated_at AS updatedAt
    FROM submissions s JOIN groups g ON g.id = s.group_id JOIN challenges c ON c.id = s.challenge_id
    WHERE ${where} AND EXISTS (SELECT 1 FROM photos p WHERE p.submission_id = s.id)
    ORDER BY (s.points IS NOT NULL), s.updated_at DESC`, ...params);
  for (const s of subs) s.photos = photosOf(s.id);
  return subs;
}
const photosOf = (submissionId) => all(`SELECT p.id, '/uploads/' || p.file AS url, u.display_name AS by
  FROM photos p LEFT JOIN users u ON u.id = p.user_id WHERE p.submission_id = ? ORDER BY p.id`, submissionId);

function parseDeadline(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) throw bad('Ungültige Deadline');
  return t;
}

export function apiRouter({ io, game }) {
  const r = express.Router();
  const refresh = (topic) => io.emit('refresh', topic);
  const moveSocketsToGroup = (userId, oldGroup, newGroup) => {
    if (oldGroup) io.in(`user:${userId}`).socketsLeave(`group:${oldGroup}`);
    if (newGroup) io.in(`user:${userId}`).socketsJoin(`group:${newGroup}`);
  };

  // ---------- Öffentlich ----------
  r.get('/config', (req, res) => {
    res.json({
      registrationCode: !!process.env.REGISTRATION_CODE,
      leaderboardHidden: getSetting('leaderboardHidden', false),
      defaults: { categories: DEFAULT_CATEGORIES, letters: DEFAULT_LETTERS },
    });
  });

  r.post('/register', (req, res) => {
    const b = req.body || {};
    const code = process.env.REGISTRATION_CODE;
    if (code && String(b.regCode || '').trim().toLowerCase() !== code.trim().toLowerCase()) {
      throw new HttpError(403, 'Der Camp-Code stimmt nicht');
    }
    const name = text(b.displayName, { name: 'Name', min: 2, max: 40 });
    const username = text(b.username, { name: 'Benutzername', min: 3, max: 30 }).toLowerCase();
    if (!/^[a-z0-9._-]+$/.test(username)) throw bad('Benutzername: nur Buchstaben, Zahlen, . _ -');
    const pw = String(b.password || '');
    if (pw.length < 6) throw bad('Passwort: mindestens 6 Zeichen');
    if (one('SELECT 1 FROM users WHERE username = ?', username)) throw bad('Dieser Benutzername ist schon vergeben');
    const userId = tx(() => {
      const groupId = resolveGroup(b);
      return run(`INSERT INTO users (username, display_name, password_hash, group_id, created_at) VALUES (?, ?, ?, ?, ?)`,
        username, name, hashPassword(pw), groupId, now()).id;
    });
    createSession(req, res, userId);
    refresh('groups');
    res.json({ ok: true });
  });

  r.post('/login', loginRateLimit, (req, res) => {
    const { username, password } = req.body || {};
    const u = one('SELECT id, password_hash FROM users WHERE username = ?', String(username || '').trim().toLowerCase());
    if (!u || !verifyPassword(String(password || ''), u.password_hash)) throw new HttpError(401, 'Benutzername oder Passwort falsch');
    createSession(req, res, u.id);
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    destroySession(req, res);
    res.json({ ok: true });
  });

  // ---------- Eingeloggt ----------
  r.get('/me', requireUser, (req, res) => res.json(meData(req.user)));

  r.post('/me/group', requireUser, (req, res) => {
    if (req.user.role === 'admin') throw bad('Admins sind in keiner Smallgroup');
    const old = req.user.group_id;
    const groupId = tx(() => resolveGroup(req.body || {}));
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

  r.post('/challenges/:id/photos', requireUser, upload.array('photos', 10), (req, res) => {
    try {
      if (!req.user.group_id) throw bad('Du bist in keiner Smallgroup');
      const c = one('SELECT id, deadline FROM challenges WHERE id = ? AND published = 1', int(req.params.id));
      if (!c) throw new HttpError(404, 'Challenge nicht gefunden');
      if (c.deadline && now() > c.deadline) throw bad('Die Deadline für diese Challenge ist vorbei');
      if (!req.files?.length) throw bad('Bitte mindestens ein Bild auswählen');
      tx(() => {
        run(`INSERT INTO submissions (challenge_id, group_id, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(challenge_id, group_id) DO UPDATE SET updated_at = excluded.updated_at`, c.id, req.user.group_id, now());
        const s = one('SELECT id, points FROM submissions WHERE challenge_id = ? AND group_id = ?', c.id, req.user.group_id);
        if (s.points !== null) throw bad('Eure Einreichung wurde schon bewertet');
        for (const f of req.files) {
          run('INSERT INTO photos (submission_id, user_id, file, created_at) VALUES (?, ?, ?, ?)', s.id, req.user.id, f.filename, now());
        }
        if (typeof req.body?.comment === 'string' && req.body.comment.trim()) {
          run('UPDATE submissions SET comment = ? WHERE id = ?', req.body.comment.trim().slice(0, 500), s.id);
        }
      });
    } catch (e) {
      cleanupUploads(req);
      throw e;
    }
    refresh('submissions');
    res.json({ ok: true });
  });

  r.put('/challenges/:id/comment', requireUser, (req, res) => {
    const s = one('SELECT id, points FROM submissions WHERE challenge_id = ? AND group_id = ?', int(req.params.id), req.user.group_id ?? -1);
    if (!s) throw bad('Ladet zuerst ein Bild hoch');
    run('UPDATE submissions SET comment = ?, updated_at = ? WHERE id = ?', String(req.body?.comment || '').trim().slice(0, 500), now(), s.id);
    res.json({ ok: true });
  });

  r.delete('/photos/:id', requireUser, (req, res) => {
    const p = one(`SELECT p.id, p.file, s.group_id, s.points FROM photos p JOIN submissions s ON s.id = p.submission_id WHERE p.id = ?`, int(req.params.id));
    if (!p) throw new HttpError(404, 'Bild nicht gefunden');
    if (req.user.role !== 'admin') {
      if (p.group_id !== req.user.group_id) throw new HttpError(403, 'Nicht eure Einreichung');
      if (p.points !== null) throw bad('Schon bewertet – Bild kann nicht mehr gelöscht werden');
    }
    run('DELETE FROM photos WHERE id = ?', p.id);
    removeFile(p.file);
    refresh('submissions');
    res.json({ ok: true });
  });

  // ---------- Stadt Land Youth ----------
  r.post('/game/join', requireUser, (req, res) => { game.join(req.user); res.json({ ok: true }); });

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
  a.post('/challenges', upload.single('image'), (req, res) => {
    try {
      const f = challengeFields(req.body || {});
      const id = run(`INSERT INTO challenges (title, description, points, deadline, published, image, created_at)
                      VALUES (?, ?, ?, ?, ?, ?, ?)`, f.title, f.description, f.points, f.deadline, f.published, req.file?.filename ?? null, now()).id;
      refresh('challenges');
      res.json({ ok: true, id });
    } catch (e) { cleanupUploads(req); throw e; }
  });
  a.put('/challenges/:id', upload.single('image'), (req, res) => {
    try {
      const c = one('SELECT id, image FROM challenges WHERE id = ?', int(req.params.id));
      if (!c) throw new HttpError(404, 'Challenge nicht gefunden');
      const f = challengeFields(req.body || {});
      let image = c.image;
      if (req.file) { removeFile(c.image); image = req.file.filename; }
      else if (req.body?.removeImage === '1') { removeFile(c.image); image = null; }
      run(`UPDATE challenges SET title = ?, description = ?, points = ?, deadline = ?, published = ?, image = ? WHERE id = ?`,
        f.title, f.description, f.points, f.deadline, f.published, image, c.id);
      refresh('challenges');
      res.json({ ok: true });
    } catch (e) { cleanupUploads(req); throw e; }
  });
  a.delete('/challenges/:id', (req, res) => {
    const c = one('SELECT id, image FROM challenges WHERE id = ?', int(req.params.id));
    if (!c) throw new HttpError(404, 'Challenge nicht gefunden');
    const files = all('SELECT p.file FROM photos p JOIN submissions s ON s.id = p.submission_id WHERE s.challenge_id = ?', c.id);
    tx(() => {
      run(`DELETE FROM points WHERE ref IN (SELECT 'submission:' || id FROM submissions WHERE challenge_id = ?)`, c.id);
      run('DELETE FROM challenges WHERE id = ?', c.id);
    });
    files.forEach((f) => removeFile(f.file));
    removeFile(c.image);
    refresh('challenges');
    refresh('points');
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
      g.users = all('SELECT id, username, display_name AS name FROM users WHERE group_id = ? ORDER BY display_name', g.id);
    }
    const loose = all(`SELECT id, username, display_name AS name, role FROM users WHERE group_id IS NULL ORDER BY role, display_name`);
    res.json({ groups, loose });
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
    io.in(`group:${id}`).socketsLeave(`group:${id}`);
    run('DELETE FROM groups WHERE id = ?', id);
    refresh('groups');
    refresh('points');
    game.broadcast();
    res.json({ ok: true });
  });
  a.put('/users/:id', (req, res) => {
    const u = one("SELECT id, group_id FROM users WHERE id = ? AND role = 'user'", int(req.params.id));
    if (!u) throw new HttpError(404, 'Benutzer nicht gefunden');
    const b = req.body || {};
    if ('groupId' in b) {
      const gid = b.groupId ? int(b.groupId) : null;
      if (gid && !one('SELECT 1 FROM groups WHERE id = ?', gid)) throw bad('Smallgroup nicht gefunden');
      run('UPDATE users SET group_id = ? WHERE id = ?', gid, u.id);
      moveSocketsToGroup(u.id, u.group_id, gid);
    }
    if (b.password) {
      if (String(b.password).length < 6) throw bad('Passwort: mindestens 6 Zeichen');
      run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(String(b.password)), u.id);
      run('DELETE FROM sessions WHERE user_id = ?', u.id);
    }
    refresh('groups');
    game.broadcast();
    res.json({ ok: true });
  });
  a.delete('/users/:id', (req, res) => {
    const u = one("SELECT id FROM users WHERE id = ? AND role = 'user'", int(req.params.id));
    if (!u) throw new HttpError(404, 'Benutzer nicht gefunden');
    io.in(`user:${u.id}`).disconnectSockets(true);
    run('DELETE FROM users WHERE id = ?', u.id);
    refresh('groups');
    res.json({ ok: true });
  });

  // Spielsteuerung
  a.post('/game', (req, res) => { game.create(req.body || {}); res.json({ ok: true }); });
  a.post('/game/round', (req, res) => { game.startRound(); res.json({ ok: true }); });
  a.post('/game/stop', (req, res) => { game.forceStop(); res.json({ ok: true }); });
  a.post('/game/discard', (req, res) => { game.discardRound(); res.json({ ok: true }); });
  a.post('/game/score', (req, res) => { game.score(req.body?.points); res.json({ ok: true }); });
  a.post('/game/finish', (req, res) => { game.finish(); res.json({ ok: true }); });
  a.post('/game/kick/:groupId', (req, res) => { game.kick(int(req.params.groupId)); res.json({ ok: true }); });

  r.use('/admin', a);
  return r;
}
