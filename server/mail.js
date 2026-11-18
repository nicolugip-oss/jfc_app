// E-Mails versenden (Bestätigung & Passwort zurücksetzen)
// Ohne SMTP-Einstellungen werden die Mails nur in der Server-Konsole ausgegeben (zum Testen).
import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const port = Number(process.env.SMTP_PORT) || 587;
const transport = host
  ? nodemailer.createTransport({
    host,
    port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  : null;

export const mailConfigured = !!transport;
const FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'Jesus First Camp <noreply@localhost>';

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout({ title, intro, button, link, outro }) {
  const text = `${title}\n\n${intro}\n\n${button}:\n${link}\n\n${outro}\n\nJesus First Camp · ICF Youth Zürich`;
  const html = `<!doctype html><html><body style="margin:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;color:#111">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:24px 12px"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border-radius:14px;overflow:hidden">
      <tr><td style="background:#000;color:#fff;padding:22px 26px;font-weight:900;font-style:italic;font-size:22px;letter-spacing:.5px">JESUS FIRST CAMP</td></tr>
      <tr><td style="padding:26px">
        <h1 style="margin:0 0 14px;font-size:22px">${escHtml(title)}</h1>
        <p style="margin:0 0 22px;line-height:1.5">${escHtml(intro)}</p>
        <p style="margin:0 0 22px"><a href="${escHtml(link)}" style="display:inline-block;background:#000;color:#fff;text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px">${escHtml(button)}</a></p>
        <p style="margin:0 0 8px;font-size:13px;color:#666;line-height:1.5">${escHtml(outro)}</p>
        <p style="margin:0;font-size:12px;color:#999;word-break:break-all">${escHtml(link)}</p>
      </td></tr>
    </table>
    <p style="font-size:12px;color:#999;margin:14px 0 0">Jesus First Camp · ICF Youth Zürich</p>
  </td></tr></table></body></html>`;
  return { text, html };
}

export async function sendMail({ to, subject, ...content }) {
  const { text, html } = layout(content);
  if (!transport) {
    console.log(`\n✉️  [Mail – SMTP nicht eingerichtet, nur Konsole]\n   An: ${to}\n   Betreff: ${subject}\n   Link: ${content.link}\n`);
    return;
  }
  await transport.sendMail({ from: FROM, to, subject, text, html });
}

export function verifyMail(to, name, link) {
  return sendMail({
    to,
    subject: 'Bestätige deine E-Mail – Jesus First Camp',
    title: `Hey ${name}!`,
    intro: 'Schön, bist du dabei! Bestätige kurz deine E-Mail-Adresse, dann ist dein Konto für die Jesus First Camp App aktiv.',
    button: 'E-Mail bestätigen',
    link,
    outro: 'Du hast dich nicht registriert? Dann kannst du diese Mail ignorieren.',
  });
}

export function resetMail(to, name, link) {
  return sendMail({
    to,
    subject: 'Neues Passwort – Jesus First Camp',
    title: `Hey ${name}!`,
    intro: 'Du hast ein neues Passwort angefordert. Über den Button kannst du es jetzt festlegen. Der Link ist 2 Stunden gültig.',
    button: 'Neues Passwort festlegen',
    link,
    outro: 'Du hast nichts angefordert? Dann ignoriere diese Mail – dein Passwort bleibt wie es ist.',
  });
}
