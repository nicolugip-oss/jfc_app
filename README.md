# Jesus First Camp App

Web-App für das **Jesus First Camp 26/27** (ICF Youth Zürich): Smallgroup-Challenges mit Foto-Upload, Punkte und Rangliste sowie das Live-Spiel **Stadt Land Youth**.

Die App läuft im Browser, und man kann sie auf den Homescreen legen (iPhone: Teilen → „Zum Home-Bildschirm“). Es gibt keinen App Store und keine Installation.

## Funktionen

**Für alle (Benutzer-Login)**
- Registrieren mit Name, Benutzername, Passwort. Dabei **eine Smallgroup erstellen** (man bekommt einen 5-stelligen Code) **oder mit Code beitreten**
- Challenges ansehen, **Fotos hochladen** (mehrere, werden automatisch verkleinert), Kommentar dazuschreiben
- Rangliste mit Aufschlüsselung (Challenges / Spiel / Bonus)
- **Stadt Land Youth** live mitspielen. Alle aus der Smallgroup können gleichzeitig auf ihren Handys mittippen.

**Für Admins (spezielles Admin-Login)**
- Challenges erstellen/bearbeiten: Titel, Beschreibung, Punkte, Titelbild, Deadline, Entwurf/sichtbar
- Einreichungen bewerten (Punkte pro Smallgroup)
- **Bonuspunkte** an eine oder mehrere Smallgroups (z.B. Zusatz-Challenge). Negative Punkte sind auch möglich.
- Smallgroups verwalten: vorab erstellen, umbenennen, Leute verschieben, Passwort zurücksetzen
- Rangliste verstecken (für die grosse Auflösung am Schluss)
- Stadt Land Youth steuern (siehe unten)
- **Beamer-Ansicht** (`/#/beamer`) für die Leinwand: Lobby, Buchstabe + Countdown, Live-Fortschritt, STOPP, Antworten, Spielstand

## Stadt Land Youth: Ablauf

1. Admin eröffnet ein Spiel und legt Kategorien, optionales Zeitlimit und Buchstaben fest.
2. Die Smallgroups treten in der App bei. Eine Person reicht, dann ist die ganze Gruppe dabei.
3. Admin startet die Runde. Auf allen Handys und auf dem Beamer **würfelt sich gleichzeitig ein Buchstabe aus**, dann zählt es **5 … 4 … 3 … 2 … 1** herunter.
4. Die Gruppen füllen die Kategorien aus. Die Eingaben werden live zwischen den Handys derselben Gruppe synchronisiert.
5. Sobald **eine Gruppe alles ausgefüllt hat und STOPP drückt, ist für alle Schluss**. Die Felder werden gesperrt und die Handys vibrieren.
6. Admin sieht alle Antworten mit einem **Punktevorschlag** (20 = als einzige Gruppe, 10 = einzigartig, 5 = doppelt, 0 = leer/falscher Buchstabe), kann jede Antwort per Tipp auf 0/5/10/20 ändern und vergibt dann die Punkte.
7. Nächste Runde. Bereits gespielte Buchstaben kommen nicht nochmals.

## Lokal starten

Voraussetzung: **Node.js 22.13 oder neuer**

```bash
npm install
ADMIN_PASSWORD=meinGeheimesPasswort npm start
```

Danach http://localhost:3000 öffnen. Admin-Login: Benutzer `admin` mit dem Passwort aus `ADMIN_PASSWORD`. Ohne `ADMIN_PASSWORD` wird beim ersten Start ein zufälliges Passwort in der Konsole angezeigt.

## Einstellungen (Umgebungsvariablen)

| Variable | Bedeutung | Standard |
|---|---|---|
| `ADMIN_USERNAME` | Benutzername des Admins | `admin` |
| `ADMIN_PASSWORD` | Passwort des Admins (wird bei jedem Start gesetzt) | zufällig |
| `REGISTRATION_CODE` | Optionaler Camp-Code, ohne den man sich nicht registrieren kann (gegen Fremde) | – |
| `DATA_DIR` | Ordner für Datenbank und Bilder | `./data` |
| `PORT` | Port | `3000` |

Farben anpassen: oben in `public/style.css` (`--accent` usw.).

## Online stellen (Hosting)

Die App ist **ein einziger Node.js-Server** mit SQLite-Datenbank und Bildern auf der Festplatte. Man braucht also einen Hoster mit **dauerhaftem Speicher (Volume/Disk)**:

- **Railway**, **Render** (mit Persistent Disk) oder **Fly.io** (mit Volume): ca. 5–10 CHF/Monat, `DATA_DIR` auf das Volume zeigen lassen
- **Kleiner VPS** (z.B. Infomaniak, Hetzner): `npm start` hinter einem HTTPS-Proxy (Caddy/nginx)

Wichtig: **HTTPS** verwenden und `ADMIN_PASSWORD` setzen. Echtzeit läuft über WebSockets (Socket.IO). Das unterstützen alle oben genannten Hoster.

**Backup:** Den Ordner `DATA_DIR` sichern (enthält `app.db` und `uploads/`).

## Technik

- `server/index.js`: Express-Server, Socket.IO, Auslieferung der Bilder (nur eingeloggt)
- `server/routes.js`: REST-API (Login, Smallgroups, Challenges, Punkte, Admin)
- `server/game.js`: Spiellogik Stadt Land Youth (der Server bestimmt Buchstabe, Zeiten und STOPP)
- `server/db.js`: SQLite-Schema (eingebaut in Node.js, keine Datenbank-Installation)
- `public/`: Frontend ohne Build-Schritt (`app.js`, `style.css`)

Passwörter werden mit scrypt gehasht. Hochgeladene Bilder sind nur für eingeloggte Personen abrufbar.
