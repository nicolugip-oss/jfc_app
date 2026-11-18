# Jesus First Camp App

Web-App für das **Jesus First Camp 26/27** (ICF Youth Zürich): Smallgroup-Challenges mit Foto-Upload, Galerie, Punkte und Rangliste sowie das Live-Spiel **Stadt Land Youth**.

Die App läuft im Browser, und man kann sie auf den Homescreen legen (iPhone: Teilen → „Zum Home-Bildschirm“). Es gibt keinen App Store.

## Demo zum Ausprobieren

**https://nicolugip-oss.github.io/jfc_app/**

Die Demo läuft auf GitHub Pages, und zwar komplett im Browser:
- Der Server-Code läuft direkt auf dem Handy, SQLite als WebAssembly.
- Die Daten bleiben auf dem Gerät. Mails werden keine verschickt.
- Zwei Bot-Smallgroups spielen Stadt Land Youth mit, damit man das Spiel auch allein testen kann.
- Über den Knopf **DEMO** oben rechts wechselt man zwischen Admin- und Teilnehmer-Ansicht.
- Logins: `lea@demo.ch` / `demo1234`, Admin: `admin` / `admin`

Die Demo wird bei jedem Push auf `main` automatisch neu gebaut (`.github/workflows/pages.yml`). Lokal baut man sie mit `npm run build:pages`, das Ergebnis liegt dann in `_site/`. Der Code dafür liegt in `demo/`: Dort werden Datenbank, Express, Uploads und Socket.IO für den Browser ersetzt.

Für das echte Camp, mit allen Handys live verbunden und mit Mails, braucht es den Server, siehe unten.

## Funktionen

**Für alle**
- **Registrieren mit E-Mail.** Danach kommt eine Bestätigungs-Mail, und erst mit dem Link darin ist das Konto aktiv. Bei der Registrierung erstellt man eine Smallgroup oder tritt einer bei.
- **Smallgroup einladen:** Die Person, welche die Smallgroup erstellt hat, teilt einen **Einladungslink** (z.B. per WhatsApp). Wer den Link öffnet und sich registriert, landet direkt in der richtigen Gruppe. Den 5-stelligen Code kann man auch eintippen.
- **Passwort vergessen:** Ein Link per Mail ist 2 Stunden gültig.
- **Challenges** ansehen und **Fotos hochladen**. Die Fotos werden automatisch verkleinert, und es wird zusätzlich ein kleines Vorschaubild erstellt.
- **Galerie** mit allen Fotos aller Smallgroups, filterbar nach Challenge. Ein Foto lässt sich gross anzeigen, und man kann durch die Fotos wischen.
- **Rangliste** mit Aufschlüsselung nach Challenges, Spiel und Bonus
- **Stadt Land Youth** live mitspielen. Alle aus der Smallgroup können gleichzeitig auf ihren Handys mittippen.

**Für Admins** (ein gemeinsames Admin-Konto, mehrere Leute können gleichzeitig eingeloggt sein)
- Challenges erstellen und bearbeiten: Titel, Beschreibung, Punkte, Titelbild, Deadline, Entwurf/sichtbar
- Einreichungen bewerten
- **Bonuspunkte** an eine oder mehrere Smallgroups vergeben (z.B. für eine Zusatz-Challenge). Negative Punkte sind auch möglich.
- Smallgroups verwalten: vorab erstellen, umbenennen, Leute verschieben, Passwort setzen, **Konten manuell freischalten** (falls eine Mail nicht ankommt)
- Unpassende Fotos direkt in der Galerie löschen
- Rangliste verstecken, z.B. für die grosse Auflösung am Schluss
- Stadt Land Youth steuern (siehe unten)
- **Beamer-Ansicht** (`/#/beamer`) für die Leinwand: Lobby, Buchstabe mit Countdown, Live-Fortschritt, STOPP, Antworten, Spielstand

## Stadt Land Youth: Ablauf

1. Der Admin eröffnet ein Spiel und legt Kategorien, ein optionales Zeitlimit und die Buchstaben fest.
2. Die Smallgroups treten in der App bei. Eine Person reicht, dann ist die ganze Gruppe dabei.
3. Der Admin startet die Runde. Auf allen Handys und auf dem Beamer **würfelt sich gleichzeitig ein Buchstabe aus**, dann zählt es **5 … 4 … 3 … 2 … 1** herunter.
4. Die Gruppen füllen die Kategorien aus. Die Eingaben werden live zwischen den Handys derselben Gruppe synchronisiert.
5. Sobald **eine Gruppe alles ausgefüllt hat und STOPP drückt, ist für alle Schluss**.
6. Der Admin sieht alle Antworten mit einem **Punktevorschlag**: 20 = als einzige Gruppe, 10 = einzigartig, 5 = doppelt, 0 = leer oder falscher Buchstabe. Er kann jede Antwort per Tipp ändern und vergibt dann die Punkte.

## Auf dem eigenen Server betreiben

### Variante A: Docker (empfohlen)

```bash
git clone https://github.com/nicolugip-oss/jfc_app.git
cd jfc_app
cp .env.example .env      # Werte ausfüllen (Admin-Passwort, APP_URL, SMTP)
docker compose up -d --build
```

Die App läuft dann auf `127.0.0.1:3000`. Datenbank und Fotos liegen im Docker-Volume `jfc-data`.

- Logs: `docker compose logs -f`
- Update: `git pull && docker compose up -d --build`
- Backup: `docker compose exec -T app tar czf - -C /data . > jfc-backup-$(date +%F).tgz`

### Variante B: direkt mit Node.js (ab Version 22.13)

```bash
npm ci --omit=dev
cp .env.example .env      # Werte ausfüllen
npm start
```

Damit die App nach einem Neustart des Servers automatisch wieder startet, z.B. mit `systemd` oder `pm2`. Daten liegen in `./data` (oder `DATA_DIR`).

### HTTPS (Pflicht)

Vor die App gehört ein Reverse-Proxy mit HTTPS. Am einfachsten geht das mit **Caddy**, das die Zertifikate automatisch holt. Beispiel `Caddyfile`:

```
jfc.example.ch {
    reverse_proxy 127.0.0.1:3000
}
```

Mit nginx funktioniert es auch. Wichtig: WebSockets durchlassen (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`), sonst läuft Stadt Land Youth nicht live.

## Einstellungen (`.env`)

| Variable | Bedeutung |
|---|---|
| `ADMIN_PASSWORD` | Passwort fürs Admin-Konto. Beim Login ins Feld „E-Mail“ einfach `admin` eingeben. Wird das Passwort geändert, werden alle Admin-Geräte ausgeloggt. |
| `ADMIN_USERNAME` | Login-Name des Admins (Standard `admin`) |
| `APP_URL` | Öffentliche Adresse, z.B. `https://jfc.example.ch` (für die Links in den Mails) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Zugang zum Mailserver. Port 587 = STARTTLS, Port 465 = SSL. |
| `MAIL_FROM` | Absender, z.B. `Jesus First Camp <noreply@icf.church>` |
| `EMAIL_VERIFICATION` | `off` = Konten sind ohne Mail-Bestätigung sofort aktiv (Notfall-Schalter) |
| `REGISTRATION_CODE` | Optionaler Camp-Code, ohne den man sich nicht registrieren kann |
| `DATA_DIR`, `PORT` | Datenordner (Standard `./data`) und Port (Standard `3000`) |

Ohne SMTP-Einstellungen werden die Mails nur in der Server-Konsole ausgegeben (zum Testen). Im Admin-Bereich erscheint dann ein Hinweis, und neue Konten können dort von Hand freigeschaltet werden.

**Tipp zum Mailversand:** Eine Absender-Adresse der eigenen Domain mit korrekt eingerichtetem SPF/DKIM landet seltener im Spam. Falls nötig, gibt es auch Dienste wie Brevo oder Postmark mit SMTP-Zugang.

## Design

Farben stehen oben in `public/style.css`. Das Logo liegt in `public/logo.png`, die Icons in `public/icon-*.png`. Die Schrift ist [Archivo](https://github.com/Omnibus-Type/Archivo) (SIL Open Font License, Lizenz in `public/fonts/`). Sie wird selbst gehostet, es gibt also keine Verbindung zu Google Fonts.

## Technik

- `server/index.js`: Express-Server, Socket.IO (Echtzeit), Auslieferung der Bilder (nur eingeloggt)
- `server/routes.js`: REST-API (Registrierung, Login, Smallgroups, Challenges, Galerie, Punkte, Admin)
- `server/game.js`: Spiellogik von Stadt Land Youth. Der Server bestimmt Buchstabe, Zeiten und STOPP.
- `server/mail.js`: Mailversand (Bestätigung, Passwort zurücksetzen)
- `server/db.js`: SQLite-Datenbank (in Node.js eingebaut, nichts zu installieren)
- `public/`: Frontend ohne Build-Schritt (`app.js`, `style.css`)

Sicherheit:
- Passwörter werden mit scrypt gehasht.
- Die Links in den Mails sind einmalig gültig, in der Datenbank liegt nur ihr Hash.
- Fotos sind nur für eingeloggte Personen abrufbar.
- Login-Versuche und Mailversand werden pro E-Mail-Adresse gebremst. Das ist wichtig, weil im Camp-WLAN alle dieselbe IP haben.
