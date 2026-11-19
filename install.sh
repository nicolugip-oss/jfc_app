#!/usr/bin/env bash
# Jesus First Camp App – Installation auf einem Linux-Server (Ubuntu/Debian)
#
# Auf dem Server ausführen:
#   curl -fsSL https://raw.githubusercontent.com/nicolugip-oss/jfc_app/main/install.sh -o install.sh
#   sudo bash install.sh
#
# Das Skript installiert (falls nötig) Docker, holt die App nach /opt/jfc_app,
# fragt Domain, Admin-Passwort und Mail-Zugang ab und startet alles mit HTTPS.
# Erneut ausführen = Update auf die neuste Version (die Einstellungen bleiben).
set -euo pipefail

DIR="${JFC_DIR:-/opt/jfc_app}"
REPO="${JFC_REPO:-https://github.com/nicolugip-oss/jfc_app.git}"

bold() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ask() {
  local question="$1" default="${2:-}" value
  read -r -p "$question${default:+ [$default]}: " value < /dev/tty
  printf '%s' "${value:-$default}"
}
ask_secret() {
  local value
  read -r -s -p "$1: " value < /dev/tty
  echo >&2
  printf '%s' "$value"
}
quote() {
  # Wert für die .env in einfache Anführungszeichen setzen
  case "$1" in *"'"*) echo "Bitte kein ' (Apostroph) in Passwörtern oder Adressen verwenden." >&2; exit 1 ;; esac
  printf "'%s'" "$1"
}

[ "$(id -u)" -eq 0 ] || { echo "Bitte mit sudo ausführen: sudo bash install.sh"; exit 1; }

bold "Jesus First Camp App – Installation"

if ! command -v docker > /dev/null 2>&1; then
  answer="$(ask "Docker ist nicht installiert. Jetzt installieren? (j/n)" "j")"
  [ "$answer" = "j" ] || { echo "Abgebrochen."; exit 1; }
  curl -fsSL https://get.docker.com | sh
fi
docker compose version > /dev/null 2>&1 || { echo "'docker compose' fehlt – bitte Docker aktualisieren."; exit 1; }
if ! command -v git > /dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq git
fi

if [ -d "$DIR/.git" ]; then
  bold "Hole die neuste Version …"
  git -C "$DIR" pull --ff-only
else
  bold "Lade die App nach $DIR …"
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  bold "Einstellungen"
  echo "Die Domain muss schon per DNS (A-Record) auf diesen Server zeigen, sonst klappt HTTPS nicht."
  DOMAIN="$(ask "Domain der App (z.B. jfc.icf-youth.ch)")"
  [ -n "$DOMAIN" ] || { echo "Ohne Domain geht es nicht."; exit 1; }
  ADMIN_PASSWORD="$(ask_secret "Admin-Passwort (leer lassen = zufällig erzeugen)")"
  if [ -z "$ADMIN_PASSWORD" ]; then
    ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)"
    GENERATED_PW=1
  fi
  echo
  echo "Mailversand (für Bestätigungs-Mails). Leer lassen = später einrichten;"
  echo "bis dahin schaltest du neue Konten im Admin-Bereich von Hand frei."
  SMTP_HOST="$(ask "SMTP-Server (z.B. smtp.office365.com)")"
  SMTP_PORT="" SMTP_USER="" SMTP_PASS="" MAIL_FROM=""
  if [ -n "$SMTP_HOST" ]; then
    SMTP_PORT="$(ask "SMTP-Port" "587")"
    SMTP_USER="$(ask "SMTP-Benutzer (meist die Mail-Adresse)")"
    SMTP_PASS="$(ask_secret "SMTP-Passwort")"
    MAIL_FROM="$(ask "Absender" "Jesus First Camp <$SMTP_USER>")"
  fi
  umask 077
  {
    echo "DOMAIN=$(quote "$DOMAIN")"
    echo "APP_URL=$(quote "https://$DOMAIN")"
    echo "ADMIN_PASSWORD=$(quote "$ADMIN_PASSWORD")"
    if [ -n "$SMTP_HOST" ]; then
      echo "SMTP_HOST=$(quote "$SMTP_HOST")"
      echo "SMTP_PORT=$(quote "$SMTP_PORT")"
      echo "SMTP_USER=$(quote "$SMTP_USER")"
      echo "SMTP_PASS=$(quote "$SMTP_PASS")"
      echo "MAIL_FROM=$(quote "$MAIL_FROM")"
    else
      echo "# SMTP_HOST= (noch nicht eingerichtet)"
    fi
  } > .env
  echo "Gespeichert in $DIR/.env (nur für root lesbar)."
fi

bold "Baue und starte die App (das dauert beim ersten Mal ein paar Minuten) …"
docker compose up -d --build

DOMAIN_NOW="$(grep -E '^DOMAIN=' .env | cut -d= -f2- | tr -d "'\"")"
bold "Fertig! 🎉"
echo "App:          https://$DOMAIN_NOW"
echo "Admin-Login:  admin"
if [ "${GENERATED_PW:-0}" = 1 ]; then echo "Passwort:     $ADMIN_PASSWORD   ← jetzt notieren!"; fi
echo
echo "Logs ansehen:   cd $DIR && docker compose logs -f app"
echo "Update:         sudo bash $DIR/install.sh"
echo "Einstellungen:  $DIR/.env ändern, dann: cd $DIR && docker compose up -d"
