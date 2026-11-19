// Jesus First Camp App – Frontend (ohne Build-Schritt, läuft direkt im Browser)

/* =========================================================
   Helfer
   ========================================================= */
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
const raw = (s) => new Raw(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const out = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(out).join('') : esc(v));
function html(strings, ...vals) {
  let s = strings[0];
  vals.forEach((v, i) => { s += out(v) + strings[i + 1]; });
  return raw(s);
}
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const set = (el, content) => { if (el) el.innerHTML = out(content); };
const go = (path) => { if (location.hash !== '#' + path) location.hash = path; else route(); };

const S = { me: null, config: null, game: null, offset: 0, socket: null, view: null, routeId: 0, demo: null };
// Demo-Version (GitHub Pages): Server läuft im Browser, siehe demo/main.js
const DEMO = !!window.JFC_DEMO;
const now = () => Date.now() + S.offset;
const isAdmin = () => S.me?.user.role === 'admin';

async function api(method, url, body) {
  if (S.demo) {
    try {
      return await S.demo.api(method, url, body);
    } catch (e) {
      if (e.status === 401 && S.me && !url.endsWith('/login')) { S.me = null; go('/login'); }
      throw e;
    }
  }
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  let res;
  try { res = await fetch(url, opts); } catch { throw new Error('Keine Verbindung – bist du online?'); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && S.me && !url.endsWith('/login')) { S.me = null; go('/login'); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Fehler'), { code: data.code, status: res.status });
  return data;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), type === 'error' ? 4200 : 2800);
}
const fail = (e) => toast(e.message || String(e), 'error');

// Formular-Button während Request sperren
async function busy(btn, fn) {
  if (btn?.disabled) return;
  if (btn) btn.disabled = true;
  try { return await fn(); } catch (e) { fail(e); } finally { if (btn) btn.disabled = false; }
}

const fmtDate = (ts) => new Date(ts).toLocaleString('de-CH', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const toLocalInput = (ts) => { if (!ts) return ''; const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const medal = (i) => ['🥇', '🥈', '🥉'][i] || String(i + 1);
const vibrate = (p) => { try { navigator.vibrate?.(p); } catch {} };

// Bilder vor dem Upload verkleinern (spart Datenvolumen im Camp-WLAN)
async function shrinkImage(file, max = 1600, quality = 0.85) {
  try {
    if (file.type === 'image/gif') return file;
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

// Bild gross anzeigen – mit Blättern (Wischen / Pfeiltasten) innerhalb eines [data-lb]-Bereichs
document.addEventListener('click', (e) => {
  const img = e.target.closest('img[data-full]');
  if (!img) return;
  const group = img.closest('[data-lb]');
  const imgs = group ? $$('img[data-full]', group) : [img];
  openLightbox(imgs.map((i) => ({
    full: i.dataset.full, cap: i.dataset.cap || '', sub: i.dataset.sub || '', id: i.dataset.photoId, kind: i.dataset.kind || 'photo', mine: i.dataset.mine === '1',
  })), imgs.indexOf(img));
});

function openLightbox(items, index) {
  let i = index;
  const box = document.createElement('div');
  box.className = 'lightbox';
  const show = () => {
    const it = items[i];
    box.innerHTML = out(html`
      <div class="lb-img"><img src="${it.full}" alt=""></div>
      ${items.length > 1 ? html`<button class="lb-nav lb-prev" data-nav="-1" aria-label="Zurück">‹</button><button class="lb-nav lb-next" data-nav="1" aria-label="Weiter">›</button>` : ''}
      <div class="lb-bar">
        <div class="lb-cap">${it.cap ? html`<b>${it.cap}</b>` : ''}${it.sub ? html`<span class="muted small">${it.sub}</span>` : ''}${items.length > 1 ? html`<div class="muted small">${i + 1} / ${items.length}</div>` : ''}</div>
        ${(isAdmin() || it.mine) && it.id ? html`<button class="btn sm danger" data-lbdel>Löschen</button>` : ''}
        <button class="btn sm" data-lbclose>Schliessen</button>
      </div>`);
  };
  const move = (d) => { if (items.length > 1) { i = (i + d + items.length) % items.length; show(); } };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') move(-1);
    if (e.key === 'ArrowRight') move(1);
  };
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey); };
  box.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) return move(Number(nav.dataset.nav));
    const del = e.target.closest('[data-lbdel]');
    if (del) {
      if (!confirm(isAdmin() ? 'Dieses Foto für alle löschen?' : 'Dein Foto löschen?')) return;
      return busy(del, async () => {
        // Challenge-Fotos → /api/photos, Fotos ohne Challenge (ICF Youth, Schnappschüsse) → /api/gallery
        await api('DELETE', items[i].kind === 'photo' ? `/api/photos/${items[i].id}` : `/api/gallery/${items[i].id}`);
        toast('Foto gelöscht');
        items.splice(i, 1);
        if (!items.length) return close();
        i = Math.min(i, items.length - 1);
        show();
      });
    }
    if (e.target.closest('[data-lbclose]') || e.target.classList.contains('lb-img')) close();
  });
  let x0 = null;
  box.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) move(dx < 0 ? 1 : -1);
  });
  document.addEventListener('keydown', onKey);
  show();
  document.body.append(box);
}

function modal(content) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal card">${out(content)}</div>`;
  bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) bg.remove(); });
  document.body.append(bg);
  return bg;
}

/* =========================================================
   Router & Layout
   ========================================================= */
const routes = [
  { path: '/login', view: viewLogin, public: true, bare: true },
  { path: '/registrieren', view: viewRegister, public: true, bare: true },
  { path: '/passwort-vergessen', view: viewForgot, public: true, bare: true },
  { path: '/bestaetigen', view: viewVerify, any: true, bare: true },
  { path: '/passwort-neu', view: viewReset, any: true, bare: true },
  { path: '/', view: viewHome, tab: 'home' },
  { path: '/challenges', view: viewChallenges, tab: 'challenges' },
  { path: '/galerie', view: viewGallery, tab: 'challenges' },
  { path: '/ankuendigungen', view: viewAnnouncements, tab: 'home' },
  { path: '/admin/ankuendigungen', view: viewAnnouncementsAdmin, admin: true, tab: 'admin' },
  { path: '/challenges/:id', view: viewChallenge, tab: 'challenges' },
  { path: '/spiel', view: viewGame, tab: 'spiel' },
  { path: '/rangliste', view: viewLeaderboard, tab: 'rangliste' },
  { path: '/admin', view: viewAdmin, admin: true, tab: 'admin' },
  { path: '/admin/challenge/neu', view: viewChallengeEdit, admin: true, tab: 'admin' },
  { path: '/admin/challenge/:id', view: viewChallengeEdit, admin: true, tab: 'admin' },
  { path: '/admin/bewerten', view: viewReview, admin: true, tab: 'admin' },
  { path: '/admin/punkte', view: viewPoints, admin: true, tab: 'admin' },
  { path: '/admin/gruppen', view: viewGroups, admin: true, tab: 'admin' },
  { path: '/beamer', view: viewBeamer, bare: true, wide: true },
];

function matchPath(pattern, path) {
  const a = pattern.split('/'), b = path.split('?')[0].split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

async function route() {
  const path = location.hash.slice(1) || '/';
  let r, params;
  for (const x of routes) { params = matchPath(x.path, path); if (params) { r = x; break; } }
  if (!r) return go('/');
  params.query = new URLSearchParams(path.split('?')[1] || '');
  if (!r.public && !r.any && !S.me) return go('/login');
  if (r.public && S.me) return go('/');
  if (r.admin && !isAdmin()) return go('/');
  S.view?.destroy?.();
  S.view = null;
  const id = ++S.routeId;
  const main = shell(r);
  window.scrollTo(0, 0);
  try {
    const ctl = (await r.view(main, params)) || {};
    if (id === S.routeId) S.view = ctl; else ctl.destroy?.();
  } catch (e) {
    if (id === S.routeId) set(main, html`<div class="empty"><div class="big">😕</div>${e.message}</div>`);
  }
}

function shell(r) {
  const app = $('#app');
  if (r.bare) {
    app.innerHTML = `<main id="main" class="bare ${r.wide ? 'wide' : ''}"></main>`;
    return $('#main');
  }
  const tabs = [
    ['home', '/', '🏠', 'Home'],
    ['challenges', '/challenges', '📸', 'Challenges'],
    ['spiel', '/spiel', '🔤', isAdmin() ? 'Spiel' : 'Stadt Land Youth'],
    ['rangliste', '/rangliste', '🏆', 'Rangliste'],
    ...(isAdmin() ? [['admin', '/admin', '🛠️', 'Admin']] : []),
  ];
  app.innerHTML = out(html`
    <header class="topbar">
      <a class="logo" href="#/"><img src="logo-96.png" alt="JFC"><span>Jesus First Camp</span></a>
      <div class="grow"></div>
      <span class="group-chip">${isAdmin() ? '🛠️ Admin' : S.me.group ? `👥 ${S.me.group.name}` : 'Keine Smallgroup'}</span>
      ${DEMO ? html`<button class="demo-chip" data-demo-menu>DEMO</button>` : html`<span class="conn ${S.socket?.connected ? '' : 'off'}" id="conn" title="Live-Verbindung"></span>`}
    </header>
    <main id="main"></main>
    <nav class="tabbar">
      ${tabs.map(([key, href, ic, label]) => html`<a href="#${href}" class="${r.tab === key ? 'active' : ''}" data-tab="${key}"><span class="ic">${ic}</span>${label}</a>`)}
    </nav>`);
  updateLiveDot();
  return $('#main');
}

function updateLiveDot() {
  const a = $('.tabbar a[data-tab="spiel"]');
  if (!a) return;
  const live = !!S.game?.game;
  let dot = $('.live', a);
  if (live && !dot) { dot = document.createElement('i'); dot.className = 'live'; a.append(dot); }
  if (!live && dot) dot.remove();
}

/* =========================================================
   Echtzeit-Verbindung
   ========================================================= */
function connectSocket() {
  if (S.socket) return;
  S.socket = S.demo ? S.demo.socket() : io({ transports: ['websocket', 'polling'] });
  const conn = (on) => $('#conn')?.classList.toggle('off', !on);
  S.socket.on('connect', () => conn(true));
  S.socket.on('disconnect', () => conn(false));
  S.socket.on('game:state', (s) => {
    S.offset = s.serverNow - Date.now();
    S.game = s;
    updateLiveDot();
    S.view?.onGame?.(s);
  });
  S.socket.on('game:answer', (p) => S.view?.onAnswer?.(p));
  S.socket.on('game:stopped', (p) => {
    vibrate([200, 80, 200]);
    S.view?.onStopped?.(p);
    if (!S.view?.onStopped && S.game?.joined) toast(`🛑 STOPP! ${p.by ? p.by + ' war am schnellsten' : 'Runde vorbei'}`);
  });
  S.socket.on('refresh', (topic) => S.view?.onRefresh?.(topic));
  S.socket.on('announcement:new', (p) => {
    if (p.userId === S.me?.user.id) return;
    toast(`${p.kind === 'event' ? '⚡ Quick-Event' : p.kind === 'challenge' ? '📸' : '📢'}: ${p.title}`);
  });
  S.socket.on('photo:new', (p) => {
    if (!p?.groupName || p.userId === S.me?.user.id) return;
    const n = p.count > 1 ? `${p.count} neue Fotos` : 'neues Foto';
    if (p.official) toast(`⭐ ${p.count > 1 ? `${p.count} neue Fotos` : 'Neues Foto'} vom ICF Youth${p.caption ? `: ${p.caption}` : ''}`);
    else if (p.snapshot) toast(`📸 ${p.by}${p.groupName !== p.by ? ` (${p.groupName})` : ''} hat ${p.count > 1 ? `${p.count} Fotos` : 'ein Foto'} geteilt${p.caption ? `: ${p.caption}` : ''}`);
    else toast(`📷 ${p.groupName}: ${n} bei «${p.challengeTitle}»`);
  });
}
function disconnectSocket() {
  S.socket?.disconnect();
  S.socket = null;
  S.game = null;
}

/* =========================================================
   Login & Registrierung
   ========================================================= */
const brandHtml = () => html`
  <div class="brand"><img src="logo.png" alt="JFC Logo"><div><b>Jesus<br>First Camp</b><small>ICF Youth Zürich · 26/27</small></div></div>`;
const authPage = (content) => html`<div class="auth-wrap"><div class="auth">${brandHtml()}${content}</div></div>`;

async function refreshMe() {
  const me = await api('GET', '/api/me');
  S.me = me.user ? me : null;
  return S.me;
}

async function viewLogin(main) {
  set(main, authPage(html`
    <form class="card" id="f">
      <h2>Einloggen</h2>
      <label class="field"><span>E-Mail</span><input class="input" name="email" type="text" inputmode="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>
      <label class="field"><span>Passwort</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <div data-msg></div>
      <button class="btn primary block big">Los geht's</button>
      <p class="center small" style="margin:14px 0 0"><a href="#/passwort-vergessen">Passwort vergessen?</a></p>
    </form>
    <p class="center muted" style="margin-top:18px">Noch kein Konto? <a href="#/registrieren">Jetzt registrieren</a></p>
    ${DEMO ? html`
      <div class="card demo-card section">
        <h3>🧪 Demo-Version</h3>
        <p class="small muted">Alles läuft nur auf diesem Handy – keine echten Daten, keine Mails. Zwei Bot-Smallgroups spielen mit.</p>
        <div class="row"><button class="btn primary grow" data-demo-as="user">Als Teilnehmer:in</button><button class="btn grow" data-demo-as="admin">Als Admin</button></div>
        <p class="small muted" style="margin:10px 0 0">Logins: <b>lea@demo.ch</b> / demo1234 · Admin: <b>admin</b> / admin. Oder oben neu registrieren (ohne Mail-Bestätigung).</p>
      </div>` : ''}`));
  $$('[data-demo-as]', main).forEach((b) => (b.onclick = () => demoSwitch(b.dataset.demoAs)));
  const form = $('#f', main);
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const msg = $('[data-msg]', main);
    set(msg, '');
    busy(e.submitter, async () => {
      try {
        await api('POST', '/api/login', f);
      } catch (err) {
        if (err.code === 'unverified') return showResend(msg, f.email, err.message);
        throw err;
      }
      await afterLogin();
    });
  };
}

function showResend(el, email, message) {
  set(el, html`<div class="notice" style="margin-bottom:12px">${message}
    <div style="margin-top:10px"><button type="button" class="btn sm" data-resend>Bestätigungs-Mail nochmals senden</button></div></div>`);
  const b = $('[data-resend]', el);
  b.onclick = () => busy(b, async () => {
    await api('POST', '/api/resend', { email });
    toast('Mail ist unterwegs – schau auch im Spam-Ordner nach.', 'ok');
  });
}

async function afterLogin() {
  await refreshMe();
  disconnectSocket();
  connectSocket();
  syncPush();
  go('/');
}

function groupPicker(mode = 'join') {
  return html`
    <div class="seg" data-seg>
      <button type="button" data-mode="join" class="${mode === 'join' ? 'on' : ''}">Smallgroup beitreten</button>
      <button type="button" data-mode="create" class="${mode === 'create' ? 'on' : ''}">Neue erstellen</button>
    </div>
    <input type="hidden" name="groupMode" value="${mode}">
    <label class="field" data-for="join"><span>Code deiner Smallgroup</span>
      <input class="input code-input" name="groupCode" maxlength="5" placeholder="K7P2Q" autocomplete="off" autocapitalize="characters"></label>
    <label class="field hidden" data-for="create"><span>Name eurer Smallgroup</span>
      <input class="input" name="groupName" maxlength="40" placeholder="z.B. Die Löwen von Juda"></label>
    <p class="small muted" data-hint></p>`;
}
function bindGroupPicker(root) {
  const apply = (mode) => {
    $$('[data-seg] button', root).forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    $('[name=groupMode]', root).value = mode;
    $('[data-for=join]', root).classList.toggle('hidden', mode !== 'join');
    $('[data-for=create]', root).classList.toggle('hidden', mode !== 'create');
    $('[data-hint]', root).textContent = mode === 'join'
      ? 'Am einfachsten: Lass dir von deiner Smallgroup den Einladungslink schicken. Oder gib hier den Code ein.'
      : 'Nur EINE Person pro Smallgroup erstellt die Gruppe und lädt danach alle anderen mit einem Link ein.';
  };
  $$('[data-seg] button', root).forEach((b) => (b.onclick = () => apply(b.dataset.mode)));
  apply($('[name=groupMode]', root).value);
}

async function viewRegister(main, { query }) {
  // Einladungslink: /einladung/CODE → #/registrieren?code=CODE
  const code = (query.get('code') || '').trim().toUpperCase();
  const inviteName = code ? await api('GET', `/api/invite/${encodeURIComponent(code)}`).then((r) => r.name).catch(() => null) : null;
  set(main, authPage(html`
    <form class="card" id="f">
      <h2>Registrieren</h2>
      ${inviteName ? html`<div class="notice invite"><span class="ic">👥</span><div>Du wurdest in die Smallgroup <b>${inviteName}</b> eingeladen.</div></div>`
        : code ? html`<div class="notice error" style="margin-bottom:14px">Dieser Einladungslink ist ungültig. Frag deine Smallgroup nach einem neuen.</div>` : ''}
      ${S.config.registrationCode ? html`<label class="field"><span>Camp-Code (bekommst du vor Ort)</span><input class="input" name="regCode" required autocomplete="off"></label>` : ''}
      <label class="field"><span>Dein Name</span><input class="input" name="displayName" maxlength="40" required placeholder="Vorname + Initial, z.B. Lea M." autocomplete="name"></label>
      <label class="field"><span>E-Mail</span><input class="input" name="email" type="email" maxlength="120" required autocapitalize="none" spellcheck="false" autocomplete="email"></label>
      <label class="field"><span>Passwort (mind. 8 Zeichen)</span><input class="input" name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      ${inviteName ? html`<input type="hidden" name="groupMode" value="join"><input type="hidden" name="groupCode" value="${code}">`
        : html`<h3 style="margin-top:18px">Deine Smallgroup</h3>${groupPicker('join')}`}
      <div data-msg></div>
      <button class="btn primary block big">Konto erstellen</button>
    </form>
    <p class="center muted" style="margin-top:18px">Schon ein Konto? <a href="#/login">Einloggen</a></p>`));
  const form = $('#f', main);
  if (!inviteName) bindGroupPicker(form);
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const msg = $('[data-msg]', main);
    set(msg, '');
    busy(e.submitter, async () => {
      let res;
      try {
        res = await api('POST', '/api/register', f);
      } catch (err) {
        if (err.code === 'unverified') return showResend(msg, f.email, err.message);
        throw err;
      }
      if (!res.verify) {
        await afterLogin();
        if (f.groupMode === 'create') showGroupCode();
        return;
      }
      showCheckMail(main, res.email, res.mailError);
    });
  };
}

function showCheckMail(main, email, mailError) {
  set(main, authPage(html`
    <div class="card center">
      <div style="font-size:46px">📬</div>
      <h2>Check deine Mails!</h2>
      ${mailError ? html`<div class="notice error" style="margin-bottom:12px">Die Mail konnte gerade nicht gesendet werden. Versuch es mit dem Button unten nochmals.</div>` : ''}
      <p>Wir haben eine Mail an <b>${email}</b> geschickt. Klick auf den Link darin, dann ist dein Konto aktiv.</p>
      <p class="small muted">Nichts bekommen? Schau im Spam-Ordner nach.</p>
      <button class="btn block" data-resend>Mail nochmals senden</button>
    </div>
    <p class="center muted" style="margin-top:18px"><a href="#/login">Zum Login</a></p>`));
  window.scrollTo(0, 0);
  const b = $('[data-resend]', main);
  b.onclick = () => busy(b, async () => {
    await api('POST', '/api/resend', { email });
    toast('Mail ist unterwegs ✔', 'ok');
  });
}

async function viewVerify(main, { query }) {
  set(main, authPage(html`<div class="card center" data-box><p>Einen Moment …</p></div>`));
  try {
    await api('POST', '/api/verify', { token: query.get('token') || '' });
    await afterLogin();
    toast('E-Mail bestätigt – willkommen! 🎉', 'ok');
    if (S.me?.group?.isCreator && S.me.group.members.length <= 1) showGroupCode();
  } catch (e) {
    set($('[data-box]', main), html`<div style="font-size:40px">😕</div><p>${e.message}</p><a class="btn primary block" href="#/login">Zum Login</a>`);
  }
}

async function viewForgot(main) {
  set(main, authPage(html`
    <form class="card" id="f">
      <h2>Passwort vergessen</h2>
      <p class="small muted">Gib deine E-Mail ein. Wir schicken dir einen Link, mit dem du ein neues Passwort festlegen kannst.</p>
      <label class="field"><span>E-Mail</span><input class="input" name="email" type="email" required autocapitalize="none" spellcheck="false" autocomplete="email"></label>
      <button class="btn primary block big">Link senden</button>
    </form>
    <p class="center muted" style="margin-top:18px"><a href="#/login">Zurück zum Login</a></p>`));
  const form = $('#f', main);
  form.onsubmit = (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    busy(e.submitter, async () => {
      await api('POST', '/api/forgot', f);
      set(form, html`<div class="center"><div style="font-size:46px">📬</div><h2>Check deine Mails!</h2>
        <p>Falls es ein Konto mit <b>${f.email}</b> gibt, ist jetzt ein Link unterwegs. Er ist 2 Stunden gültig.</p>
        <p class="small muted" style="margin:0">Nichts bekommen? Schau im Spam-Ordner nach.</p></div>`);
    });
  };
}

async function viewReset(main, { query }) {
  set(main, authPage(html`
    <form class="card" id="f">
      <h2>Neues Passwort</h2>
      <label class="field"><span>Neues Passwort (mind. 8 Zeichen)</span><input class="input" name="password" type="password" minlength="8" required autocomplete="new-password"></label>
      <label class="check small" style="margin:-4px 0 14px"><input type="checkbox" data-show> Passwort anzeigen</label>
      <button class="btn primary block big">Speichern</button>
    </form>`));
  const form = $('#f', main);
  const pw = form.elements.namedItem('password');
  $('[data-show]', main).onchange = (e) => { pw.type = e.target.checked ? 'text' : 'password'; };
  form.onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      await api('POST', '/api/reset', { token: query.get('token') || '', password: pw.value });
      await afterLogin();
      toast('Passwort geändert ✔', 'ok');
    });
  };
}

const inviteLink = (g) => (DEMO ? `${location.href.split('#')[0]}#/registrieren?code=${g.code}` : `${location.origin}/einladung/${g.code}`);

function showGroupCode() {
  const g = S.me?.group;
  if (!g) return;
  const m = modal(html`
    <h2>Smallgroup «${g.name}» ist bereit 🎉</h2>
    <p>Lade jetzt deine Smallgroup ein: Wer den Link öffnet und sich registriert, landet direkt in eurer Gruppe.</p>
    <div class="card center" style="margin:12px 0"><div class="small muted">Code (falls jemand ihn eintippen will)</div><div class="join-code">${g.code}</div></div>
    <div class="row"><button class="btn primary grow" data-share>📨 Einladen</button><button class="btn grow" data-close>Später</button></div>`);
  $('[data-share]', m).onclick = () => shareCode(g);
}
async function shareCode(g) {
  const link = inviteLink(g);
  const text = `Tritt unserer Smallgroup «${g.name}» in der Jesus First Camp App bei 🙌`;
  try {
    if (navigator.share) await navigator.share({ title: 'Jesus First Camp', text, url: link });
    else { await navigator.clipboard.writeText(`${text}\n${link}`); toast('Einladungslink kopiert ✔', 'ok'); }
  } catch (e) {
    if (e?.name !== 'AbortError') prompt('Einladungslink kopieren:', link);
  }
}

/* =========================================================
   Home
   ========================================================= */
/* ---------- Ankündigungen ---------- */
function timeAgo(ts) {
  const min = Math.round((Date.now() - ts) / 60_000);
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  if (min < 24 * 60) return `vor ${Math.round(min / 60)} Std.`;
  return fmtDate(ts);
}
function fmtEventTime(ts) {
  const d = new Date(ts);
  const day = (offset) => { const x = new Date(); x.setDate(x.getDate() + offset); return x.toDateString(); };
  const time = d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === day(0)) return `Heute, ${time}`;
  if (d.toDateString() === day(1)) return `Morgen, ${time}`;
  return fmtDate(ts);
}
const ANN_KIND = { event: '⚡ Quick-Event', challenge: '📸 Neue Challenge', info: '📢 Ankündigung' };
// Rückmeldung nach dem Versand: wie viele Geräte die Push-Nachricht bekommen haben
const pushInfo = (p) => (!p ? '' : p.total ? ` · Push an ${plural(p.sent, 'Gerät', 'Geräte')}` : ' · (noch niemand hat Push aktiviert)');
function announcementCard(a, { admin = false } = {}) {
  const event = a.kind === 'event';
  const past = event && a.eventAt && Date.now() > a.eventAt + 3 * 3_600_000;
  const inner = html`
    <div class="ann-top"><span class="ann-kind">${ANN_KIND[a.kind] || ANN_KIND.info}${past ? ' · vorbei' : ''}</span><span class="ann-ago">${timeAgo(a.createdAt)}</span></div>
    <h3>${a.title}</h3>
    ${a.eventAt || a.location ? html`<div class="ann-meta">${a.eventAt ? html`<span>🕒 ${fmtEventTime(a.eventAt)}</span>` : ''}${a.location ? html`<span>📍 ${a.location}</span>` : ''}</div>` : ''}
    ${a.body ? html`<p class="ann-body">${a.body}</p>` : ''}
    ${admin ? html`<div class="ann-admin small"><span class="muted">${a.pushed ? '🔔 mit Push gesendet' : 'ohne Push'}</span><button class="btn sm danger" data-del-ann="${a.id}">Löschen</button></div>` : ''}`;
  const cls = `card ann ${event && !past ? 'event' : ''} ${past ? 'past' : ''}`;
  return a.link && !admin ? html`<a class="${cls}" href="${a.link}">${inner}</a>` : html`<div class="${cls}">${inner}</div>`;
}
function announcementsSection(news) {
  if (!news.items.length && !isAdmin()) return '';
  return html`
    <div class="section">
      <div class="row between" style="margin-bottom:10px"><h3 style="margin:0">📢 Ankündigungen</h3>
        ${isAdmin() ? html`<a class="btn sm primary" href="#/admin/ankuendigungen">+ Neu</a>` : news.total > news.items.length ? html`<a href="#/ankuendigungen" class="small">Alle (${news.total}) →</a>` : ''}</div>
      ${news.items.length ? html`<div class="ann-list">${news.items.map((a) => announcementCard(a))}</div>`
        : html`<div class="card empty" style="padding:20px">Noch keine Ankündigungen. Erstelle die erste – z.B. ein Quick-Event.</div>`}
    </div>`;
}

async function viewAnnouncements(main) {
  async function load() {
    const news = await api('GET', '/api/announcements?limit=50');
    set(main, html`<h1>Ankündigungen</h1>
      ${news.items.length ? html`<div class="ann-list">${news.items.map((a) => announcementCard(a))}</div>` : html`<div class="card empty">Noch keine Ankündigungen.</div>`}`);
  }
  await load();
  return { onRefresh: (t) => t === 'announcements' && load().catch(() => {}) };
}

async function viewAnnouncementsAdmin(main) {
  let kind = 'event';
  async function load() {
    const [news, stats] = await Promise.all([api('GET', '/api/announcements?limit=50'), api('GET', '/api/admin/push/stats')]);
    const soon = new Date(Date.now() + 30 * 60_000);
    soon.setMinutes(Math.ceil(soon.getMinutes() / 15) * 15, 0, 0);
    set(main, html`
      <a href="#/admin" class="small">← Admin</a>
      <h1 style="margin-top:12px">Ankündigungen</h1>
      <form class="card" id="af">
        <div class="seg"><button type="button" data-kind="event" class="${kind === 'event' ? 'on' : ''}">⚡ Quick-Event</button><button type="button" data-kind="info" class="${kind === 'info' ? 'on' : ''}">📢 Ankündigung</button></div>
        <label class="field"><span>Titel</span><input class="input" name="title" required maxlength="100" placeholder="${kind === 'event' ? 'z.B. Ping Pong Battle gegen ICF München' : 'z.B. Morgen-Programm startet 30 Min. später'}"></label>
        <label class="field"><span>Text (optional)</span><textarea class="input" name="body" maxlength="1000" rows="3" placeholder="Was, wer, was mitbringen …"></textarea></label>
        ${kind === 'event' ? html`<div class="row">
          <label class="field grow"><span>Wann</span><input class="input" name="eventAt" type="datetime-local" value="${toLocalInput(soon.getTime())}" required></label>
          <label class="field grow"><span>Wo</span><input class="input" name="location" maxlength="80" placeholder="z.B. Foyer The Hall"></label></div>` : ''}
        <label class="check" style="margin:4px 0 6px"><input type="checkbox" name="push" checked> <span>🔔 Push-Benachrichtigung an alle senden</span></label>
        <p class="small muted" style="margin:0 0 14px">${stats.devices ? `${plural(stats.devices, 'Gerät hat', 'Geräte haben')} Push aktiviert (${plural(stats.people, 'Person', 'Personen')}).` : 'Noch hat niemand Push aktiviert – die Ankündigung erscheint trotzdem bei allen in der App.'}</p>
        <button class="btn primary block big">Veröffentlichen</button>
      </form>
      <div class="section"><h3>Bisher</h3>
        ${news.items.length ? html`<div class="ann-list">${news.items.map((a) => announcementCard(a, { admin: true }))}</div>` : html`<div class="card empty">Noch keine Ankündigungen.</div>`}
      </div>`);
    $$('[data-kind]', main).forEach((b) => (b.onclick = () => { kind = b.dataset.kind; load().catch(fail); }));
    const form = $('#af', main);
    form.onsubmit = (e) => {
      e.preventDefault();
      const el = form.elements;
      busy(e.submitter, async () => {
        const at = el.namedItem('eventAt')?.value;
        const res = await api('POST', '/api/admin/announcements', {
          kind,
          title: el.namedItem('title').value,
          body: el.namedItem('body').value,
          eventAt: at ? new Date(at).toISOString() : null,
          location: el.namedItem('location')?.value || '',
          push: el.namedItem('push').checked,
        });
        toast(`Veröffentlicht ✔${pushInfo(res.push)}`, 'ok');
        await load();
      });
    };
    $$('[data-del-ann]', main).forEach((b) => (b.onclick = () => {
      if (confirm('Diese Ankündigung löschen?')) busy(b, async () => { await api('DELETE', `/api/admin/announcements/${b.dataset.delAnn}`); await load(); });
    }));
  }
  await load();
  return {};
}

/* ---------- Push-Benachrichtigungen ---------- */
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const b64ToBytes = (b64) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function pushStatus() {
  const supported = 'Notification' in window && 'serviceWorker' in navigator && (DEMO || 'PushManager' in window);
  if (!supported) return { supported: false };
  const permission = Notification.permission;
  let subscribed = false;
  if (permission === 'granted') {
    if (DEMO) subscribed = store.get('jfc-demo-push') === '1';
    else {
      const reg = await navigator.serviceWorker.getRegistration().catch(() => null);
      subscribed = !!(await reg?.pushManager.getSubscription().catch(() => null));
    }
  }
  return { supported, permission, subscribed };
}

async function pushPromptHtml() {
  if (store.get('jfc-push-later') && Number(store.get('jfc-push-later')) > Date.now()) return '';
  const st = await pushStatus();
  if (st.supported && st.permission === 'granted' && st.subscribed) return '';
  const later = html`<button class="btn sm ghost" data-push-later>Später</button>`;
  if (!st.supported) {
    if (!isIOS() || isStandalone()) return '';
    return html`<div class="card section push-card"><span class="ic">🔔</span><div class="grow">
      <b>Benachrichtigungen auf dem iPhone</b>
      <p class="small muted" style="margin:4px 0 8px">Damit du Quick-Events nicht verpasst: Tippe in Safari auf <b>Teilen</b> → <b>«Zum Home-Bildschirm»</b>, öffne die App von dort und aktiviere hier die Benachrichtigungen.</p>${later}</div></div>`;
  }
  if (st.permission === 'denied') {
    return html`<div class="card section push-card"><span class="ic">🔕</span><div class="grow"><b>Benachrichtigungen sind blockiert</b>
      <p class="small muted" style="margin:4px 0 8px">Du kannst sie in den Einstellungen deines Handys bzw. Browsers für diese App wieder erlauben.</p>${later}</div></div>`;
  }
  return html`<div class="card section push-card"><span class="ic">🔔</span><div class="grow">
    <b>Push-Benachrichtigungen aktivieren</b>
    <p class="small muted" style="margin:4px 0 10px">Damit du neue Challenges und spontane Quick-Events sofort mitbekommst – auch wenn die App zu ist.</p>
    <div class="row"><button class="btn primary sm" data-push-enable>Aktivieren</button>${later}</div></div></div>`;
}

function bindPushPrompt(root, rerender) {
  $('[data-push-later]', root)?.addEventListener('click', () => { store.set('jfc-push-later', String(Date.now() + 3 * 24 * 3_600_000)); rerender(); });
  const b = $('[data-push-enable]', root);
  if (b) b.onclick = () => busy(b, async () => { if (await enablePush()) rerender(); });
}

async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { toast('Ohne Erlaubnis gibt es leider keine Push-Benachrichtigungen.', 'error'); return false; }
  await subscribePush();
  toast('🔔 Push-Benachrichtigungen sind aktiv', 'ok');
  return true;
}

// Abo beim Server (neu) anmelden – auch nach jedem Login, damit es zum richtigen Konto gehört
async function subscribePush() {
  if (DEMO) {
    await api('POST', '/api/push/subscribe', { endpoint: 'demo-local', keys: { p256dh: 'demo', auth: 'demo' } });
    store.set('jfc-demo-push', '1');
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { publicKey } = await api('GET', '/api/push/key');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  }
  await api('POST', '/api/push/subscribe', sub.toJSON());
}
async function syncPush() {
  try {
    const st = await pushStatus();
    if (st.supported && st.permission === 'granted' && (st.subscribed || DEMO)) await subscribePush();
  } catch {}
}

async function viewHome(main) {
  async function load() {
    const [me, lb, challenges, gallery, news, pushCard] = await Promise.all([refreshMe(), api('GET', '/api/leaderboard'), api('GET', '/api/challenges'),
      api('GET', '/api/gallery?limit=6'), api('GET', '/api/announcements?limit=3'), pushPromptHtml()]);
    if (!me) return go('/login');
    const g = me.group;
    const rankIdx = g ? lb.groups.findIndex((x) => x.id === g.id) : -1;
    const myRow = rankIdx >= 0 ? lb.groups[rankIdx] : null;
    const open = challenges.filter((c) => c.published && c.myPoints === null && !c.myPhotos);
    const game = S.game?.game;

    set(main, html`
      <div class="hello">Hey ${me.user.name.split(' ')[0]} 👋</div>
      ${game ? html`<a class="card accent live-banner" href="#/spiel"><span class="pulse"></span><div class="grow"><b>${game.title} läuft!</b><div class="small muted">${S.game.joined || isAdmin() ? 'Zum Spiel →' : 'Jetzt mit deiner Smallgroup beitreten →'}</div></div></a>` : ''}

      ${announcementsSection(news)}
      ${pushCard}

      ${isAdmin() ? html`
        <div class="section"><a class="card link" href="#/admin"><h3>🛠️ Admin-Bereich</h3><p class="muted small" style="margin:0">Challenges erstellen, bewerten, Punkte & Bonus vergeben, Spiel steuern.</p></a></div>`
      : g ? html`
        <div class="section stats">
          <div class="stat"><div class="n">${lb.hidden ? '?' : myRow?.total ?? 0}</div><div class="l">Punkte</div></div>
          <div class="stat"><div class="n">${lb.hidden ? '?' : rankIdx >= 0 ? `${rankIdx + 1}.` : '–'}</div><div class="l">Rang von ${lb.hidden ? '?' : lb.groups.length}</div></div>
        </div>
        <div class="card section">
          <div class="row between"><h3 style="margin:0">👥 ${g.name}</h3><button class="btn sm ghost" data-switch>Wechseln</button></div>
          <div class="chips" style="margin:12px 0">${g.members.map((m) => html`<span class="chip ${m.id === me.user.id ? 'me' : ''}">${m.name}</span>`)}</div>
          ${g.members.length <= 1 ? html`<p class="small muted">Noch bist du allein – lade deine Smallgroup ein!</p>` : ''}
          <div class="row between"><div><div class="small muted">Code</div><div class="join-code">${g.code}</div></div>
            <button class="btn ${g.members.length <= 1 ? 'primary' : ''}" data-share>📨 Einladen</button></div>
        </div>`
      : html`
        <form class="card section" id="gf">
          <h3>Du bist in keiner Smallgroup</h3>
          <p class="muted small">Tritt deiner Smallgroup bei oder erstelle eine neue.</p>
          ${groupPicker('join')}
          <button class="btn primary block">Speichern</button>
        </form>`}

      ${!isAdmin() ? html`
        <div class="section">
          <div class="row between"><h3 style="margin:0">📸 Offene Challenges</h3><a href="#/challenges" class="small">Alle →</a></div>
          <div class="ch-list" style="margin-top:10px">
            ${open.length ? open.slice(0, 3).map(challengeItem) : html`<div class="card empty">Alles erledigt – stark! 💪</div>`}
          </div>
        </div>` : ''}

      <div class="section">
        <div class="row between" style="margin-bottom:10px"><h3 style="margin:0">📷 Aus dem Camp</h3>
          ${isAdmin() ? html`<a href="#/galerie" class="small">Galerie →</a>` : html`<button class="btn sm" data-upload-snap>📸 Foto teilen</button>`}</div>
        ${gallery.photos.length ? html`
          <div class="photos strip-grid" data-lb>${gallery.photos.map(galleryTile)}</div>
          <a href="#/galerie" class="small" style="display:inline-block;margin-top:8px">Alle Fotos in der Galerie →</a>`
        : html`<div class="card empty" style="padding:22px">Noch keine Schnappschüsse – teile den ersten! 📸</div>`}
      </div>

      <button class="btn ghost block section" data-logout>Ausloggen</button>`);
    $('[data-logout]', main)?.addEventListener('click', logout);
    $$('[data-upload-snap]', main).forEach((b) => b.addEventListener('click', uploadModal));
    bindPushPrompt(main, () => load().catch(() => {}));

    $('[data-share]', main)?.addEventListener('click', () => shareCode(g));
    $('[data-switch]', main)?.addEventListener('click', switchGroupModal);
    const gf = $('#gf', main);
    if (gf) {
      bindGroupPicker(gf);
      gf.onsubmit = (e) => {
        e.preventDefault();
        busy(e.submitter, async () => {
          const f = Object.fromEntries(new FormData(gf));
          await api('POST', '/api/me/group', f);
          await refreshMe();
          if (f.groupMode === 'create') showGroupCode();
          route();
        });
      };
    }
  }
  await load();
  return {
    onRefresh: (t) => ['points', 'groups', 'challenges', 'gallery', 'announcements'].includes(t) && !$('.modal-bg') && load().catch(() => {}),
    onGame: () => { if (!!S.game?.game !== !!$('.live-banner', main)) load().catch(() => {}); },
  };
}

function switchGroupModal() {
  const m = modal(html`
    <form id="sw">
      <h2>Smallgroup wechseln</h2>
      <p class="small muted">Punkte gehören der Smallgroup, nicht dir – sie bleiben bei der alten Gruppe.</p>
      ${groupPicker('join')}
      <div class="row"><button class="btn primary grow">Wechseln</button><button type="button" class="btn grow" data-close>Abbrechen</button></div>
    </form>`);
  const f = $('#sw', m);
  bindGroupPicker(f);
  f.onsubmit = (e) => {
    e.preventDefault();
    busy(e.submitter, async () => {
      const data = Object.fromEntries(new FormData(f));
      await api('POST', '/api/me/group', data);
      await refreshMe();
      m.remove();
      if (data.groupMode === 'create') showGroupCode();
      route();
    });
  };
}

/* =========================================================
   Challenges
   ========================================================= */
function challengeStatus(c) {
  if (isAdmin()) {
    return html`${!c.published ? html`<span class="badge">Entwurf</span>` : ''}
      ${c.pending ? html`<span class="badge warn">${c.pending} zu bewerten</span>` : ''}
      <span class="badge">${plural(c.submitted, 'Einreichung', 'Einreichungen')}</span>`;
  }
  if (c.myPoints !== null) return html`<span class="badge ok">✔ ${signed(c.myPoints)} Punkte</span>`;
  if (c.myPhotos) return html`<span class="badge warn">Eingereicht · wird bewertet</span>`;
  if (c.deadline && now() > c.deadline) return html`<span class="badge danger">Deadline vorbei</span>`;
  return html`<span class="badge">Offen</span>`;
}
function challengeItem(c) {
  return html`
    <a class="card ch-item" href="#/challenges/${c.id}">
      <div class="ch-thumb" style="${c.thumb ? `background-image:url('${c.thumb}')` : ''}">${c.thumb ? '' : '📸'}</div>
      <div class="grow">
        <h3>${c.title}</h3>
        <div class="row" style="gap:6px">
          <span class="badge accent">${c.points} Pkt.</span>
          ${challengeStatus(c)}
        </div>
        ${c.deadline ? html`<div class="small muted" style="margin-top:6px">⏰ bis ${fmtDate(c.deadline)}</div>` : ''}
      </div>
    </a>`;
}

async function viewChallenges(main) {
  async function load() {
    const list = await api('GET', '/api/challenges');
    set(main, html`
      <div class="row between" style="margin-bottom:14px"><h1 style="margin:0">Challenges</h1>
        ${isAdmin() ? html`<a class="btn primary sm" href="#/admin/challenge/neu">+ Neue Challenge</a>` : ''}</div>
      ${chTabs('c')}
      <div class="ch-list">
        ${list.length ? list.map(challengeItem) : html`<div class="card empty"><div class="big">📸</div>Noch keine Challenges – bald geht's los!</div>`}
      </div>`);
  }
  await load();
  return { onRefresh: (t) => ['challenges', 'submissions', 'points'].includes(t) && load().catch(() => {}) };
}

const chTabs = (active) => html`<div class="seg"><a href="#/challenges" class="${active === 'c' ? 'on' : ''}">📸 Challenges</a><a href="#/galerie" class="${active === 'g' ? 'on' : ''}">🖼️ Galerie</a></div>`;

// Foto-Kachel in Galerie und Startseite – überall gleich, beschriftet mit der Smallgroup (bzw. "ICF Youth")
// Arten intern: official (vom Admin), snapshot (Teilnehmende), photo (Challenge-Einreichung)
const galleryTile = (p) => html`
  <div class="photo">
    <img src="${p.thumb}" data-full="${p.url}" data-cap="${p.groupName}" data-kind="${p.kind}" data-photo-id="${p.id}"
      data-mine="${p.kind === 'snapshot' && p.userId === S.me?.user.id ? '1' : ''}" loading="lazy" alt=""
      data-sub="${[p.caption || p.challengeTitle, p.by ? `von ${p.by}` : '', fmtDate(p.createdAt)].filter(Boolean).join(' · ')}">
    <span class="by"><b>${p.groupName}</b></span></div>`;

// Fotos teilen: Teilnehmende → Schnappschuss, Admin → Foto vom ICF Youth (entscheidet der Server)
function uploadModal() {
  const official = isAdmin();
  const m = modal(html`
    <h2>📸 Foto teilen</h2>
    <p class="small muted">${official ? 'Erscheint sofort bei allen in der Galerie – mit dem Namen «ICF Youth».'
      : 'Teile deine Camp-Momente – alle sehen sie sofort in der Galerie, mit dem Namen deiner Smallgroup. Deine eigenen Fotos kannst du jederzeit wieder löschen.'}</p>
    <label class="btn block upload-btn" style="margin-bottom:12px">📷 Fotos auswählen<input type="file" accept="image/*" multiple data-files></label>
    <div class="photos" data-previews style="margin-bottom:12px"></div>
    <label class="field"><span>Bildtext (optional)</span><input class="input" data-caption maxlength="120" placeholder="${official ? 'z.B. Worship Night in The Hall 🔥' : 'z.B. Pizza-Time mit der Smallgroup 🍕'}"></label>
    <div class="row"><button class="btn primary grow" data-send disabled>Hochladen</button><button class="btn grow" data-close>Abbrechen</button></div>
    <p class="small muted center" style="margin:10px 0 0" data-status></p>`);
  const input = $('[data-files]', m);
  const send = $('[data-send]', m);
  const status = $('[data-status]', m);
  input.onchange = () => {
    set($('[data-previews]', m), [...input.files].map((f) => html`<div class="photo"><img src="${URL.createObjectURL(f)}" alt=""></div>`));
    send.disabled = !input.files.length;
    send.textContent = input.files.length > 1 ? `${input.files.length} Fotos hochladen` : 'Hochladen';
  };
  send.onclick = () => busy(send, async () => {
    const fd = new FormData();
    status.textContent = 'Bereite Fotos vor …';
    for (const f of input.files) {
      fd.append('photos', await shrinkImage(f));
      fd.append('thumbs', await shrinkImage(f, 480, 0.75));
    }
    fd.append('caption', $('[data-caption]', m).value);
    status.textContent = 'Lade hoch …';
    try {
      await api('POST', '/api/gallery', fd);
    } catch (e) { status.textContent = ''; throw e; }
    m.remove();
    toast('Geteilt – alle sehen es jetzt 🎉', 'ok');
  });
}

// Galerie: ein Ort für alle Fotos aus dem Camp (neuste zuerst), jedes mit dem Namen der Smallgroup
async function viewGallery(main) {
  let photos = [];
  let more = false;
  async function load(reset = true) {
    const q = new URLSearchParams({ limit: 60 });
    const last = photos[photos.length - 1];
    if (!reset && last) q.set('before', `${last.createdAt}:${last.kind}:${last.id}`);
    const res = await api('GET', `/api/gallery?${q}`);
    photos = reset ? res.photos : photos.concat(res.photos);
    more = res.more;
    render();
  }
  function render() {
    set(main, html`
      <div class="row between" style="margin-bottom:14px"><h1 style="margin:0">Galerie</h1>
        <button class="btn primary sm" data-upload-snap>📸 Foto teilen</button></div>
      ${chTabs('g')}
      ${isAdmin() && photos.length ? html`<p class="small muted" style="margin:-4px 0 10px">🗑️ Foto antippen → «Löschen», um es für alle zu entfernen.</p>` : ''}
      ${photos.length ? html`
        <div class="photos gallery" data-lb>${photos.map(galleryTile)}</div>
        ${more ? html`<button class="btn block section" data-more>Mehr laden</button>` : ''}`
      : html`<div class="card empty"><div class="big">🖼️</div>Noch keine Fotos.<br>Teile deine Momente aus dem Camp – alle sehen sie hier.</div>`}`);
    $('[data-upload-snap]', main)?.addEventListener('click', uploadModal);
    const m = $('[data-more]', main);
    if (m) m.onclick = () => busy(m, () => load(false));
  }
  await load();
  let t;
  return {
    onRefresh: (topic) => {
      if (topic !== 'gallery' || $('.lightbox')) return;
      clearTimeout(t);
      t = setTimeout(() => load().catch(() => {}), 800);
    },
  };
}

function photoGrid(photos, { canDelete = false } = {}) {
  if (!photos?.length) return '';
  return html`<div class="photos" data-lb>${photos.map((p) => html`
    <div class="photo"><img src="${p.thumb || p.url}" data-full="${p.url}" data-cap="${p.by || ''}" loading="lazy" alt="">
      ${p.by ? html`<span class="by">${p.by}</span>` : ''}
      ${canDelete ? html`<button class="x" data-del-photo="${p.id}" aria-label="Bild löschen">✕</button>` : ''}</div>`)}</div>`;
}

// Bewertungs-Karte für Admins (Challenge-Detail und "Bewerten")
function submissionCard(s, { showChallenge = false } = {}) {
  const half = Math.round(s.maxPoints / 2);
  return html`
    <div class="card" data-sub="${s.id}">
      <div class="sub-head">
        <div><b>👥 ${s.groupName}</b>${showChallenge ? html`<div class="small muted">${s.challengeTitle}</div>` : ''}</div>
        ${s.points === null ? html`<span class="badge warn">offen</span>` : html`<span class="badge ok">✔ ${signed(s.points)}</span>`}
      </div>
      ${photoGrid(s.photos, { canDelete: true })}
      ${s.comment ? html`<p class="small" style="margin-top:10px">💬 ${s.comment}</p>` : ''}
      <div class="rate">
        <input class="input" type="number" inputmode="numeric" value="${s.points ?? ''}" placeholder="${s.maxPoints}" data-pts>
        <button class="btn sm" data-q="0">0</button>
        ${half && half !== s.maxPoints ? html`<button class="btn sm" data-q="${half}">${half}</button>` : ''}
        <button class="btn sm" data-q="${s.maxPoints}">${s.maxPoints}</button>
        <button class="btn sm primary" data-save>Speichern</button>
      </div>
    </div>`;
}
function bindSubmissionCards(root, reload) {
  $$('[data-sub]', root).forEach((card) => {
    const id = card.dataset.sub;
    const input = $('[data-pts]', card);
    $$('[data-q]', card).forEach((b) => (b.onclick = () => { input.value = b.dataset.q; }));
    $('[data-save]', card).onclick = (e) => busy(e.currentTarget, async () => {
      await api('POST', `/api/admin/submissions/${id}/points`, { points: input.value === '' ? null : Number(input.value) });
      toast('Punkte gespeichert ✔', 'ok');
      await reload();
    });
  });
  bindPhotoDelete(root, reload);
}
function bindPhotoDelete(root, reload) {
  $$('[data-del-photo]', root).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    if (!confirm('Bild wirklich löschen?')) return;
    busy(b, async () => { await api('DELETE', `/api/photos/${b.dataset.delPhoto}`); await reload(); });
  }));
}

async function viewChallenge(main, { id }) {
  async function load() {
    const { challenge: c, mine, all: subs } = await api('GET', `/api/challenges/${id}`);
    const closed = c.deadline && now() > c.deadline;
    const rated = mine && mine.points !== null;
    const hasGroup = !!S.me.group;
    set(main, html`
      <a href="#/challenges" class="small">← Alle Challenges</a>
      <div style="height:12px"></div>
      ${c.image ? html`<img class="ch-cover" src="${c.image}" data-full="${c.image}" alt="">` : ''}
      <div class="row" style="gap:6px;margin-bottom:10px"><span class="badge accent">${c.points} Punkte</span>
        ${c.deadline ? html`<span class="badge ${closed ? 'danger' : ''}">⏰ ${closed ? 'vorbei' : 'bis'} ${fmtDate(c.deadline)}</span>` : ''}
        ${!c.published ? html`<span class="badge">Entwurf (nur Admin sieht das)</span>` : ''}</div>
      <h1>${c.title}</h1>
      <div class="desc">${c.description}</div>

      ${isAdmin() ? html`
        <div class="section adminbar row between"><b>Admin</b><a class="btn sm" href="#/admin/challenge/${c.id}">✏️ Bearbeiten</a></div>
        <div class="section"><h3>Einreichungen (${subs.length})</h3>
          ${subs.length ? subs.map((s) => submissionCard(s)) : html`<div class="card empty">Noch keine Einreichungen.</div>`}
        </div>`
      : html`
        <div class="section card stack">
          <div class="row between"><h3 style="margin:0">Eure Einreichung</h3>
            ${rated ? html`<span class="badge ok">✔ ${signed(mine.points)} Punkte</span>` : mine?.photos.length ? html`<span class="badge warn">wird bewertet</span>` : ''}</div>
          ${!hasGroup ? html`<p class="muted">Tritt zuerst einer Smallgroup bei (Home).</p>` : ''}
          ${photoGrid(mine?.photos, { canDelete: !rated })}
          ${hasGroup && !rated && !closed ? html`
            <label class="btn primary block big upload-btn">📷 Foto hochladen<input type="file" accept="image/*" multiple data-upload></label>
            <div class="small muted center" data-upstatus>Alle aus deiner Smallgroup sehen eure Bilder. Bis zur Bewertung könnt ihr Bilder löschen.</div>
            ${mine?.photos.length ? html`
              <label class="field" style="margin:0"><span>Kommentar (optional)</span><textarea class="input" data-comment maxlength="500" placeholder="Was sollen die Leiter wissen?">${mine.comment}</textarea></label>
              <button class="btn sm" data-save-comment>Kommentar speichern</button>` : ''}`
          : rated ? html`<p class="muted small" style="margin:0">Bewertet – danke fürs Mitmachen! 🙌</p>`
          : closed ? html`<p class="muted small" style="margin:0">Die Deadline ist vorbei.</p>` : ''}
        </div>`}`);

    bindSubmissionCards(main, load);
    const up = $('[data-upload]', main);
    if (up) up.onchange = async () => {
      const files = [...up.files];
      if (!files.length) return;
      const status = $('[data-upstatus]', main);
      const label = up.closest('label');
      label.style.opacity = '.5';
      try {
        status.textContent = `Bereite ${plural(files.length, 'Bild', 'Bilder')} vor…`;
        const fd = new FormData();
        for (const f of files) {
          fd.append('photos', await shrinkImage(f));
          fd.append('thumbs', await shrinkImage(f, 480, 0.75));
        }
        status.textContent = 'Lade hoch…';
        await api('POST', `/api/challenges/${id}/photos`, fd);
        toast('Hochgeladen 🎉', 'ok');
        await load();
      } catch (e) { fail(e); status.textContent = ''; }
      label.style.opacity = '';
    };
    const sc = $('[data-save-comment]', main);
    if (sc) sc.onclick = () => busy(sc, async () => {
      await api('PUT', `/api/challenges/${id}/comment`, { comment: $('[data-comment]', main).value });
      toast('Gespeichert ✔', 'ok');
    });
  }
  await load();
  return { onRefresh: (t) => ['challenges', 'points'].includes(t) && load().catch(() => {}) };
}

/* =========================================================
   Rangliste
   ========================================================= */
async function viewLeaderboard(main) {
  const open = new Set();
  async function load() {
    const lb = await api('GET', '/api/leaderboard');
    if (lb.hidden && !isAdmin()) {
      set(main, html`<h1>Rangliste</h1><div class="card empty"><div class="big">🤫</div>Die Rangliste ist gerade versteckt.<br>Die Auflösung gibt's am Schluss!</div>`);
      return;
    }
    const myId = S.me.group?.id;
    set(main, html`
      <div class="row between" style="margin-bottom:14px"><h1 style="margin:0">Rangliste</h1>
        ${isAdmin() ? html`<button class="btn sm" data-toggle>${lb.hidden ? '🙈 Versteckt – zeigen' : '👀 Sichtbar – verstecken'}</button>` : ''}</div>
      <div class="lb">
        ${lb.groups.length ? lb.groups.map((g, i) => html`
          <div class="card lb-row ${g.id === myId ? 'me' : ''}" data-g="${g.id}">
            <div class="lb-rank">${medal(i)}</div>
            <div class="grow"><b>${g.name}</b><div class="small muted">${plural(g.members, 'Person', 'Personen')}</div></div>
            <div class="lb-pts">${g.total}</div>
            <div class="lb-detail ${open.has(g.id) ? '' : 'hidden'}" data-detail="${g.id}">
              📸 Challenges ${g.challenge} · 🔤 Spiel ${g.game} · ⭐ Bonus ${g.bonus}
              ${g.id === myId || isAdmin() ? html`<ul class="ledger" data-ledger="${g.id}"></ul>` : ''}
            </div>
          </div>`) : html`<div class="card empty">Noch keine Smallgroups.</div>`}
      </div>`);
    $$('[data-g]', main).forEach((row) => (row.onclick = () => {
      const gid = Number(row.dataset.g);
      if (open.has(gid)) open.delete(gid); else open.add(gid);
      $(`[data-detail="${gid}"]`, main).classList.toggle('hidden', !open.has(gid));
      if (open.has(gid)) loadLedger(gid);
    }));
    open.forEach(loadLedger);
    const t = $('[data-toggle]', main);
    if (t) t.onclick = () => busy(t, async () => { await api('POST', '/api/admin/settings', { leaderboardHidden: !lb.hidden }); await load(); });
  }
  async function loadLedger(gid) {
    const ul = $(`[data-ledger="${gid}"]`, main);
    if (!ul) return;
    const rows = await api('GET', `/api/groups/${gid}/points`).catch(() => []);
    set(ul, rows.length ? rows.map((r) => html`<li><span>${r.reason}</span><span class="amt ${r.amount < 0 ? 'neg' : ''}">${signed(r.amount)}</span></li>`) : html`<li>Noch keine Punkte</li>`);
  }
  await load();
  return { onRefresh: (t) => ['points', 'groups'].includes(t) && load().catch(() => {}) };
}

/* =========================================================
   Admin
   ========================================================= */
async function viewAdmin(main) {
  const [pending, groups] = await Promise.all([api('GET', '/api/admin/submissions?pending=1'), api('GET', '/api/admin/groups')]);
  const users = groups.groups.reduce((n, g) => n + g.users.length, 0) + groups.loose.filter((u) => u.role === 'user').length;
  set(main, html`
    <h1>Admin</h1>
    <div class="tiles">
      <a class="card tile" href="#/admin/ankuendigungen"><span class="ic">📢</span><b>Ankündigungen</b><span class="muted">Quick-Events & News, mit oder ohne Push</span></a>
      <a class="card tile" href="#/admin/challenge/neu"><span class="ic">➕</span><b>Neue Challenge</b><span class="muted">Titel, Beschrieb, Punkte, Bild, Deadline</span></a>
      <a class="card tile" href="#/admin/bewerten"><span class="ic">✅</span><b>Bewerten</b><span class="muted">${pending.length ? `${pending.length} Einreichungen offen` : 'Alles bewertet'}</span></a>
      <a class="card tile" href="#/spiel"><span class="ic">🔤</span><b>Stadt Land Youth</b><span class="muted">${S.game?.game ? 'Spiel läuft – steuern' : 'Neues Spiel starten'}</span></a>
      <a class="card tile" href="#/admin/punkte"><span class="ic">⭐</span><b>Bonuspunkte</b><span class="muted">Zusatz-Challenges & Korrekturen</span></a>
      <a class="card tile" href="#/admin/gruppen"><span class="ic">👥</span><b>Smallgroups</b><span class="muted">${plural(groups.groups.length, 'Gruppe', 'Gruppen')} · ${plural(users, 'Person', 'Personen')}</span></a>
      <a class="card tile" href="#/beamer" target="_blank"><span class="ic">📽️</span><b>Beamer-Ansicht</b><span class="muted">Für die Leinwand in der Halle</span></a>
      <a class="card tile" href="#/galerie"><span class="ic">🖼️</span><b>Galerie</b><span class="muted">Alle Fotos – unpassende kannst du löschen</span></a>
    </div>
    <div class="section card">
      <h3>Tipps</h3>
      <p class="small muted" style="margin:0">Die Beamer-Ansicht in einem eigenen Fenster auf dem Laptop öffnen (Vollbild mit F11). Sie zeigt automatisch das laufende Spiel oder die Rangliste.</p>
    </div>
    <button class="btn ghost block section" data-logout>Ausloggen</button>`);
  $('[data-logout]', main).onclick = logout;
}

async function viewChallengeEdit(main, params) {
  const editing = !!params.id;
  const c = editing ? (await api('GET', `/api/challenges/${params.id}`)).challenge : { title: '', description: '', points: 50, published: 1 };
  set(main, html`
    <a href="#/challenges" class="small">← Challenges</a>
    <h1 style="margin-top:12px">${editing ? 'Challenge bearbeiten' : 'Neue Challenge'}</h1>
    <form id="f" class="card">
      <label class="field"><span>Titel</span><input class="input" name="title" required maxlength="80" value="${c.title}" placeholder="z.B. Smallgroup-Selfie mit einem Leiter"></label>
      <label class="field"><span>Beschreibung / Infos</span><textarea class="input" name="description" maxlength="4000" placeholder="Was ist zu tun? Regeln, Tipps, Bibelvers …">${c.description}</textarea></label>
      <div class="row">
        <label class="field grow"><span>Punkte (max.)</span><input class="input" name="points" type="number" min="0" inputmode="numeric" value="${c.points}"></label>
        <label class="field grow"><span>Deadline (optional)</span><input class="input" name="deadline" type="datetime-local" value="${toLocalInput(c.deadline)}"></label>
      </div>
      <div class="field"><span>Titelbild</span>
        <div class="cover-preview"><img data-cover-img alt="Vorschau Titelbild"></div>
        <div class="row" style="margin-top:8px">
          <button type="button" class="btn sm" data-cover-auto>🎨 ${c.image ? 'Neu im JFC-Stil' : 'Andere Variante'}</button>
          <label class="btn sm upload-btn">📷 Eigenes Bild<input type="file" accept="image/*" name="image"></label>
        </div>
        <p class="small muted" style="margin:6px 0 0" data-cover-hint></p>
      </div>
      <label class="check" style="margin-bottom:10px"><input type="checkbox" name="published" ${c.published ? 'checked' : ''}> <span>Für alle sichtbar (sonst Entwurf)</span></label>
      <div class="adminbar" style="margin-bottom:16px;padding:12px">
        <label class="check" style="margin-bottom:8px"><input type="checkbox" name="announce" ${editing ? '' : 'checked'}> <span>📢 Auf der Startseite ankündigen</span></label>
        <label class="check"><input type="checkbox" name="push" ${editing ? '' : 'checked'}> <span>🔔 Push-Benachrichtigung an alle senden</span></label>
        ${editing ? html`<p class="small muted" style="margin:8px 0 0">Nur ankreuzen, wenn du die Änderung nochmals melden willst.</p>` : ''}
      </div>
      <button class="btn primary block big">${editing ? 'Speichern' : 'Challenge erstellen'}</button>
    </form>
    ${editing ? html`<button class="btn danger block section" data-del>Challenge löschen</button>` : ''}`);

  // Titelbild: automatisch im JFC-Stil (aus dem Titel), eigenes Foto oder bestehendes Bild behalten
  const { coverFiles } = await import('./cover.js');
  const titleInput = $('[name=title]', main);
  const fileInput = $('[name=image]', main);
  const preview = $('[data-cover-img]', main);
  const hint = $('[data-cover-hint]', main);
  const autoBtn = $('[data-cover-auto]', main);
  let mode = c.image ? 'keep' : 'auto';
  let variant = 0;
  let previewUrl = null;
  const showPreview = (src) => { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = src.startsWith('blob:') ? src : null; preview.src = src; };
  async function renderAuto() {
    const { image } = await coverFiles(titleInput.value || 'Neue Challenge', variant);
    if (mode === 'auto') showPreview(URL.createObjectURL(image));
  }
  function updateHint() {
    hint.textContent = mode === 'auto' ? 'Wird automatisch aus dem Titel erstellt. «Andere Variante» für ein anderes Design.'
      : mode === 'file' ? 'Dein eigenes Bild wird verwendet.' : 'Aktuelles Titelbild bleibt.';
    autoBtn.textContent = mode === 'auto' ? '🔄 Andere Variante' : '🎨 Im JFC-Stil erstellen';
  }
  if (mode === 'keep') preview.src = c.image; else renderAuto();
  updateHint();
  let typing;
  titleInput.addEventListener('input', () => { if (mode === 'auto') { clearTimeout(typing); typing = setTimeout(renderAuto, 250); } });
  autoBtn.onclick = () => { if (mode === 'auto') variant++; mode = 'auto'; fileInput.value = ''; updateHint(); renderAuto(); };
  fileInput.onchange = () => {
    const f = fileInput.files[0];
    if (!f) return;
    mode = 'file';
    showPreview(URL.createObjectURL(f));
    updateHint();
  };

  $('#f', main).onsubmit = (e) => {
    e.preventDefault();
    const form = e.target;
    busy(e.submitter, async () => {
      const el = form.elements;
      const fd = new FormData();
      fd.append('title', el.namedItem('title').value);
      fd.append('description', el.namedItem('description').value);
      fd.append('points', el.namedItem('points').value || '0');
      const dl = el.namedItem('deadline').value;
      fd.append('deadline', dl ? new Date(dl).toISOString() : '');
      fd.append('published', el.namedItem('published').checked ? '1' : '0');
      fd.append('announce', el.namedItem('announce').checked ? '1' : '0');
      fd.append('push', el.namedItem('push').checked ? '1' : '0');
      const img = fileInput.files[0];
      if (mode === 'file' && img) {
        fd.append('image', await shrinkImage(img, 1800));
        fd.append('thumb', await shrinkImage(img, 320, 0.75));
      } else if (mode === 'auto') {
        const cover = await coverFiles(el.namedItem('title').value, variant);
        fd.append('image', cover.image);
        fd.append('thumb', cover.thumb);
      }
      const res = await api(editing ? 'PUT' : 'POST', editing ? `/api/admin/challenges/${params.id}` : '/api/admin/challenges', fd);
      toast(`${editing ? 'Gespeichert ✔' : 'Challenge erstellt 🎉'}${pushInfo(res.push)}`, 'ok');
      go(`/challenges/${editing ? params.id : res.id}`);
    });
  };
  const del = $('[data-del]', main);
  if (del) del.onclick = () => {
    if (!confirm('Challenge inkl. aller Bilder und vergebenen Punkte löschen?')) return;
    busy(del, async () => { await api('DELETE', `/api/admin/challenges/${params.id}`); toast('Gelöscht'); go('/challenges'); });
  };
}

async function viewReview(main) {
  let tab = 'pending';
  async function load() {
    const subs = await api('GET', `/api/admin/submissions${tab === 'pending' ? '?pending=1' : ''}`);
    set(main, html`
      <h1>Bewerten</h1>
      <div class="seg"><button data-t="pending" class="${tab === 'pending' ? 'on' : ''}">Offen</button><button data-t="all" class="${tab === 'all' ? 'on' : ''}">Alle</button></div>
      ${subs.length ? subs.map((s) => submissionCard(s, { showChallenge: true })) : html`<div class="card empty"><div class="big">✅</div>Nichts zu bewerten.</div>`}`);
    $$('[data-t]', main).forEach((b) => (b.onclick = () => { tab = b.dataset.t; load(); }));
    bindSubmissionCards(main, load);
  }
  await load();
  let t;
  return { onRefresh: (topic) => { if (topic === 'submissions' && !main.contains(document.activeElement)) { clearTimeout(t); t = setTimeout(() => load().catch(() => {}), 500); } } };
}

async function viewPoints(main) {
  const selected = new Set();
  let amount = 10;
  async function load() {
    const [{ groups }, ledger] = await Promise.all([api('GET', '/api/admin/groups'), api('GET', '/api/admin/points')]);
    set(main, html`
      <h1>Bonuspunkte</h1>
      <form class="card" id="f">
        <div class="field"><span class="small muted" style="font-weight:600">Smallgroups (mehrere möglich)</span>
          <div class="chips" style="margin-top:8px">${groups.length ? groups.map((g) => html`<button type="button" class="chip ${selected.has(g.id) ? 'on' : ''}" data-g="${g.id}">${g.name}</button>`) : html`<span class="muted small">Noch keine Smallgroups</span>`}</div>
          ${groups.length > 1 ? html`<button type="button" class="btn sm ghost" style="margin-top:8px" data-allg>Alle auswählen</button>` : ''}
        </div>
        <div class="field"><span class="small muted" style="font-weight:600">Punkte</span>
          <div class="row" style="margin-top:8px">
            ${[5, 10, 20, 50].map((n) => html`<button type="button" class="chip ${amount === n ? 'on' : ''}" data-a="${n}">+${n}</button>`)}
            <input class="input" style="width:100px;min-height:38px;padding:6px 10px" type="number" inputmode="numeric" name="amount" value="${amount}">
          </div>
          <p class="small muted" style="margin:6px 0 0">Negativ für Abzug, z.B. -10</p>
        </div>
        <label class="field"><span>Grund</span><input class="input" name="reason" list="reasons" required maxlength="120" placeholder="z.B. Zusatz-Challenge: Lobpreis-Flashmob"></label>
        <datalist id="reasons"><option value="Zusatz-Challenge"><option value="Bei der Abendaktion dabei"><option value="Pünktlich beim Programm"><option value="Spezialauftrag erledigt"></datalist>
        <button class="btn primary block big">Punkte vergeben</button>
      </form>
      <div class="section"><h3>Verlauf</h3>
        <div class="card"><ul class="ledger" style="margin:0">
          ${ledger.length ? ledger.map((p) => html`<li><span><b>${p.groupName}</b> · ${p.reason}<br><span class="muted small">${fmtDate(p.createdAt)} · ${({ bonus: '⭐ Bonus', challenge: '📸 Challenge', game: '🔤 Spiel' })[p.source]}</span></span>
            <span class="row" style="flex-wrap:nowrap"><span class="amt ${p.amount < 0 ? 'neg' : ''}">${signed(p.amount)}</span>${p.source === 'bonus' ? html`<button class="btn sm ghost" data-del="${p.id}" aria-label="Löschen">✕</button>` : ''}</span></li>`) : html`<li>Noch keine Punkte vergeben</li>`}
        </ul></div></div>`);
    const form = $('#f', main);
    const amountEl = form.elements.namedItem('amount');
    const reasonEl = form.elements.namedItem('reason');
    $$('[data-g]', main).forEach((b) => (b.onclick = () => { const id = Number(b.dataset.g); selected.has(id) ? selected.delete(id) : selected.add(id); b.classList.toggle('on'); }));
    $('[data-allg]', main)?.addEventListener('click', () => { groups.forEach((g) => selected.add(g.id)); $$('[data-g]', main).forEach((b) => b.classList.add('on')); });
    $$('[data-a]', main).forEach((b) => (b.onclick = () => { amount = Number(b.dataset.a); amountEl.value = amount; $$('[data-a]', main).forEach((x) => x.classList.toggle('on', x === b)); }));
    amountEl.oninput = () => { amount = Number(amountEl.value); $$('[data-a]', main).forEach((x) => x.classList.toggle('on', Number(x.dataset.a) === amount)); };
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!selected.size) return toast('Mindestens eine Smallgroup auswählen', 'error');
      busy(e.submitter, async () => {
        await api('POST', '/api/admin/points', { groupIds: [...selected], amount: Number(amountEl.value), reason: reasonEl.value });
        toast(`${signed(Number(amountEl.value))} Punkte an ${plural(selected.size, 'Smallgroup', 'Smallgroups')} ✔`, 'ok');
        selected.clear();
        await load();
      });
    };
    $$('[data-del]', main).forEach((b) => (b.onclick = () => {
      if (!confirm('Diesen Bonus-Eintrag löschen?')) return;
      busy(b, async () => { await api('DELETE', `/api/admin/points/${b.dataset.del}`); await load(); });
    }));
  }
  await load();
  return {};
}

async function viewGroups(main) {
  const open = new Set();
  async function load() {
    const { groups, loose, mailConfigured } = await api('GET', '/api/admin/groups');
    const pending = [...groups.flatMap((g) => g.users.map((u) => ({ ...u, gid: g.id }))), ...loose.filter((u) => u.role === 'user').map((u) => ({ ...u, gid: null }))]
      .filter((u) => !u.verified);
    const options = (sel) => html`<option value="">– keine –</option>${groups.map((g) => html`<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${g.name}</option>`)}`;
    const member = (u, gid) => html`
      <div class="member"><div class="who"><b>${u.name}</b> ${u.verified ? '' : html`<span class="badge warn">nicht bestätigt</span>`}<span class="muted small">${u.email}</span></div>
        ${u.verified ? '' : html`<button class="btn sm" data-verify="${u.id}" title="E-Mail manuell bestätigen">✔︎ Freischalten</button>`}
        <select class="input" data-move="${u.id}">${options(gid)}</select>
        <button class="btn sm ghost" data-pw="${u.id}" title="Passwort zurücksetzen">🔑</button>
        <button class="btn sm ghost" data-deluser="${u.id}" title="Konto löschen">🗑️</button></div>`;
    set(main, html`
      <h1>Smallgroups</h1>
      ${!mailConfigured && S.config.emailVerification ? html`<div class="notice error" style="margin-bottom:14px">⚠️ Der Mailversand ist noch nicht eingerichtet (SMTP). Neue Konten bekommen keine Bestätigungs-Mail – schalte sie hier mit «Freischalten» frei.</div>` : ''}
      ${pending.length ? html`<div class="card" style="margin-bottom:14px"><h3>Warten auf Bestätigung (${pending.length})</h3>
        <p class="small muted" style="margin:0 0 4px">Diese Personen haben ihre E-Mail noch nicht bestätigt. Wenn die Mail nicht ankommt, kannst du sie hier freischalten.</p>
        ${pending.map((u) => member(u, u.gid))}</div>` : ''}
      <form class="card row" id="nf"><input class="input grow" name="name" placeholder="Neue Smallgroup (optional vorab erstellen)" maxlength="40" required><button class="btn primary">Erstellen</button></form>
      <div class="section">
        ${groups.map((g) => html`
          <details class="card" data-gid="${g.id}" ${open.has(g.id) ? 'open' : ''}>
            <summary class="row between"><div><b>${g.name}</b><div class="small muted">${plural(g.users.length, 'Person', 'Personen')} · ${g.total} Punkte</div></div><span class="join-code" style="font-size:16px">${g.code}</span></summary>
            <div style="margin-top:12px">
              ${g.users.map((u) => member(u, g.id))}
              <div class="row" style="margin-top:12px"><button class="btn sm" data-rename="${g.id}">✏️ Umbenennen</button><button class="btn sm danger" data-delgroup="${g.id}">Gruppe löschen</button></div>
            </div>
          </details>`)}
        ${!groups.length ? html`<div class="card empty">Noch keine Smallgroups.</div>` : ''}
      </div>
      ${loose.some((u) => u.role === 'user') ? html`<div class="section"><h3>Ohne Smallgroup</h3><div class="card">${loose.filter((u) => u.role === 'user').map((u) => member(u, null))}</div></div>` : ''}`);

    $$('details[data-gid]', main).forEach((d) => d.addEventListener('toggle', () => { const id = Number(d.dataset.gid); d.open ? open.add(id) : open.delete(id); }));
    $('#nf', main).onsubmit = (e) => { e.preventDefault(); busy(e.submitter, async () => { await api('POST', '/api/admin/groups', { name: e.target.elements.namedItem('name').value }); await load(); }); };
    $$('[data-move]', main).forEach((s) => (s.onchange = () => busy(null, async () => { await api('PUT', `/api/admin/users/${s.dataset.move}`, { groupId: s.value || null }); toast('Verschoben ✔', 'ok'); await load(); })));
    $$('[data-pw]', main).forEach((b) => (b.onclick = () => {
      const pw = prompt('Neues Passwort (mind. 8 Zeichen):');
      if (pw) busy(b, async () => { await api('PUT', `/api/admin/users/${b.dataset.pw}`, { password: pw }); toast('Passwort geändert ✔', 'ok'); });
    }));
    $$('[data-verify]', main).forEach((b) => (b.onclick = () => busy(b, async () => {
      await api('PUT', `/api/admin/users/${b.dataset.verify}`, { verified: true });
      toast('Freigeschaltet ✔', 'ok');
      await load();
    })));
    $$('[data-deluser]', main).forEach((b) => (b.onclick = () => {
      if (confirm('Konto löschen? Die Punkte der Smallgroup bleiben.')) busy(b, async () => { await api('DELETE', `/api/admin/users/${b.dataset.deluser}`); await load(); });
    }));
    $$('[data-rename]', main).forEach((b) => (b.onclick = () => {
      const name = prompt('Neuer Name:');
      if (name) busy(b, async () => { await api('PUT', `/api/admin/groups/${b.dataset.rename}`, { name }); await load(); });
    }));
    $$('[data-delgroup]', main).forEach((b) => (b.onclick = () => {
      if (confirm('Smallgroup inkl. aller Punkte und Einreichungen löschen? Die Personen bleiben ohne Gruppe.')) busy(b, async () => { await api('DELETE', `/api/admin/groups/${b.dataset.delgroup}`); await load(); });
    }));
  }
  await load();
  return { onRefresh: (t) => t === 'groups' && !main.contains(document.activeElement) && load().catch(() => {}) };
}

async function logout() {
  await api('POST', '/api/logout').catch(() => {});
  disconnectSocket();
  S.me = null;
  go('/login');
}

/* =========================================================
   Stadt Land Youth
   ========================================================= */
const ROLL_MS = 2500;
const COUNT_MS = 5000;
const LETTERS = 'ABCDEFGHIJKLMNOPRSTUVWZ';

function stageHtml() {
  return html`<div class="stage" data-stage><div class="label">Der Buchstabe ist …</div><div class="letter">?</div><div class="count"></div></div>`;
}
// Animiert Buchstaben-Würfeln und Countdown – läuft auf allen Geräten synchron zur Serverzeit
function tickStage(root, round) {
  const stage = $('[data-stage]', root);
  if (!stage || !round) return;
  const t = now();
  const letterEl = $('.letter', stage), countEl = $('.count', stage), label = $('.label', stage);
  if (t < round.playAt - COUNT_MS) {
    stage.classList.add('rolling');
    letterEl.textContent = LETTERS[Math.floor(Math.random() * LETTERS.length)];
    label.textContent = 'Der Buchstabe ist …';
  } else {
    if (stage.classList.contains('rolling') || letterEl.textContent !== round.letter) {
      stage.classList.remove('rolling');
      letterEl.textContent = round.letter;
      letterEl.classList.remove('pop'); void letterEl.offsetWidth; letterEl.classList.add('pop');
      vibrate(60);
    }
    label.textContent = 'Bereit machen!';
    const n = Math.max(1, Math.ceil((round.playAt - t) / 1000));
    if (countEl.dataset.n !== String(n)) { countEl.dataset.n = n; countEl.innerHTML = `<span>${n}</span>`; }
  }
}
const fmtTimer = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

function progressHtml(s) {
  const total = s.game.categories.length;
  return html`<div class="progress">${s.groups.map((g) => {
    const filled = s.progress?.find((p) => p.groupId === g.id)?.filled ?? 0;
    return html`<div class="prog"><span>${g.id === s.myGroupId ? html`<b>${g.name}</b>` : g.name}</span><span class="muted small">${filled}/${total}</span><div class="bar"><i style="width:${(filled / total) * 100}%"></i></div></div>`;
  })}</div>`;
}

function totalsHtml(s) {
  if (!s.round) return '';
  const rows = s.groups.map((g) => ({ ...g, total: s.totals[g.id] || 0 })).sort((a, b) => b.total - a.total);
  return html`<div class="card section"><h3>Spielstand ${s.game.title}</h3>
    <ul class="ledger" style="margin:0">${rows.map((g, i) => html`<li><span>${medal(i)} ${g.id === s.myGroupId ? html`<b>${g.name}</b>` : g.name}</span><span class="amt">${g.total}</span></li>`)}</ul></div>`;
}

function stopperText(r) {
  return r.stoppedBy ? `${r.stoppedBy} war am schnellsten` : r.endsAt && r.stoppedAt >= r.endsAt ? 'Die Zeit ist abgelaufen' : 'Die Runde wurde beendet';
}

async function viewGame(main) {
  let key = '';
  const pending = {};      // Debounce-Timer pro Feld
  let answers = [];        // eigene Antworten (lokal)
  const draft = {};        // Admin: angeklickte Punkte {roundId: {groupId: {idx: pts}}}

  const ctl = {
    onGame: update,
    onAnswer(p) {
      const s = S.game;
      if (!s?.round || p.roundId !== s.round.id || p.by === S.me.user.id) return;
      answers[p.idx] = p.value;
      const input = $(`input[data-idx="${p.idx}"]`, main);
      if (input && document.activeElement !== input) { input.value = p.value; input.classList.toggle('filled', !!p.value.trim()); }
      updateFilled();
    },
    onStopped(p) {
      flushAll();
      $$('.answers input', main).forEach((i) => (i.disabled = true));
      $('.answers', main)?.classList.add('locked');
      toast(`🛑 STOPP! ${p.by ? p.by + ' war am schnellsten' : 'Runde vorbei'}`);
    },
    onRefresh() {},
    destroy() { clearInterval(ticker); flushAll(); },
  };
  const ticker = setInterval(tick, 120);

  function flushAll() {
    for (const idx of Object.keys(pending)) { clearTimeout(pending[idx]); delete pending[idx]; send(Number(idx)); }
  }
  function send(idx) {
    const s = S.game;
    if (!s?.round) return;
    S.socket?.emit('game:answer', { roundId: s.round.id, idx, value: answers[idx] ?? '' }, (res) => { if (res?.error && !/vorbei/.test(res.error)) fail(new Error(res.error)); });
  }
  function updateFilled() {
    const s = S.game;
    if (!s?.game) return;
    const total = s.game.categories.length;
    const filled = s.game.categories.filter((_, i) => (answers[i] || '').trim()).length;
    const el = $('[data-filled]', main);
    if (el) el.textContent = `${filled}/${total} ausgefüllt`;
    $('.stop-btn', main)?.classList.toggle('notyet', filled < total);
  }

  function tick() {
    const s = S.game;
    const r = s?.round;
    if (!r) return;
    if (r.phase === 'countdown') {
      if (now() >= r.playAt) { r.phase = 'playing'; update(s); return; }
      tickStage(main, r);
    }
    const timer = $('[data-timer]', main);
    if (timer && r.endsAt) timer.textContent = fmtTimer(r.endsAt - now());
  }

  function keyOf(s) {
    const r = s.round;
    return [s.game?.id, r?.id, r?.phase, s.joined, s.myGroupId, s.isAdmin].join('|');
  }

  function update(s) {
    if (!s) { set(main, html`<div class="empty">Verbinde …</div>`); return; }
    const k = keyOf(s);
    if (k !== key) {
      key = k;
      if (s.round && (s.round.phase === 'playing' || s.round.phase === 'countdown')) {
        answers = [...(s.myAnswers || [])];
      }
      set(main, render(s));
      bind(s);
      tick();
    }
    renderParts(s);
  }

  // ---------- Teile, die sich laufend ändern ----------
  function renderParts(s) {
    set($('[data-part=groupcount]', main), s.game ? `(${s.groups.length})` : '');
    set($('[data-part=groups]', main), s.game ? (s.groups.length ? html`<div class="chips">${s.groups.map((g) => html`<span class="chip ${g.id === s.myGroupId ? 'me' : ''}">${g.name}${s.isAdmin ? html` <button class="btn sm ghost" style="min-height:20px;padding:0 4px" data-kick="${g.id}" title="Entfernen">✕</button>` : ''}</span>`)}</div>` : html`<p class="muted small" style="margin:0">Noch niemand dabei …</p>`) : '');
    set($('[data-part=progress]', main), s.game && s.progress ? progressHtml(s) : '');
    set($('[data-part=totals]', main), s.game ? totalsHtml(s) : '');
    if (s.reveal) set($('[data-part=reveal]', main), s.isAdmin ? scoringHtml(s) : revealHtml(s));
    $$('[data-kick]', main).forEach((b) => (b.onclick = () => { if (confirm('Smallgroup aus dem Spiel entfernen?')) busy(b, () => api('POST', `/api/admin/game/kick/${b.dataset.kick}`)); }));
    if (s.isAdmin && s.reveal) bindScoring(s);
  }

  function revealHtml(s) {
    const scored = s.round.phase === 'scored';
    const sums = Object.fromEntries(s.reveal.map((row) => [row.groupId, row.answers.reduce((a, x) => a + (x.points || 0), 0)]));
    return html`
      ${scored ? html`<div class="sums" style="margin-bottom:12px">${[...s.reveal].sort((a, b) => sums[b.groupId] - sums[a.groupId]).map((row) => html`<span class="chip ${row.groupId === s.myGroupId ? 'me' : ''}">${row.name}: ${signed(sums[row.groupId])}</span>`)}</div>` : ''}
      ${s.game.categories.map((cat, i) => html`
        <div class="cat-block"><h4>${cat}</h4>
          ${s.reveal.map((row) => html`<div class="ans-row ${row.groupId === s.myGroupId ? 'mine' : ''}"><span class="g">${row.name}</span><span class="a">${row.answers[i].value || '–'}</span><span class="pts">${scored ? signed(row.answers[i].points) : ''}</span></div>`)}
        </div>`)}`;
  }

  const pointsOf = (s, gid, i) => {
    const d = draft[s.round.id]?.[gid]?.[i];
    if (d !== undefined) return d;
    const a = s.reveal.find((r) => r.groupId === gid).answers[i];
    return s.round.phase === 'scored' ? a.points : a.suggested;
  };
  function scoringHtml(s) {
    const sums = Object.fromEntries(s.reveal.map((row) => [row.groupId, s.game.categories.reduce((a, _, i) => a + pointsOf(s, row.groupId, i), 0)]));
    return html`
      <p class="small muted">Vorschlag nach klassischen Regeln (20 = als einzige, 10 = einzigartig, 5 = doppelt, 0 = leer/falscher Buchstabe). Tippe zum Ändern.</p>
      ${s.game.categories.map((cat, i) => html`
        <div class="cat-block"><h4>${cat}</h4>
          ${s.reveal.map((row) => {
            const p = pointsOf(s, row.groupId, i);
            return html`<div class="ans-row admin"><div><span class="g">${row.name}</span><div class="a">${row.answers[i].value || '–'}</div></div>
              <div class="score-chips">${[0, 5, 10, 20].map((v) => html`<button type="button" class="${p === v ? 'on' : ''}" data-score="${row.groupId}:${i}:${v}">${v}</button>`)}</div></div>`;
          })}
        </div>`)}
      <div class="sticky-actions">
        <div class="sums" style="margin-bottom:8px">${s.reveal.map((row) => html`<span class="chip">${row.name}: <b>${sums[row.groupId]}</b></span>`)}</div>
        <button class="btn primary block big" data-score-save>${s.round.phase === 'scored' ? 'Punkte aktualisieren' : 'Punkte vergeben ✔'}</button>
      </div>`;
  }
  function bindScoring(s) {
    $$('[data-score]', main).forEach((b) => (b.onclick = () => {
      const [gid, i, v] = b.dataset.score.split(':').map(Number);
      ((draft[s.round.id] ||= {})[gid] ||= {})[i] = v;
      renderParts(S.game);
    }));
    const save = $('[data-score-save]', main);
    if (save) save.onclick = () => busy(save, async () => {
      const points = {};
      for (const row of s.reveal) points[row.groupId] = s.game.categories.map((_, i) => pointsOf(s, row.groupId, i));
      await api('POST', '/api/admin/game/score', { points });
      toast('Punkte vergeben 🎉', 'ok');
    });
  }

  // ---------- Grundgerüst je nach Phase ----------
  function render(s) {
    const g = s.game;
    const r = s.round;
    if (!g) return s.isAdmin ? createGameHtml() : html`
      <h1>Stadt Land Youth</h1>
      ${DEMO ? html`<div class="demobar stack" style="margin-bottom:14px"><b>🧪 Demo</b>
        <p class="small muted" style="margin:0">Im Camp eröffnet der Admin das Spiel. Hier kannst du es selbst starten – zwei Bot-Smallgroups spielen gegen dich.</p>
        <button class="btn primary block big" data-demo-game>Spiel gegen Bots starten</button></div>` : ''}
      <div class="card empty"><div class="big">🔤</div>Gerade läuft kein Spiel.<br>Sobald es losgeht, erscheint es hier – mit einem roten Punkt unten.</div>
      <div class="card section"><h3>So geht's</h3>
        <p class="small muted" style="margin:0">1. Eine Person eurer Smallgroup tritt dem Spiel bei – dann seid ihr alle dabei.<br>2. Ein zufälliger Buchstabe erscheint, dann zählt es von 5 runter.<br>3. Füllt alle Kategorien aus – ihr könnt zusammen auf mehreren Handys tippen.<br>4. Die erste Gruppe, die fertig ist, drückt STOPP – dann ist für alle Schluss!</p></div>`;

    const head = html`<div class="game-head"><div><div class="small muted">${r ? `Runde ${r.no}` : 'Lobby'}${s.usedLetters?.length ? ` · gespielt: ${s.usedLetters.join(' ')}` : ''}</div><h1>${g.title}</h1></div>${g.timeLimit ? html`<span class="badge">⏱ ${fmtTimer(g.timeLimit * 1000)}</span>` : ''}</div>`;
    const joinBtn = !s.joined && !s.isAdmin
      ? (s.myGroupId ? html`<button class="btn primary block big" data-join>✋ Mit meiner Smallgroup beitreten</button>` : html`<div class="card muted">Tritt zuerst auf der Home-Seite einer Smallgroup bei.</div>`)
      : '';
    const groupsCard = html`<div class="card section"><h3>Dabei <span data-part="groupcount"></span></h3><div data-part="groups"></div></div>`;
    const phase = r?.phase;

    // Lobby / zwischen den Runden
    if (!r || phase === 'scored') {
      return html`${head}
        ${s.isAdmin ? html`<div class="adminbar stack">
            <button class="btn primary block big" data-start>▶ Runde ${(r?.no || 0) + 1} starten</button>
            <div class="row"><button class="btn sm grow" data-finish>Spiel beenden</button>${r ? html`<button class="btn sm grow" data-discard>Letzte Runde verwerfen</button>` : ''}</div>
          </div>`
          : s.joined ? html`<div class="card accent center"><b>Ihr seid dabei! ✅</b><div class="small muted">${r ? 'Nächste Runde startet gleich …' : 'Wartet, bis die Runde startet.'}</div></div>` : joinBtn}
        ${DEMO && !s.isAdmin && s.joined ? html`<div class="demobar section"><button class="btn primary block big" data-demo-round>▶ Demo: Runde ${(r?.no || 0) + 1} starten</button>
          <p class="small muted" style="margin:8px 0 0">Im Camp startet der Admin die Runden – für alle gleichzeitig.</p></div>` : ''}
        ${r ? html`<div class="card section"><h3>Resultat Runde ${r.no} · ${r.letter}</h3><div class="small muted" style="margin-bottom:10px">${stopperText(r)}</div><div data-part="reveal"></div></div>` : ''}
        <div data-part="totals"></div>
        ${groupsCard}
        <div class="card section"><h3>Kategorien</h3><div class="chips">${g.categories.map((c) => html`<span class="chip">${c}</span>`)}</div></div>`;
    }

    if (phase === 'countdown') {
      return html`${head}${stageHtml()}${joinBtn}
        ${s.isAdmin ? html`<button class="btn sm ghost block" data-discard>Runde abbrechen</button>` : ''}`;
    }

    if (phase === 'playing') {
      if (s.isAdmin) {
        return html`${head}
          <div class="playbar"><span class="l">${r.letter}</span><span>Gruppen schreiben …</span><span class="t" data-timer></span></div>
          <div class="card"><h3>Fortschritt</h3><div data-part="progress"></div></div>
          <div class="adminbar section row"><button class="btn danger grow" data-forcestop>⏹ Runde jetzt stoppen</button><button class="btn sm ghost" data-discard>Verwerfen</button></div>`;
      }
      if (!s.joined) return html`${head}<div class="playbar"><span class="l">${r.letter}</span><span>Runde läuft</span><span class="t" data-timer></span></div>${joinBtn}<div class="card section"><div data-part="progress"></div></div>`;
      return html`
        <div class="playbar"><span class="l">${r.letter}</span><span><b>Los!</b><br><span class="small" data-filled></span></span><span class="t" data-timer></span></div>
        <form class="answers" autocomplete="off" onsubmit="return false">
          ${g.categories.map((c, i) => html`<label class="ans"><span>${c}</span><input class="input ${answers[i]?.trim() ? 'filled' : ''}" data-idx="${i}" value="${answers[i] || ''}" maxlength="60" autocomplete="off" autocorrect="off" spellcheck="false" autocapitalize="words" enterkeyhint="${i === g.categories.length - 1 ? 'done' : 'next'}" placeholder="${r.letter} …"></label>`)}
        </form>
        <button class="stop-btn" data-stop>STOPP! ✋</button>
        <p class="small muted center" style="margin-top:10px">Erst wenn alle Felder ausgefüllt sind. Alle in deiner Smallgroup können mittippen.</p>
        <div class="card section"><h4>Die anderen</h4><div data-part="progress"></div></div>`;
    }

    // stopped – Auswertung
    return html`${head}
      <div class="stopped-banner"><b>STOPP!</b>${stopperText(r)}</div>
      ${s.isAdmin ? html`<div class="row" style="margin-bottom:12px"><span class="grow small muted">Buchstabe <b style="color:var(--accent)">${r.letter}</b></span><button class="btn sm ghost" data-discard>Runde verwerfen</button></div>`
        : html`<p class="muted center small">Die Leiter werten jetzt aus … 🤔</p>
          ${DEMO ? html`<div class="demobar" style="margin-bottom:14px"><button class="btn primary block" data-demo-score>Demo: Punkte automatisch vergeben</button>
            <p class="small muted" style="margin:8px 0 0">Im Camp prüft der Admin die Antworten und vergibt die Punkte.</p></div>` : ''}`}
      <div class="card" data-part="reveal"></div>`;
  }

  function createGameHtml() {
    const d = S.config.defaults;
    return html`
      <h1>Stadt Land Youth</h1>
      <form class="card" id="cg">
        <h3>Neues Spiel starten</h3>
        <label class="field"><span>Titel</span><input class="input" name="title" value="Stadt Land Youth" maxlength="60"></label>
        <label class="field"><span>Kategorien (eine pro Zeile)</span><textarea class="input" name="categories" rows="8">${d.categories.join('\n')}</textarea></label>
        <div class="row">
          <label class="field grow"><span>Zeitlimit pro Runde</span><select class="input" name="timeLimit">
            <option value="0">Kein Limit (nur STOPP)</option><option value="60">1 Minute</option><option value="90">1:30</option><option value="120">2 Minuten</option><option value="180" selected>3 Minuten</option><option value="300">5 Minuten</option></select></label>
          <label class="field grow"><span>Buchstaben</span><input class="input" name="letters" value="${d.letters}"></label>
        </div>
        <p class="small muted">Das Zeitlimit ist nur ein Sicherheitsnetz – normalerweise stoppt die schnellste Smallgroup.</p>
        <button class="btn primary block big">Spiel eröffnen</button>
      </form>`;
  }

  function bind(s) {
    const cg = $('#cg', main);
    if (cg) cg.onsubmit = (e) => {
      e.preventDefault();
      busy(e.submitter, () => api('POST', '/api/admin/game', Object.fromEntries(new FormData(cg))));
    };
    const on = (sel, fn) => { const el = $(sel, main); if (el) el.onclick = () => busy(el, fn); };
    on('[data-join]', () => api('POST', '/api/game/join'));
    on('[data-demo-game]', async () => {
      const d = S.config.defaults;
      await S.demo.adminApi('POST', '/api/admin/game', { title: 'Stadt Land Youth', categories: d.categories.join('\n'), timeLimit: 180, letters: d.letters });
      if (S.me.group) await api('POST', '/api/game/join');
    });
    on('[data-demo-round]', () => S.demo.adminApi('POST', '/api/admin/game/round'));
    on('[data-demo-score]', async () => S.demo.autoScore());
    on('[data-start]', () => api('POST', '/api/admin/game/round'));
    on('[data-forcestop]', () => api('POST', '/api/admin/game/stop'));
    const confirmOn = (sel, msg, fn) => { const el = $(sel, main); if (el) el.onclick = () => { if (confirm(msg)) busy(el, fn); }; };
    confirmOn('[data-finish]', 'Spiel beenden? Die vergebenen Punkte bleiben.', () => api('POST', '/api/admin/game/finish'));
    $$('[data-discard]', main).forEach((el) => (el.onclick = () => { if (confirm('Diese Runde verwerfen? Antworten und Punkte dieser Runde werden gelöscht.')) busy(el, () => api('POST', '/api/admin/game/discard')); }));

    const inputs = $$('.answers input', main);
    inputs.forEach((input, n) => {
      const idx = Number(input.dataset.idx);
      input.oninput = () => {
        answers[idx] = input.value;
        input.classList.toggle('filled', !!input.value.trim());
        updateFilled();
        clearTimeout(pending[idx]);
        pending[idx] = setTimeout(() => { delete pending[idx]; send(idx); }, 350);
      };
      input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); (inputs[n + 1] || input).focus(); if (!inputs[n + 1]) input.blur(); } };
    });
    if (inputs.length) { updateFilled(); if (!matchMedia('(pointer: coarse)').matches) inputs[0].focus(); }

    const stop = $('[data-stop]', main);
    if (stop) stop.onclick = () => {
      const missing = s.game.categories.filter((_, i) => !(answers[i] || '').trim()).length;
      if (missing) { toast(`Noch ${missing} Feld${missing > 1 ? 'er' : ''} leer!`, 'error'); vibrate(80); return; }
      flushAll();
      S.socket.emit('game:stop', { roundId: s.round.id, answers }, (res) => { if (res?.error) fail(new Error(res.error)); });
    };
  }

  update(S.game);
  return ctl;
}

/* =========================================================
   Beamer-Ansicht (für die Leinwand)
   ========================================================= */
async function viewBeamer(main) {
  let key = '';
  let lb = null;
  document.body.style.overflow = 'hidden';
  async function loadLb() { lb = await api('GET', '/api/leaderboard').catch(() => null); if (!S.game?.game) { key = ''; update(S.game); } }
  const ticker = setInterval(() => {
    const r = S.game?.round;
    if (!r) return;
    if (r.phase === 'countdown') {
      if (now() >= r.playAt) { r.phase = 'playing'; update(S.game); return; }
      tickStage(main, r);
    }
    const t = $('[data-timer]', main);
    if (t && r.endsAt) t.textContent = fmtTimer(r.endsAt - now());
  }, 120);

  const top = (right = '') => html`<div class="b-top"><span class="brandline"><img src="logo-96.png" alt="">Jesus First Camp</span><span>${right}</span></div>`;

  function update(s) {
    if (!s) return;
    const r = s.round;
    const k = [s.game?.id, r?.id, r?.phase, s.groups?.length, JSON.stringify(s.progress), JSON.stringify(s.totals), !!lb].join('|');
    if (k === key) return;
    key = k;
    const g = s.game;
    let body;
    if (!g) {
      body = lb && !lb.hidden && lb.groups.length ? html`
        <div class="b-main"><div><h1 style="margin-bottom:4vh">Rangliste</h1>
          <div class="b-lb">${lb.groups.slice(0, 8).map((x, i) => html`<div class="r"><b>${medal(i)}</b><span style="text-align:left">${x.name}</span><b>${x.total}</b></div>`)}</div></div></div>`
        : html`<div class="b-main"><div><img class="b-logo" src="logo.png" alt=""><h1>Jesus First Camp</h1><div class="b-sub">ICF Youth Zürich · 26/27</div></div></div>`;
    } else if (!r || r.phase === 'scored') {
      const ranking = s.groups.map((x) => ({ ...x, total: s.totals[x.id] || 0 })).sort((a, b) => b.total - a.total);
      body = r ? html`
        <div class="b-main"><div><h1 style="margin-bottom:4vh">Spielstand nach Runde ${r.no}</h1>
          <div class="b-lb">${ranking.slice(0, 8).map((x, i) => html`<div class="r"><b>${medal(i)}</b><span style="text-align:left">${x.name}</span><b>${x.total}</b></div>`)}</div></div></div>`
        : html`<div class="b-main"><div><h1>${g.title}</h1><div class="b-sub">Joint jetzt mit eurer Smallgroup in der App! · ${location.host}</div>
          <div class="b-groups">${s.groups.map((x) => html`<span>${x.name}</span>`)}</div></div></div>`;
    } else if (r.phase === 'countdown') {
      body = html`<div class="b-main">${stageHtml()}</div>`;
    } else if (r.phase === 'playing') {
      body = html`<div class="b-main"><div class="b-play"><div class="bigletter">${r.letter}</div>
        <div style="text-align:left"><div class="b-sub" style="margin:0 0 2vh">Wer drückt zuerst STOPP? <span data-timer style="color:var(--text)">${r.endsAt ? fmtTimer(r.endsAt - now()) : ''}</span></div>${progressHtml(s)}</div></div></div>`;
    } else {
      body = html`<div class="b-main" style="place-items:start center"><div style="width:100%">
        <div class="stopped-banner"><b>STOPP!</b>${stopperText(r)}</div>
        <table><thead><tr><th>Smallgroup</th>${g.categories.map((c) => html`<th>${c}</th>`)}</tr></thead>
        <tbody>${(s.reveal || []).map((row) => html`<tr><td><b>${row.name}</b></td>${row.answers.map((a) => html`<td>${a.value || '–'}</td>`)}</tr>`)}</tbody></table></div></div>`;
    }
    set(main, html`<div class="beamer">${top(g ? `${g.title}${r ? ` · Runde ${r.no}` : ''}` : '')}${body}</div>`);
  }

  await loadLb();
  update(S.game);
  return {
    onGame: update,
    onRefresh: (t) => t === 'points' && loadLb(),
    destroy() { clearInterval(ticker); document.body.style.overflow = ''; },
  };
}

/* =========================================================
   Start
   ========================================================= */
// ---------- Demo-Menü ----------
async function demoSwitch(role) {
  try {
    S.demo.switchTo(role);
    await afterLogin();
    toast(role === 'admin' ? 'Du bist jetzt Admin 🛠️' : 'Du bist jetzt Teilnehmer:in 👋', 'ok');
  } catch (e) { fail(e); }
}
function demoMenu() {
  const m = modal(html`
    <h2>🧪 Demo-Version</h2>
    <p class="small muted">Diese Testversion läuft komplett auf deinem Handy: Die Daten siehst nur du, Mails werden keine verschickt. Zwei Bot-Smallgroups spielen Stadt Land Youth mit.</p>
    <div class="stack">
      <button class="btn block ${isAdmin() ? '' : 'primary'}" data-sw="admin">🛠️ Zur Admin-Ansicht</button>
      <button class="btn block ${isAdmin() ? 'primary' : ''}" data-sw="user">👋 Zur Teilnehmer-Ansicht</button>
      <button class="btn block danger" data-reset>Demo zurücksetzen</button>
      <button class="btn block ghost" data-close>Schliessen</button>
    </div>`);
  $$('[data-sw]', m).forEach((b) => (b.onclick = () => { m.remove(); demoSwitch(b.dataset.sw); }));
  $('[data-reset]', m).onclick = () => {
    if (confirm('Alle Demo-Daten auf diesem Gerät löschen und neu beginnen?')) S.demo.reset();
  };
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-demo-menu]')) demoMenu(); });

async function boot() {
  if (DEMO) {
    try {
      S.demo = await import('./demo.js');
      await S.demo.init();
    } catch (e) {
      console.error(e);
      set($('#app'), html`<div class="empty">Die Demo konnte nicht starten 😕<br>${e.message}</div>`);
      return;
    }
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  try { S.config = await api('GET', '/api/config'); } catch (e) { set($('#app'), html`<div class="empty">Server nicht erreichbar 😕<br>${e.message}</div>`); return; }
  try { await refreshMe(); } catch { S.me = null; }
  if (S.me) { connectSocket(); syncPush(); }
  window.addEventListener('hashchange', route);
  route();
}
boot();
