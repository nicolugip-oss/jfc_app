// Jesus First Camp App – Server
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import multer from 'multer';
import { UPLOAD_DIR, backupDatabase } from './db.js';
import { authMiddleware, userFromCookieHeader, loadUser, ensureAdmin, HttpError } from './auth.js';
import { apiRouter } from './routes.js';
import { createGame } from './game.js';
import { mailConfigured } from './mail.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

ensureAdmin();
if (!mailConfigured && process.env.EMAIL_VERIFICATION !== 'off') {
  console.log('  ⚠️  SMTP ist nicht eingerichtet – Bestätigungs-Mails werden nur hier in der Konsole angezeigt.');
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 });
const game = createGame(io);

app.use(express.json({ limit: '200kb' }));
app.use(authMiddleware);
app.use('/api', apiRouter({ io, game }));

// Hochgeladene Bilder nur für eingeloggte Personen
app.get('/uploads/:file', (req, res) => {
  if (!req.user) return res.status(401).end();
  const file = path.basename(req.params.file);
  const full = path.join(UPLOAD_DIR, file);
  if (!/^[a-f0-9]{32}\.\w+$/.test(file) || !fs.existsSync(full)) return res.status(404).end();
  res.set('Cache-Control', 'private, max-age=604800, immutable');
  res.sendFile(full);
});

// Kurze Links aus den Mails → passende Seite in der App
app.get('/bestaetigen/:token', (req, res) => res.redirect(`/#/bestaetigen?token=${encodeURIComponent(req.params.token)}`));
app.get('/passwort-neu/:token', (req, res) => res.redirect(`/#/passwort-neu?token=${encodeURIComponent(req.params.token)}`));
app.get('/einladung/:code', (req, res) => res.redirect(`/#/registrieren?code=${encodeURIComponent(req.params.code)}`));

app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

// Fehler einheitlich als JSON zurückgeben
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Bild ist zu gross (max. 15 MB)' : err.code === 'LIMIT_FILE_COUNT' ? 'Maximal 10 Bilder auf einmal' : 'Upload fehlgeschlagen';
    return res.status(400).json({ error: msg });
  }
  const status = err instanceof HttpError ? err.status : err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: status >= 500 ? 'Serverfehler – bitte nochmals versuchen' : err.message,
    code: err instanceof HttpError ? err.code : undefined,
  });
});

// ---------- Echtzeit (Socket.IO) ----------
io.use((socket, next) => {
  const user = userFromCookieHeader(socket.handshake.headers.cookie);
  if (!user) return next(new Error('unauthorized'));
  socket.data.userId = user.id;
  next();
});

io.on('connection', (socket) => {
  const user = loadUser(socket.data.userId);
  socket.join(`user:${user.id}`);
  if (user.group_id) socket.join(`group:${user.group_id}`);
  if (user.role === 'admin') socket.join('admins');
  socket.emit('game:state', game.stateForUser(user));

  const handle = (fn) => (payload, ack) => {
    try {
      const u = loadUser(socket.data.userId);
      if (!u) throw new HttpError(401, 'Bitte neu einloggen');
      fn(u, payload || {});
      if (typeof ack === 'function') ack({ ok: true });
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      if (typeof ack === 'function') ack({ error: e instanceof HttpError ? e.message : 'Fehler' });
    }
  };
  socket.on('game:answer', handle((u, p) => game.saveAnswer(u, p)));
  socket.on('game:stop', handle((u, p) => game.stop(u, p)));
  socket.on('game:sync', (ack) => {
    const u = loadUser(socket.data.userId);
    if (u && typeof ack === 'function') ack(game.stateForUser(u));
  });
});

game.resume();

// Backup beim Start und danach alle 6 Stunden prüfen (eines pro Tag)
const runBackup = () => {
  try {
    const file = backupDatabase();
    if (file) console.log(`Backup erstellt: ${file}`);
  } catch (e) { console.error('Backup fehlgeschlagen:', e.message); }
};
runBackup();
setInterval(runBackup, 6 * 3_600_000).unref();
server.listen(PORT, () => console.log(`Jesus First Camp App läuft auf http://localhost:${PORT}`));
