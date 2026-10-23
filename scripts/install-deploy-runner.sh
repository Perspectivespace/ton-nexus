#!/usr/bin/env bash
# One-time setup of the Telegram-driven deploy runner for TON Nexus.
#
# Run ONCE on the server as root:
#   curl -fsSL https://raw.githubusercontent.com/Perspectivespace/ton-nexus/main/scripts/install-deploy-runner.sh | bash
#
# What it does (idempotent, safe to re-run):
#   1. git fetch in the test checkout (working tree is NOT touched here)
#   2. installs the runner + systemd units straight from origin/main
#   3. creates the spool dir /var/lib/ton-nexus-deploy
#   4. enables ton-nexus-deploy.path (watches for requests from the API)
#   5. queues the first full deploy and waits for it (pip, alembic, build, restart)
# After that every update is a button in the Mini App owner cabinet.

set -euo pipefail

APP_DIR="${1:-/opt/taskbot_test/miniapp}"
BRANCH="main"
SPOOL="/var/lib/ton-nexus-deploy"
LIB_DIR="/usr/local/lib/ton-nexus-deploy"
GROUP="tonnexus-deploy"
API_SERVICE="ton-nexus-api"

# Без цвета по умолчанию: веб-консоль хостинга показывает ANSI-коды как мусор.
# Цвет можно включить явно: COLOR=1 (и только в настоящем терминале).
if [ "${COLOR:-0}" = "1" ] && [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_INFO=$(printf '\033[1;36m'); C_ERR=$(printf '\033[1;31m'); C_OFF=$(printf '\033[0m')
else
  C_INFO=''; C_ERR=''; C_OFF=''
fi
say() { printf '%s==>%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
die() { printf '%sОШИБКА:%s %s\n' "$C_ERR" "$C_OFF" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запусти от root"
for c in git python3 npm systemctl flock nginx install; do
  command -v "$c" >/dev/null 2>&1 || die "не найдена команда: $c"
done
[ -d "$APP_DIR/.git" ] || die "нет git-репозитория в $APP_DIR"
[ -x "$APP_DIR/backend/venv/bin/python" ] || die "нет venv: $APP_DIR/backend/venv"

g() { git -c safe.directory="$APP_DIR" -C "$APP_DIR" "$@"; }

say "Получаю свежий код с GitHub (рабочая папка пока не меняется)"
g fetch --prune origin "$BRANCH"
g cat-file -e "origin/$BRANCH:scripts/deploy-runner.sh" 2>/dev/null \
  || die "в origin/$BRANCH нет scripts/deploy-runner.sh — сначала нужно смержить ветку с деплоем"

say "Ставлю runner и systemd-юниты"
install -d -m 0755 "$LIB_DIR"
g show "origin/$BRANCH:scripts/deploy-runner.sh" >"$LIB_DIR/runner.sh.new"
install -m 0755 "$LIB_DIR/runner.sh.new" "$LIB_DIR/runner.sh"
rm -f "$LIB_DIR/runner.sh.new"
for u in ton-nexus-deploy.service ton-nexus-deploy.path; do
  g show "origin/$BRANCH:deploy/systemd/$u" >"/etc/systemd/system/$u"
  chmod 0644 "/etc/systemd/system/$u"
done

say "Создаю папку очереди $SPOOL"
getent group "$GROUP" >/dev/null || groupadd --system "$GROUP"
install -d -m 2750 -o root -g "$GROUP" "$SPOOL"
install -d -m 2770 -o root -g "$GROUP" "$SPOOL/requests"
install -d -m 2750 -o root -g "$GROUP" "$SPOOL/jobs" "$SPOOL/logs"

api_user="$(systemctl show -p User --value "$API_SERVICE" 2>/dev/null || true)"
if [ -n "$api_user" ] && [ "$api_user" != "root" ]; then
  usermod -aG "$GROUP" "$api_user" && say "Пользователь API ($api_user) добавлен в группу $GROUP"
fi

systemctl daemon-reload
systemctl enable --now ton-nexus-deploy.path >/dev/null
say "Watcher включён: $(systemctl is-active ton-nexus-deploy.path)"

owner_id="$(grep -E '^TELEGRAM_OWNER_IDS=' "$APP_DIR/backend/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -cd '0-9,' | cut -d, -f1 || true)"
job_id="$(date -u +%Y%m%dT%H%M%SZ)-$(head -c3 /dev/urandom | od -An -tx1 | tr -d ' \n')"
say "Ставлю в очередь первый полный деплой ($job_id)"
J_ID="$job_id" J_OWNER="$owner_id" J_OUT="$SPOOL/requests" python3 - <<'PY'
import datetime, json, os
e = os.environ
req = {
    "id": e["J_ID"],
    "target": "test",
    "force": True,
    "requested_by": int(e["J_OWNER"]) if e["J_OWNER"].isdigit() else None,
    "requested_by_name": "installer",
    "requested_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
}
tmp = os.path.join(e["J_OUT"], "." + e["J_ID"] + ".tmp")
with open(tmp, "w") as f:
    json.dump(req, f)
os.chmod(tmp, 0o660)
os.replace(tmp, os.path.join(e["J_OUT"], e["J_ID"] + ".json"))
PY

say "Жду завершения (до 20 минут; npm ci + сборка обычно 1–3 минуты)…"
last_step=""
status=""
for _ in $(seq 1 600); do
  f="$SPOOL/jobs/$job_id.json"
  if [ -f "$f" ]; then
    read -r status step < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["status"], d.get("step") or "-")' "$f")
    if [ "$step" != "$last_step" ] && [ "$step" != "-" ]; then echo "   шаг: $step"; last_step="$step"; fi
    case "$status" in success|failed) break ;; esac
  fi
  sleep 2
done

echo
if [ "$status" = "success" ]; then
  say "ГОТОВО ✅  Деплой работает. Дальше обновляй сервер из Mini App: Кабинет → Деплой → «Обновить тест»."
else
  tail -n 40 "$SPOOL/logs/$job_id.log" 2>/dev/null || true
  die "первый деплой не завершился успешно (статус: ${status:-нет ответа}). Пришли эти строки в чат."
fi
