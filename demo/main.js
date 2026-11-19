// Browser-Demo der Jesus First Camp App (für GitHub Pages)
// Der echte Server-Code (server/*.js) läuft hier direkt im Browser:
//   SQLite → sql.js (WebAssembly), Express/Multer/fs → kleine Ersatzmodule in demo/shims.
// Alle Daten bleiben auf diesem Gerät (IndexedDB). Zwei Bot-Smallgroups spielen mit.
import { initStore, kvGet, kvSet, files, wipe, clearAll } from './store.js';
import { pickWord } from './words.js';
import { coverFiles } from '../public/cover.js';
import { artFiles } from './art.js';

// Wird die Version erhöht, bekommen alle Demo-Geräte frische Beispieldaten
const SEED_VERSION = 2;

// Einstellungen wie in der .env – im Demo ohne Mails
globalThis.__DEMO_ENV = { EMAIL_VERIFICATION: 'off', ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin', DATA_DIR: 'data' };

export const DEMO_LOGINS = {
  user: { email: 'lea@demo.ch', password: 'demo1234' },
  admin: { email: 'admin', password: 'admin' },
};

let M;            // geladene Server-Module
let engine;       // Spiel-Engine (server/game.js)
let router;       // API-Router (server/routes.js)
let io;           // Socket.IO-Ersatz
let client = null; // verbundener "Socket" der App

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

// ---------- Speichern ----------
let dirty = false;
let saveTimer = null;
globalThis.__demoMarkDirty = () => {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
};
function saveNow() {
  clearTimeout(saveTimer);
  if (!dirty || !globalThis.__DEMO_DB) return;
  dirty = false;
  const bytes = globalThis.__DEMO_DB.export();
  globalThis.__DEMO_DB.exec('PRAGMA foreign_keys = ON'); // export() setzt Pragmas zurück
  kvSet('db', bytes).catch((e) => console.error('Demo speichern', e));
}

// ---------- "Cookies" (Login-Session) ----------
const cookies = {
  get: (n) => localStorage.getItem(`jfc-demo-cookie:${n}`),
  set: (n, v) => localStorage.setItem(`jfc-demo-cookie:${n}`, v),
  delete: (n) => localStorage.removeItem(`jfc-demo-cookie:${n}`),
};
const cookieHeader = () => {
  const sid = cookies.get('jf_sid');
  return sid ? `jf_sid=${encodeURIComponent(sid)}` : '';
};
const sessionUser = () => M.auth.userFromCookieHeader(cookieHeader());

// Bild-Pfade (/uploads/…) → Blob-URLs aus dem Demo-Speicher
function rewrite(value) {
  if (typeof value === 'string') return value.startsWith('/uploads/') ? files.url(value.slice(9)) : value;
  if (Array.isArray(value)) return value.map(rewrite);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
  return value;
}

// ---------- API (statt fetch) ----------
export async function api(method, url, body, { asUserId } = {}) {
  const u = new URL(url, location.href);
  const req = {
    method,
    path: u.pathname.replace(/^.*\/api(?=\/)/, ''),
    query: Object.fromEntries(u.searchParams),
    params: {},
    headers: { cookie: cookieHeader() },
    ip: 'demo',
    protocol: location.protocol.replace(':', ''),
    secure: true,
    get: (h) => (String(h).toLowerCase() === 'host' ? location.host : undefined),
    body: body instanceof FormData ? body : body === undefined ? {} : JSON.parse(JSON.stringify(body)),
    rawBody: body,
  };
  let status = 200;
  let payload = null;
  const res = {
    status(code) { status = code; return res; },
    json(obj) { payload = obj; return res; },
    cookie(name, value) { cookies.set(name, value); },
    clearCookie(name) { cookies.delete(name); },
  };
  await sleep(rand(40, 120)); // fühlt sich an wie ein echter Server
  try {
    req.user = asUserId ? M.auth.loadUser(asUserId) : M.auth.userFromCookieHeader(req.headers.cookie);
    const handled = await router.handle(req, res, req.path);
    if (!handled) { status = 404; payload = { error: 'Nicht gefunden' }; }
  } catch (err) {
    status = err.name === 'MulterError' ? 400 : err.status || 500;
    if (status >= 500) console.error(err);
    payload = { error: status >= 500 ? `Fehler im Demo: ${err.message}` : err.message, code: err.code };
  }
  rememberParticipant();
  syncSocketUser();
  if (status >= 400) throw Object.assign(new Error(payload.error), { code: payload.code, status });
  return rewrite(payload ?? { ok: true });
}

// ---------- Socket.IO-Ersatz ----------
function clientRooms() {
  const u = client?.connected ? sessionUser() : null;
  if (!u) return new Set();
  return new Set([`user:${u.id}`, ...(u.group_id ? [`group:${u.group_id}`] : []), ...(u.role === 'admin' ? ['admins'] : [])]);
}
function deliver(event, data) {
  const c = client;
  if (!c?.connected) return;
  const payload = rewrite(JSON.parse(JSON.stringify(data ?? null)));
  setTimeout(() => (c.listeners.get(event) || []).forEach((cb) => cb(payload)), 15);
}
function createIo() {
  const serverSocket = { data: { userId: null }, emit: (ev, d) => deliver(ev, d) };
  return {
    emit: deliver,
    to: (room) => ({ emit: (ev, d) => { if (clientRooms().has(room)) deliver(ev, d); } }),
    in: () => ({ socketsLeave() {}, socketsJoin() {}, disconnectSockets() {} }),
    sockets: { sockets: new Map([['demo', serverSocket]]) },
    serverSocket,
  };
}
function syncSocketUser() {
  io.serverSocket.data.userId = client?.connected ? sessionUser()?.id ?? null : null;
}

export function socket() {
  client?.disconnect();
  const c = {
    connected: false,
    listeners: new Map(),
    on(ev, cb) { if (!c.listeners.has(ev)) c.listeners.set(ev, []); c.listeners.get(ev).push(cb); return c; },
    emit(ev, payload, ack) {
      if (typeof payload === 'function') { ack = payload; payload = undefined; }
      setTimeout(() => handleClientEvent(ev, payload, ack), rand(20, 60));
    },
    disconnect() { c.connected = false; c.listeners.clear(); if (client === c) client = null; syncSocketUser(); },
  };
  client = c;
  setTimeout(() => {
    if (client !== c) return;
    c.connected = true;
    syncSocketUser();
    (c.listeners.get('connect') || []).forEach((cb) => cb());
    const u = sessionUser();
    if (u) deliver('game:state', engine.stateForUser(u));
  }, 30);
  return c;
}

function handleClientEvent(ev, payload, ack) {
  const u = sessionUser();
  const reply = (r) => typeof ack === 'function' && ack(rewrite(r));
  try {
    if (!u) throw new Error('Bitte neu einloggen');
    if (ev === 'game:answer') engine.saveAnswer(u, payload || {});
    else if (ev === 'game:stop') engine.stop(u, payload || {});
    else if (ev === 'game:sync') return reply(engine.stateForUser(u));
    reply({ ok: true });
  } catch (e) {
    reply({ error: e.message });
  }
}

// ---------- Demo-Steuerung ----------
const adminId = () => M.db.one("SELECT id FROM users WHERE role = 'admin' LIMIT 1").id;
function rememberParticipant() {
  const u = sessionUser();
  if (u && u.role === 'user') localStorage.setItem('jfc-demo-last-user', String(u.id));
}

// Zwischen Admin- und Teilnehmer-Ansicht wechseln (ohne Passwort)
export function switchTo(role) {
  let id;
  if (role === 'admin') id = adminId();
  else {
    const last = Number(localStorage.getItem('jfc-demo-last-user'));
    id = (last && M.db.one("SELECT id FROM users WHERE id = ? AND role = 'user'", last)?.id)
      || M.db.one('SELECT id FROM users WHERE username = ?', DEMO_LOGINS.user.email)?.id;
  }
  if (!id) throw new Error('Kein Konto gefunden');
  M.auth.createSession({ secure: true }, { cookie: (n, v) => cookies.set(n, v) }, id);
  syncSocketUser();
}

// Admin-Aktionen aus der Teilnehmer-Ansicht (damit man das Spiel allein testen kann)
export const adminApi = (method, url, body) => api(method, url, body, { asUserId: adminId() });

export function autoScore() {
  const state = engine.stateForUser(M.auth.loadUser(adminId()));
  if (!state.reveal) throw new Error('Gerade gibt es nichts auszuwerten');
  engine.score(Object.fromEntries(state.reveal.map((r) => [r.groupId, r.answers.map((a) => a.suggested)])));
}

export async function reset() {
  saveNow();
  clearInterval(botTimer);
  Object.keys(localStorage).filter((k) => k.startsWith('jfc-demo')).forEach((k) => localStorage.removeItem(k));
  await wipe();
  location.reload();
}

// ---------- Bots: zwei Smallgroups spielen Stadt Land Youth mit ----------
const plans = new Map();
let botTimer = null;
const botGroups = () => M.db.all(`SELECT g.id AS groupId, MIN(u.id) AS userId FROM users u JOIN groups g ON g.id = u.group_id
  WHERE u.username LIKE '%@bot.demo' GROUP BY g.id ORDER BY g.id`);

function makePlan(round, categories) {
  return botGroups().map((b, n) => {
    const strong = n === 0; // die erste Bot-Gruppe ist schnell und drückt STOPP
    const skill = strong ? 0.97 : 0.6;
    const answers = categories.map((c) => (Math.random() < skill ? pickWord(c, round.letter) : null));
    let t = rand(2500, 5000);
    const steps = answers.map((value, idx) => ({ idx, value })).filter((s) => s.value).sort(() => Math.random() - 0.5)
      .map((s) => { t += strong ? rand(2500, 5500) : rand(4000, 8500); return { ...s, at: t, done: false }; });
    const complete = answers.every(Boolean);
    return { ...b, answers, steps, stopAt: strong && complete ? Math.max(t + rand(3000, 6000), 35000) : null };
  });
}

function botTick() {
  try {
    const g = M.db.one("SELECT * FROM games WHERE status = 'active' ORDER BY id DESC LIMIT 1");
    if (!g) return;
    for (const b of botGroups()) {
      if (Date.now() - g.created_at > 1500 && !M.db.one('SELECT 1 FROM game_groups WHERE game_id = ? AND group_id = ?', g.id, b.groupId)) {
        engine.join(M.auth.loadUser(b.userId));
      }
    }
    const r = M.db.one('SELECT * FROM rounds WHERE game_id = ? ORDER BY no DESC LIMIT 1', g.id);
    if (!r) return;
    const playing = r.phase === 'playing' || (r.phase === 'countdown' && Date.now() >= r.play_at);
    if (!playing) return;
    if (!plans.has(r.id)) plans.set(r.id, makePlan(r, JSON.parse(g.categories)));
    const elapsed = Date.now() - r.play_at;
    for (const p of plans.get(r.id)) {
      if (!M.db.one('SELECT 1 FROM game_groups WHERE game_id = ? AND group_id = ?', g.id, p.groupId)) continue;
      const bot = M.auth.loadUser(p.userId);
      for (const s of p.steps) {
        if (s.done || s.at > elapsed) continue;
        s.done = true;
        engine.saveAnswer(bot, { roundId: r.id, idx: s.idx, value: s.value });
      }
      if (p.stopAt && elapsed >= p.stopAt) {
        p.stopAt = null;
        engine.stop(bot, { roundId: r.id, answers: p.answers });
        return;
      }
    }
  } catch (e) {
    if (!/vorbei|Countdown/.test(e.message)) console.warn('Bot:', e.message);
  }
}

// ---------- Beispieldaten ----------
// Generiertes Bild (demo/art.js) im Demo-Speicher ablegen
const fileId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
async function storeArt(scene, seed, label) {
  const art = await artFiles(scene, seed, label);
  const file = `${fileId()}.jpg`;
  const thumb = `${fileId()}.jpg`;
  files.put(file, art.image);
  files.put(thumb, art.thumb);
  return { file, thumb };
}

async function seed() {
  const { run } = M.db;
  const { hashPassword } = M.auth;
  const now = Date.now();
  const H = 3_600_000;
  const secret = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  try { await document.fonts.load('italic 900 40px Archivo'); } catch {}

  const group = (name, code) => run('INSERT INTO groups (name, join_code, created_at) VALUES (?, ?, ?)', name, code, now - 30 * H).id;
  const user = (email, name, gid, pw) => run(`INSERT INTO users (username, display_name, password_hash, group_id, verified, created_at)
    VALUES (?, ?, ?, ?, 1, ?)`, email, name, hashPassword(pw), gid, now - 29 * H).id;
  const g1 = group('Löwen von Juda', 'LWJDA');
  const g2 = group('Davids Crew', 'DVDCR');
  const g3 = group('Salz & Licht', 'SLZLC');
  const lea = user(DEMO_LOGINS.user.email, 'Lea M.', g1, DEMO_LOGINS.user.password);
  user('jonas@demo.ch', 'Jonas K.', g1, secret());
  const noah = user('noah@bot.demo', 'Noah B. 🤖', g2, secret());
  user('mia@bot.demo', 'Mia S. 🤖', g2, secret());
  const elia = user('elia@bot.demo', 'Elia K. 🤖', g3, secret());
  user('sara@bot.demo', 'Sara W. 🤖', g3, secret());
  run('UPDATE groups SET created_by = ? WHERE id = ?', lea, g1);
  run('UPDATE groups SET created_by = ? WHERE id = ?', noah, g2);
  run('UPDATE groups SET created_by = ? WHERE id = ?', elia, g3);

  const challenge = async (n, title, description, points, deadline) => {
    // Titelbild im JFC-Stil – derselbe Generator wie im Admin-Formular
    const cover = await coverFiles(title, n);
    const file = `${fileId()}.jpg`;
    const thumb = `${fileId()}.jpg`;
    files.put(file, cover.image);
    files.put(thumb, cover.thumb);
    return run(`INSERT INTO challenges (title, description, points, deadline, published, image, thumb, created_at)
      VALUES (?, ?, ?, ?, 1, ?, ?, ?)`, title, description, points, deadline, file, thumb, now - (10 - n) * H).id;
  };
  const c1 = await challenge(0, 'Human Pyramid', 'Baut als Smallgroup eine menschliche Pyramide – mit möglichst vielen Leuten.\n\nBonus: Ein Leiter ist mit drauf!', 100, null);
  const c2 = await challenge(1, 'Selfie mit einem Leiter', 'Macht ein Smallgroup-Selfie mit einer Person aus dem Leiterteam. Je kreativer, desto besser!', 50, now + 2 * 24 * H);
  await challenge(2, 'Lobpreis-Flashmob', 'Singt in der Mittagspause spontan einen Worship-Song – an einem Ort, wo man es nicht erwartet. Filmt oder fotografiert es!', 80, null);

  // Einreichungen der Bot-Smallgroups mit generierten Bildern passend zur Challenge
  const submit = async (cid, title, scene, gid, uid, groupName, count, points, comment) => {
    const sid = run('INSERT INTO submissions (challenge_id, group_id, comment, points, updated_at) VALUES (?, ?, ?, ?, ?)',
      cid, gid, comment, points, now - 2 * H).id;
    for (let i = 0; i < count; i++) {
      const img = await storeArt(scene, gid * 10 + cid + i, groupName.toUpperCase());
      run('INSERT INTO photos (submission_id, user_id, file, thumb, created_at) VALUES (?, ?, ?, ?, ?)', sid, uid, img.file, img.thumb, now - 2 * H + i);
    }
    if (points !== null) {
      run(`INSERT INTO points (group_id, amount, reason, source, ref, created_at) VALUES (?, ?, ?, 'challenge', ?, ?)`,
        gid, points, `Challenge: ${title}`, `submission:${sid}`, now - H);
    }
  };
  await submit(c1, 'Human Pyramid', 'pyramid', g2, noah, 'Davids Crew', 2, 80, 'Drei Stockwerke! 💪');
  await submit(c2, 'Selfie mit einem Leiter', 'selfie', g2, noah, 'Davids Crew', 1, 50, '');
  await submit(c2, 'Selfie mit einem Leiter', 'selfie', g3, elia, 'Salz & Licht', 1, null, 'Mit Leiterin Anna 🙌');

  // Fotos vom ICF-Youth-Team (Galerie + Startseite)
  const admin = M.db.one("SELECT id FROM users WHERE role = 'admin'").id;
  const official = [
    ['smallgroup', 'Smallgroup-Time am Morgen ☕', 20 * H],
    ['opening', 'Camp-Opening in The Hall 🎉', 6 * H],
    ['worship', 'Worship Night – was für ein Abend! 🔥', 1 * H],
  ];
  for (const [i, [scene, caption, ago]] of official.entries()) {
    const img = await storeArt(scene, 100 + i);
    run('INSERT INTO gallery_photos (user_id, file, thumb, caption, created_at) VALUES (?, ?, ?, ?, ?)', admin, img.file, img.thumb, caption, now - ago);
  }
  run(`INSERT INTO points (group_id, amount, reason, source, created_at) VALUES (?, 20, 'Zusatz-Challenge: Pünktlich beim Morgenprogramm', 'bonus', ?)`, g3, now - 3 * H);
  run(`INSERT INTO points (group_id, amount, reason, source, created_at) VALUES (?, 10, 'Bei der Abendaktion dabei', 'bonus', ?)`, g1, now - 3 * H);
}

// ---------- Start ----------
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`${src} konnte nicht geladen werden`));
    document.head.append(s);
  });
}

export async function init() {
  await initStore();
  await loadScript('sql-wasm.js');
  globalThis.__SQL = await globalThis.initSqlJs({ locateFile: (f) => f });
  if ((await kvGet('seedVersion')) !== SEED_VERSION) {
    // Alte Demo-Daten (z.B. mit den früheren bunten Platzhalter-Bildern) verwerfen
    await clearAll();
    Object.keys(localStorage).filter((k) => k.startsWith('jfc-demo')).forEach((k) => localStorage.removeItem(k));
  }
  globalThis.__DEMO_DB_BYTES = await kvGet('db');
  await files.loadAll();
  // Server-Module erst jetzt laden (sie öffnen beim Import die Datenbank)
  const [db, auth, game, routes] = await Promise.all([
    import('../server/db.js'), import('../server/auth.js'), import('../server/game.js'), import('../server/routes.js'),
  ]);
  M = { db, auth, game, routes };
  auth.ensureAdmin();
  io = createIo();
  engine = game.createGame(io);
  router = routes.apiRouter({ io, game: engine });
  if (!db.one('SELECT 1 FROM groups LIMIT 1')) await seed();
  await kvSet('seedVersion', SEED_VERSION);
  engine.resume();
  saveNow();
  botTimer = setInterval(botTick, 1000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', saveNow);
}
