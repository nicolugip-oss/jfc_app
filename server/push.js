// Push-Benachrichtigungen (Web Push) – funktionieren auf Android und auf dem iPhone,
// wenn die App zum Home-Bildschirm hinzugefügt wurde (ab iOS 16.4).
// Die nötigen VAPID-Schlüssel werden beim ersten Start erzeugt und in der Datenbank gespeichert.
import { generateVAPIDKeys, setVapidDetails, sendNotification } from 'web-push';
import { all, run, getSetting, setSetting } from './db.js';

let keys = null;

function subject() {
  if (process.env.VAPID_SUBJECT) return process.env.VAPID_SUBJECT;
  const url = process.env.APP_URL || (process.env.DOMAIN ? `https://${process.env.DOMAIN}` : '');
  return url.startsWith('https://') ? url.replace(/\/$/, '') : 'mailto:jfc-app@example.com';
}

export function initPush() {
  keys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
    : getSetting('vapidKeys');
  if (!keys) {
    keys = generateVAPIDKeys();
    setSetting('vapidKeys', keys);
  }
  setVapidDetails(subject(), keys.publicKey, keys.privateKey);
}

export const pushPublicKey = () => keys?.publicKey;

// Nur echte Push-Dienste der Browser-Hersteller zulassen (kein Versand an beliebige Adressen)
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)$/;
export function allowedEndpoint(endpoint) {
  if (endpoint === 'demo-local') return process.env.DEMO === '1';
  try {
    const u = new URL(endpoint);
    const extra = String(process.env.PUSH_ALLOW_HOSTS || '').split(',').map((s) => s.trim()).filter(Boolean);
    return u.protocol === 'https:' && (PUSH_HOSTS.test(u.hostname) || extra.includes(u.host) || extra.includes(u.hostname));
  } catch {
    return false;
  }
}

/** Schickt eine Nachricht an alle Geräte (ausser an die Person, die sie ausgelöst hat). */
export async function sendPush({ title, body = '', url = '#/', tag }, { excludeUserId = null } = {}) {
  const exclude = process.env.DEMO === '1' ? null : excludeUserId; // im Demo ist Admin = Teilnehmer-Gerät
  const subs = all('SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id IS NOT ?', exclude);
  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: 'high', timeout: 10_000 });
      sent++;
    } catch (e) {
      // Abo abgelaufen oder abgemeldet → entfernen
      if (e.statusCode === 404 || e.statusCode === 410) run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
      else console.error('Push fehlgeschlagen:', e.statusCode || '', e.body || e.message);
    }
  }));
  return { sent, total: subs.length };
}
