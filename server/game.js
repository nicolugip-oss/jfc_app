// "Stadt Land Youth" – Live-Spiel für alle Smallgroups gleichzeitig.
// Der Server ist die einzige Wahrheit: Er wählt den Buchstaben, startet den
// Countdown, nimmt Antworten an und stoppt die Runde für alle.
import { one, all, run, tx } from './db.js';
import { loadUser, HttpError } from './auth.js';

export const ROLL_MS = 2500;      // Buchstabe "würfelt" sich aus
export const COUNTDOWN_MS = 5000; // danach 5 … 4 … 3 … 2 … 1
const GRACE_MS = 1500;            // letzte Tipper nach STOPP noch speichern
export const DEFAULT_CATEGORIES = [
  'Stadt', 'Land', 'Fluss', 'Biblische Person', 'Worship-Song', 'Essen', 'Tier', 'Promi',
];
export const DEFAULT_LETTERS = 'ABCDEFGHIJKLMNOPRSTUVWZ';

const bad = (m) => new HttpError(400, m);

export function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Klassische Regeln: 20 = einzige Gruppe mit Antwort, 10 = einzigartig, 5 = doppelt, 0 = leer/falsch
export function suggestPoints(letter, categoryCount, groupIds, answers) {
  const L = normalize(letter);
  const out = {};
  for (const g of groupIds) out[g] = Array(categoryCount).fill(0);
  for (let i = 0; i < categoryCount; i++) {
    const valid = groupIds.filter((g) => {
      const n = normalize(answers[g]?.[i]);
      return n && n.startsWith(L);
    });
    for (const g of valid) {
      const n = normalize(answers[g][i]);
      const dup = valid.some((o) => o !== g && normalize(answers[o][i]) === n);
      out[g][i] = valid.length === 1 ? 20 : dup ? 5 : 10;
    }
  }
  return out;
}

export function createGame(io) {
  let timer = null;
  let pendingBroadcast = null;
  const now = () => Date.now();

  const activeGame = () => one("SELECT * FROM games WHERE status = 'active' ORDER BY id DESC LIMIT 1");
  const lastRound = (gameId) => one('SELECT * FROM rounds WHERE game_id = ? ORDER BY no DESC LIMIT 1', gameId);
  const effectivePhase = (r) => (r.phase === 'countdown' && now() >= r.play_at ? 'playing' : r.phase);
  const isJoined = (gameId, groupId) =>
    !!groupId && !!one('SELECT 1 FROM game_groups WHERE game_id = ? AND group_id = ?', gameId, groupId);

  // ---------- Zustand, der an die Handys geschickt wird ----------
  function baseState() {
    const g = activeGame();
    if (!g) return { game: null };
    const categories = JSON.parse(g.categories);
    const groups = all(`SELECT gr.id, gr.name FROM game_groups gg JOIN groups gr ON gr.id = gg.group_id
                        WHERE gg.game_id = ? ORDER BY gg.joined_at`, g.id);
    // Wer pro Smallgroup mitschreibt (Plätze)
    const players = {};
    for (const p of all(`SELECT gp.group_id, u.id, u.display_name AS name FROM game_players gp JOIN users u ON u.id = gp.user_id
                         WHERE gp.game_id = ? ORDER BY gp.joined_at`, g.id)) {
      (players[p.group_id] ||= []).push({ id: p.id, name: p.name });
    }
    groups.forEach((gr) => { gr.players = players[gr.id]?.length || 0; });
    const totalsRows = all(`SELECT a.group_id, SUM(a.points) AS total FROM answers a
                            JOIN rounds r ON r.id = a.round_id
                            WHERE r.game_id = ? AND r.phase = 'scored' GROUP BY a.group_id`, g.id);
    const totals = Object.fromEntries(totalsRows.map((t) => [t.group_id, t.total || 0]));
    const usedLetters = all('SELECT letter FROM rounds WHERE game_id = ? ORDER BY no', g.id).map((r) => r.letter);
    const r = lastRound(g.id);
    const state = {
      game: { id: g.id, title: g.title, categories, timeLimit: g.time_limit, maxPlayers: g.max_players },
      groups, totals, usedLetters, round: null, progress: null, reveal: null, _answers: {}, _players: players,
    };
    if (!r) return state;

    const phase = effectivePhase(r);
    const stopper = r.stopped_by ? one('SELECT name FROM groups WHERE id = ?', r.stopped_by) : null;
    state.round = {
      id: r.id, no: r.no, letter: r.letter, phase,
      playAt: r.play_at, endsAt: r.ends_at, stoppedAt: r.stopped_at,
      stoppedBy: stopper ? stopper.name : null, stoppedById: r.stopped_by,
    };
    const answers = {};
    const stored = {};
    for (const a of all('SELECT group_id, idx, value, points FROM answers WHERE round_id = ?', r.id)) {
      (answers[a.group_id] ||= Array(categories.length).fill(''))[a.idx] = a.value;
      (stored[a.group_id] ||= Array(categories.length).fill(null))[a.idx] = a.points;
    }
    state._answers = answers;

    if (phase === 'stopped' || phase === 'scored') {
      const ids = groups.map((x) => x.id);
      const suggested = suggestPoints(r.letter, categories.length, ids, answers);
      state.reveal = groups.map((gr) => ({
        groupId: gr.id,
        name: gr.name,
        answers: categories.map((_, i) => ({
          value: answers[gr.id]?.[i] || '',
          suggested: suggested[gr.id][i],
          points: phase === 'scored' ? (stored[gr.id]?.[i] ?? 0) : null,
        })),
      }));
    } else {
      state.progress = groups.map((gr) => ({
        groupId: gr.id,
        filled: (answers[gr.id] || []).filter((v) => v && v.trim()).length,
      }));
    }
    return state;
  }

  function stateFor(user, base) {
    const { _answers, _players, ...s } = base;
    s.serverNow = now();
    s.isAdmin = user.role === 'admin';
    s.myGroupId = user.group_id;
    s.joined = !!(s.game && s.groups.some((g) => g.id === user.group_id));
    if (s.game) {
      // Plätze in der eigenen Smallgroup: wer schreibt mit, darf ich, ist noch etwas frei?
      const max = s.game.maxPlayers;
      s.myPlayers = _players?.[user.group_id] || [];
      s.mySeat = s.myPlayers.some((p) => p.id === user.id);
      s.seatsFree = max ? Math.max(0, max - s.myPlayers.length) : null;
      s.canWrite = s.joined && !s.isAdmin && (!max || s.mySeat);
    }
    if (s.game && s.round) {
      s.myAnswers = s.game.categories.map((_, i) => _answers?.[user.group_id]?.[i] || '');
    }
    if (s.reveal && !s.isAdmin) s.reveal = s.reveal.map((row) => ({ ...row, answers: row.answers.map(({ suggested, ...a }) => a) }));
    return s;
  }

  function broadcast() {
    clearTimeout(pendingBroadcast);
    pendingBroadcast = null;
    const base = baseState();
    for (const [, sock] of io.sockets.sockets) {
      const u = loadUser(sock.data.userId);
      if (u) sock.emit('game:state', stateFor(u, base));
    }
  }
  // Für Tipp-Fortschritt: höchstens 1× pro Sekunde an alle senden
  function broadcastSoon() {
    if (!pendingBroadcast) pendingBroadcast = setTimeout(broadcast, 1000);
  }

  function schedule() {
    clearTimeout(timer);
    timer = null;
    const g = activeGame();
    const r = g && lastRound(g.id);
    if (!r) return;
    if (r.phase === 'countdown') {
      timer = setTimeout(() => {
        run("UPDATE rounds SET phase = 'playing' WHERE id = ? AND phase = 'countdown'", r.id);
        broadcast();
        schedule();
      }, Math.max(0, r.play_at - now()));
    } else if (r.phase === 'playing' && r.ends_at) {
      timer = setTimeout(() => stopRound(r.id, null), Math.max(0, r.ends_at - now()));
    }
  }

  function stopRound(roundId, groupId) {
    const res = run(`UPDATE rounds SET phase = 'stopped', stopped_at = ?, stopped_by = ?
                     WHERE id = ? AND phase IN ('countdown', 'playing')`, now(), groupId, roundId);
    if (!res.changes) return;
    clearTimeout(timer);
    const name = groupId ? one('SELECT name FROM groups WHERE id = ?', groupId)?.name : null;
    io.emit('game:stopped', { roundId, by: name });
    broadcast();
  }

  function saveAnswerRow(roundId, groupId, idx, value) {
    run(`INSERT INTO answers (round_id, group_id, idx, value) VALUES (?, ?, ?, ?)
         ON CONFLICT(round_id, group_id, idx) DO UPDATE SET value = excluded.value`,
      roundId, groupId, idx, value);
  }

  function playableRound(user, roundId, { allowGrace = false } = {}) {
    const g = activeGame();
    if (!g) throw bad('Es läuft gerade kein Spiel');
    const r = lastRound(g.id);
    if (!r || r.id !== roundId) throw bad('Diese Runde ist vorbei');
    if (!isJoined(g.id, user.group_id)) throw bad('Deine Smallgroup ist dem Spiel nicht beigetreten');
    if (g.max_players && !hasSeat(g.id, user)) {
      throw bad(`Für eure Smallgroup schreiben schon ${g.max_players === 1 ? 'eine Person' : `${g.max_players} Personen`} – du kannst live zuschauen und mithelfen 👀`);
    }
    const phase = effectivePhase(r);
    const inGrace = allowGrace && phase === 'stopped' && now() - r.stopped_at < GRACE_MS;
    if (phase !== 'playing' && !inGrace) throw bad(phase === 'countdown' ? 'Noch nicht – Countdown läuft!' : 'STOPP – die Runde ist vorbei');
    return { g, r, categories: JSON.parse(g.categories) };
  }

  const cleanAnswer = (v) => String(v ?? '').replace(/\s+/g, ' ').slice(0, 60);

  const hasSeat = (gameId, user) =>
    !!one('SELECT 1 FROM game_players WHERE game_id = ? AND user_id = ? AND group_id = ?', gameId, user.id, user.group_id);

  // Platz zum Mitschreiben nehmen (sofern noch einer frei ist)
  function takeSeat(g, user, { quiet = false } = {}) {
    if (!g.max_players || hasSeat(g.id, user)) return true;
    const taken = one('SELECT COUNT(*) AS n FROM game_players WHERE game_id = ? AND group_id = ?', g.id, user.group_id).n;
    if (taken >= g.max_players) {
      if (quiet) return false;
      throw bad(`Für eure Smallgroup schreiben schon ${g.max_players === 1 ? 'eine Person' : `${g.max_players} Personen`}. Jemand muss zuerst seinen Platz freigeben.`);
    }
    // Falls die Person vorher in einer anderen Smallgroup mitschrieb
    run('DELETE FROM game_players WHERE game_id = ? AND user_id = ?', g.id, user.id);
    run('INSERT INTO game_players (game_id, user_id, group_id, joined_at) VALUES (?, ?, ?, ?)', g.id, user.id, user.group_id, now());
    return true;
  }

  return {
    broadcast,
    stateForUser: (user) => stateFor(user, baseState()),
    resume: schedule,

    create({ title, categories, timeLimit, letters, maxPlayers }) {
      if (activeGame()) throw bad('Es läuft schon ein Spiel – beende es zuerst');
      const cats = (Array.isArray(categories) ? categories : String(categories || '').split('\n'))
        .map((c) => String(c).trim()).filter(Boolean).slice(0, 15);
      if (cats.length < 2) throw bad('Mindestens 2 Kategorien angeben');
      const L = [...new Set(String(letters || DEFAULT_LETTERS).toUpperCase().replace(/[^A-ZÄÖÜ]/g, ''))].join('');
      if (!L) throw bad('Mindestens einen Buchstaben angeben');
      const limit = Math.max(0, Math.min(1800, parseInt(timeLimit, 10) || 0));
      const seats = Math.max(0, Math.min(20, parseInt(maxPlayers, 10) || 0)); // 0 = unbegrenzt
      const name = String(title || 'Stadt Land Youth').trim().slice(0, 60) || 'Stadt Land Youth';
      run('INSERT INTO games (title, categories, time_limit, letters, max_players, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        name, JSON.stringify(cats), limit, L, seats, now());
      broadcast();
      return { title: name, maxPlayers: seats };
    },

    // Smallgroup tritt bei – wer beitritt, schreibt auch gleich mit
    join(user) {
      const g = activeGame();
      if (!g) throw bad('Es läuft gerade kein Spiel');
      if (!user.group_id) throw bad('Du bist in keiner Smallgroup');
      tx(() => {
        run('INSERT OR IGNORE INTO game_groups (game_id, group_id, joined_at) VALUES (?, ?, ?)', g.id, user.group_id, now());
        takeSeat(g, user, { quiet: true });
      });
      broadcast();
    },

    takeSeat(user) {
      const g = activeGame();
      if (!g) throw bad('Es läuft gerade kein Spiel');
      if (!isJoined(g.id, user.group_id)) throw bad('Deine Smallgroup ist noch nicht beigetreten');
      tx(() => takeSeat(g, user));
      broadcast();
    },

    releaseSeat(user) {
      const g = activeGame();
      if (!g) throw bad('Es läuft gerade kein Spiel');
      run('DELETE FROM game_players WHERE game_id = ? AND user_id = ?', g.id, user.id);
      broadcast();
    },

    kick(groupId) {
      const g = activeGame();
      if (!g) throw bad('Es läuft gerade kein Spiel');
      run('DELETE FROM game_groups WHERE game_id = ? AND group_id = ?', g.id, groupId);
      run('DELETE FROM game_players WHERE game_id = ? AND group_id = ?', g.id, groupId);
      broadcast();
    },

    startRound() {
      const g = activeGame();
      if (!g) throw bad('Es läuft gerade kein Spiel');
      const r = lastRound(g.id);
      if (r && r.phase !== 'scored') throw bad('Bitte zuerst die aktuelle Runde auswerten (oder verwerfen)');
      const joined = one('SELECT COUNT(*) AS n FROM game_groups WHERE game_id = ?', g.id).n;
      if (!joined) throw bad('Noch keine Smallgroup ist beigetreten');
      const used = new Set(all('SELECT letter FROM rounds WHERE game_id = ?', g.id).map((x) => x.letter));
      let pool = [...g.letters].filter((l) => !used.has(l));
      if (!pool.length) pool = [...g.letters];
      const letter = pool[Math.floor(Math.random() * pool.length)];
      const playAt = now() + ROLL_MS + COUNTDOWN_MS;
      run(`INSERT INTO rounds (game_id, no, letter, phase, play_at, ends_at, created_at)
           VALUES (?, ?, ?, 'countdown', ?, ?, ?)`,
        g.id, (r?.no || 0) + 1, letter, playAt, g.time_limit ? playAt + g.time_limit * 1000 : null, now());
      broadcast();
      schedule();
    },

    saveAnswer(user, { roundId, idx, value }) {
      const { r, categories } = playableRound(user, roundId, { allowGrace: true });
      const i = Number(idx);
      if (!Number.isInteger(i) || i < 0 || i >= categories.length) throw bad('Ungültige Kategorie');
      const v = cleanAnswer(value);
      saveAnswerRow(r.id, user.group_id, i, v);
      io.to(`group:${user.group_id}`).emit('game:answer', { roundId: r.id, idx: i, value: v, by: user.id });
      broadcastSoon();
    },

    stop(user, { roundId, answers }) {
      const { r, categories } = playableRound(user, roundId);
      const list = categories.map((_, i) => cleanAnswer(answers?.[i]));
      tx(() => list.forEach((v, i) => saveAnswerRow(r.id, user.group_id, i, v)));
      const missing = list.filter((v) => !v.trim()).length;
      if (missing) throw bad(`Noch ${missing} Feld${missing > 1 ? 'er' : ''} leer – zuerst alles ausfüllen!`);
      stopRound(r.id, user.group_id);
    },

    forceStop() {
      const g = activeGame();
      const r = g && lastRound(g.id);
      if (!r) throw bad('Keine laufende Runde');
      stopRound(r.id, null);
    },

    discardRound() {
      const g = activeGame();
      const r = g && lastRound(g.id);
      if (!r) throw bad('Keine Runde vorhanden');
      tx(() => {
        run('DELETE FROM points WHERE ref = ?', `round:${r.id}`);
        run('DELETE FROM rounds WHERE id = ?', r.id);
      });
      clearTimeout(timer);
      io.emit('refresh', 'points');
      broadcast();
    },

    score(pointsByGroup) {
      const g = activeGame();
      const r = g && lastRound(g.id);
      if (!r || !['stopped', 'scored'].includes(r.phase)) throw bad('Es gibt gerade keine Runde zum Auswerten');
      const categories = JSON.parse(g.categories);
      const groups = all(`SELECT gr.id FROM game_groups gg JOIN groups gr ON gr.id = gg.group_id WHERE gg.game_id = ?`, g.id);
      tx(() => {
        run('DELETE FROM points WHERE ref = ?', `round:${r.id}`);
        for (const { id } of groups) {
          let sum = 0;
          categories.forEach((_, i) => {
            const p = Math.max(-100, Math.min(100, parseInt(pointsByGroup?.[id]?.[i], 10) || 0));
            sum += p;
            run(`INSERT INTO answers (round_id, group_id, idx, value, points) VALUES (?, ?, ?, '', ?)
                 ON CONFLICT(round_id, group_id, idx) DO UPDATE SET points = excluded.points`, r.id, id, i, p);
          });
          if (sum) {
            run(`INSERT INTO points (group_id, amount, reason, source, ref, created_at) VALUES (?, ?, ?, 'game', ?, ?)`,
              id, sum, `${g.title} · Runde ${r.no} (${r.letter})`, `round:${r.id}`, now());
          }
        }
        run("UPDATE rounds SET phase = 'scored' WHERE id = ?", r.id);
      });
      io.emit('refresh', 'points');
      broadcast();
    },

    finish() {
      const g = activeGame();
      if (!g) throw bad('Es läuft gerade kein Spiel');
      const r = lastRound(g.id);
      if (r && ['countdown', 'playing'].includes(r.phase)) throw bad('Zuerst die laufende Runde stoppen');
      run("UPDATE games SET status = 'finished' WHERE id = ?", g.id);
      clearTimeout(timer);
      broadcast();
    },
  };
}
