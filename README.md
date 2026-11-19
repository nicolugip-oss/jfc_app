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
- **Ankündigungen** oben auf der Startseite: Quick-Events (z.B. „Ping Pong Battle gegen ICF München“ mit Zeit und Ort), News und neue Challenges.
- **Push-Benachrichtigungen:** Mit „Aktivieren“ auf der Startseite einschalten, dann kommen Ankündigungen auch bei geschlossener App. Auf Android geht das direkt, auf dem iPhone ab iOS 16.4, wenn die App vorher zum Home-Bildschirm hinzugefügt wurde.
- **Galerie:** ein Ort für alle Fotos aus dem Camp, neuste zuerst. Jedes Foto ist mit dem Namen der Smallgroup beschriftet (Fotos des Teams mit „ICF Youth“). Unter „Foto teilen“ lädt man Fotos mit Bildtext hoch, die eigenen kann man wieder löschen. Ein Foto lässt sich gross anzeigen, und man kann durch die Fotos wischen.
- **Live:** Lädt jemand ein Foto hoch, sehen es alle anderen sofort. Sie bekommen einen Hinweis, und Galerie und Startseite aktualisieren sich von selbst.
- **Rangliste** mit Aufschlüsselung nach Challenges, Spiel und Bonus
- **Stadt Land Youth** live mitspielen. Alle aus der Smallgroup können gleichzeitig auf ihren Handys mittippen.

**Für Admins** (ein gemeinsames Admin-Konto, mehrere Leute können gleichzeitig eingeloggt sein)
- Challenges erstellen und bearbeiten: Titel, Beschreibung, Punkte, Titelbild, Deadline, Entwurf/sichtbar. Das **Titelbild wird automatisch im JFC-Stil** aus dem Titel erzeugt (`public/cover.js`, mit mehreren Varianten). Ein eigenes Foto geht auch.
- Einreichungen bewerten
- **Bonuspunkte** an eine oder mehrere Smallgroups vergeben (z.B. für eine Zusatz-Challenge). Negative Punkte sind auch möglich.
- Smallgroups verwalten: vorab erstellen, umbenennen, Leute verschieben, Passwort setzen, **Konten manuell freischalten** (falls eine Mail nicht ankommt)
- **Ankündigungen & Quick-Events** erstellen (Admin → Ankündigungen): Titel, Text, bei Quick-Events auch Zeit und Ort. Pro Ankündigung entscheidest du, ob eine **Push-Benachrichtigung** rausgeht. Beim Erstellen einer Challenge kannst du sie ebenfalls ankündigen und per Push melden.
- Fotos in der Galerie teilen, sie erscheinen mit dem Namen „ICF Youth“.
- **Jedes Foto löschen** (Challenge-Fotos, Schnappschüsse, ICF-Fotos): in der Galerie antippen und dann „Löschen“ wählen. Das Foto verschwindet sofort bei allen.
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

## Go-Live-Checkliste

1. **Server:** ein Linux-Server (Ubuntu/Debian), auf dem die Ports 80 und 443 frei sind. Ein kleiner VPS reicht (1 CPU, 1–2 GB RAM). Für die Fotos sollten mindestens 10 GB frei sein.
2. **Domain:** z.B. `jfc.icf-youth.ch`. Ein DNS-Eintrag (A-Record) muss auf die IP des Servers zeigen.
3. **Mail:** Zugangsdaten für einen Mail-Account, über den die Bestätigungs-Mails rausgehen (SMTP-Server, Port, Benutzer, Passwort).
4. **Installieren:** siehe unten, ein Befehl auf dem Server.
5. **Test:** Admin-Login, eine Challenge erstellen, mit 2–3 Handys registrieren, ein Foto hochladen, eine Runde Stadt Land Youth spielen.
6. **Challenges erfassen** im Admin-Bereich. Das Titelbild wird automatisch im JFC-Stil erzeugt, ein eigenes Foto geht auch.
7. **Link verteilen:** Alle öffnen die Adresse und legen die App auf den Homescreen. Wer eine Smallgroup erstellt, schickt den anderen den Einladungslink.

## Auf dem eigenen Server betreiben

### Variante A: Installationsskript (empfohlen)

Auf dem Server:

```bash
curl -fsSL https://raw.githubusercontent.com/nicolugip-oss/jfc_app/main/install.sh -o install.sh
sudo bash install.sh
```

Das Skript macht Folgendes:
- Es installiert Docker, falls es noch fehlt.
- Es holt die App nach `/opt/jfc_app`.
- Es fragt Domain, Admin-Passwort und Mail-Zugang ab und speichert sie in `/opt/jfc_app/.env`. Die Datei ist nur für root lesbar.
- Es startet die App zusammen mit **Caddy**, das automatisch das HTTPS-Zertifikat holt.

Erneut ausführen = Update auf die neuste Version, die Einstellungen bleiben dabei erhalten.

### Variante B: Docker von Hand

```bash
git clone https://github.com/nicolugip-oss/jfc_app.git
cd jfc_app
cp .env.example .env      # Werte ausfüllen (DOMAIN, Admin-Passwort, SMTP)
docker compose up -d --build
```

- Logs: `docker compose logs -f app`
- Update: `git pull && docker compose up -d --build`
- Datenbank und Fotos liegen im Docker-Volume `jfc-data`.

Läuft auf dem Server schon ein anderer Webserver auf 80/443, startest du nur die App mit `docker compose up -d --build app`. Sie ist dann auf `127.0.0.1:3000` erreichbar, und du leitest sie über den bestehenden Webserver weiter. Bei nginx müssen WebSockets durchgelassen werden (`proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`), sonst läuft Stadt Land Youth nicht live.

### Variante C: direkt mit Node.js (ab Version 22.13)

```bash
npm ci --omit=dev
cp .env.example .env      # Werte ausfüllen
npm start
```

Damit die App nach einem Neustart des Servers automatisch wieder startet, braucht es z.B. `systemd` oder `pm2`, dazu einen Reverse-Proxy mit HTTPS. Die Daten liegen in `./data` (oder `DATA_DIR`).

### Backups

- Die App sichert die Datenbank **automatisch jeden Tag** nach `/data/backups/`. Die letzten 14 Tage bleiben erhalten.
- Komplettes Backup inkl. aller Fotos: `docker compose exec -T app tar czf - -C /data . > jfc-backup-$(date +%F).tgz`

## Einstellungen (`.env`)

| Variable | Bedeutung |
|---|---|
| `ADMIN_PASSWORD` | Passwort fürs Admin-Konto. Beim Login ins Feld „E-Mail“ einfach `admin` eingeben. Wird das Passwort geändert, werden alle Admin-Geräte ausgeloggt. |
| `ADMIN_USERNAME` | Login-Name des Admins (Standard `admin`) |
| `DOMAIN` | Domain der App, z.B. `jfc.example.ch` (für HTTPS mit Caddy) |
| `APP_URL` | Öffentliche Adresse, z.B. `https://jfc.example.ch` (für die Links in den Mails; Standard: `https://DOMAIN`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Zugang zum Mailserver. Port 587 = STARTTLS, Port 465 = SSL. |
| `MAIL_FROM` | Absender, z.B. `Jesus First Camp <noreply@icf.church>` |
| `EMAIL_VERIFICATION` | `off` = Konten sind ohne Mail-Bestätigung sofort aktiv (Notfall-Schalter) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Optional: eigene Schlüssel für Push. Ohne Angabe werden sie beim ersten Start erzeugt und in der Datenbank gespeichert. Push funktioniert nur über HTTPS. |
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
