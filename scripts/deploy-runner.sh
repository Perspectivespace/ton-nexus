#!/usr/bin/env bash
# TON Nexus deploy runner.
#
# Runs as root from ton-nexus-deploy.service (triggered by ton-nexus-deploy.path
# whenever the API drops a request into $SPOOL/requests/). The API never runs
# shell itself; it only writes a small JSON request. This script only reads
# whitelisted fields from it (target, force, requested_by, ...) and never
# executes request content.
#
# Pipeline per request:
#   fetch -> autosave local edits (git stash) -> checkout origin/main
#   -> pip install (if requirements changed) -> alembic upgrade head
#   -> npm ci (if lockfile changed) -> build into dist.new -> swap dist
#   -> restart API (if backend changed) -> health check -> nginx reload
# On failure: code + frontend are rolled back to the previous commit.
# Migrations are NOT downgraded automatically.

set -uo pipefail

RUNNER_VERSION="1"
SPOOL="${TN_DEPLOY_SPOOL:-/var/lib/ton-nexus-deploy}"
LOCK_FILE="${TN_DEPLOY_LOCK:-/run/ton-nexus-deploy.lock}"
INSTALLED_RUNNER="${TN_DEPLOY_INSTALLED_RUNNER:-/usr/local/lib/ton-nexus-deploy/runner.sh}"
ID_RE='^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$'

umask 0027
mkdir -p "$SPOOL/requests" "$SPOOL/jobs" "$SPOOL/logs"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "another deploy is running; exiting"
  exit 0
fi

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# ---------- per-target config ----------
load_target() {
  case "$1" in
    test)
      APP_DIR="${TN_TEST_APP_DIR:-/opt/taskbot_test/miniapp}"
      API_SERVICE="${TN_TEST_SERVICE:-ton-nexus-api}"
      HEALTH_URL="${TN_TEST_HEALTH:-http://127.0.0.1:8000/health}"
      BRANCH="${TN_TEST_BRANCH:-main}"
      ;;
    *)
      return 1
      ;;
  esac
  BACKEND="$APP_DIR/backend"
  FRONTEND="$APP_DIR/frontend"
  VENV="$BACKEND/venv"
  return 0
}

# ---------- job state (JSON written by python, atomically) ----------
J_STATUS="queued"; J_STEP=""; J_ERROR=""; J_WARN=""; J_FROM=""; J_TO=""; J_SUBJECT=""
J_STARTED=""; J_FINISHED=""; J_COMMITS=""; J_STEPS_DONE=""

write_job() {
  J_ID="$JOB_ID" J_TARGET="$TARGET" J_FORCE="$FORCE" J_BY="$REQ_BY" J_BY_NAME="$REQ_BY_NAME" \
  J_REQ_AT="$REQ_AT" J_STATUS="$J_STATUS" J_STEP="$J_STEP" J_ERROR="$J_ERROR" J_WARN="$J_WARN" \
  J_FROM="$J_FROM" J_TO="$J_TO" J_SUBJECT="$J_SUBJECT" J_STARTED="$J_STARTED" \
  J_FINISHED="$J_FINISHED" J_COMMITS="$J_COMMITS" J_STEPS_DONE="$J_STEPS_DONE" \
  J_OUT="$SPOOL/jobs/$JOB_ID.json" python3 - <<'PY'
import json, os
e = os.environ
commits = []
for line in e.get("J_COMMITS", "").splitlines():
    parts = line.split("\x1f")
    if len(parts) >= 3:
        commits.append({"sha": parts[0], "subject": parts[1], "author": parts[2]})
data = {
    "id": e["J_ID"],
    "target": e["J_TARGET"],
    "force": e["J_FORCE"] == "1",
    "status": e["J_STATUS"],
    "step": e["J_STEP"] or None,
    "steps_done": [s for s in e.get("J_STEPS_DONE", "").split(",") if s],
    "error": e["J_ERROR"] or None,
    "warning": e["J_WARN"] or None,
    "requested_by": int(e["J_BY"]) if e["J_BY"].isdigit() else None,
    "requested_by_name": e["J_BY_NAME"] or None,
    "requested_at": e["J_REQ_AT"] or None,
    "started_at": e["J_STARTED"] or None,
    "finished_at": e["J_FINISHED"] or None,
    "from_commit": e["J_FROM"] or None,
    "to_commit": e["J_TO"] or None,
    "to_subject": e["J_SUBJECT"] or None,
    "commits": commits,
}
out = e["J_OUT"]
tmp = out + ".tmp"
with open(tmp, "w") as f:
    json.dump(data, f, ensure_ascii=False, indent=1)
os.chmod(tmp, 0o640)
os.replace(tmp, out)
PY
}

write_deployed() {
  D_COMMIT="$1" D_SUBJECT="$2" D_JOB="$JOB_ID" D_AT="$(now_iso)" \
  D_OUT="$SPOOL/deployed-$TARGET.json" python3 - <<'PY'
import json, os
e = os.environ
out = e["D_OUT"]
with open(out + ".tmp", "w") as f:
    json.dump({"commit": e["D_COMMIT"], "subject": e["D_SUBJECT"],
               "job_id": e["D_JOB"], "deployed_at": e["D_AT"]}, f, ensure_ascii=False)
os.chmod(out + ".tmp", 0o640)
os.replace(out + ".tmp", out)
PY
}

notify() {
  # Best-effort Telegram message to whoever requested the deploy.
  [ -n "$REQ_BY" ] || return 0
  N_ENV="$BACKEND/.env" N_CHAT="$REQ_BY" N_TEXT="$1" python3 - <<'PY' >/dev/null 2>&1 || true
import os, urllib.parse, urllib.request
token = ""
try:
    for line in open(os.environ["N_ENV"]):
        if line.startswith("TELEGRAM_BOT_TOKEN="):
            token = line.split("=", 1)[1].strip().strip('"').strip("'")
except OSError:
    pass
if token:
    data = urllib.parse.urlencode({"chat_id": os.environ["N_CHAT"], "text": os.environ["N_TEXT"]}).encode()
    urllib.request.urlopen(f"https://api.telegram.org/bot{token}/sendMessage", data=data, timeout=10)
PY
}

log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

step() {
  J_STEP="$1"; write_job; log "==> $1"
}

step_done() {
  J_STEPS_DONE="${J_STEPS_DONE:+$J_STEPS_DONE,}$J_STEP"
}

git_() { git -c safe.directory="$APP_DIR" -C "$APP_DIR" "$@"; }

health_check() {
  local i
  for i in $(seq 1 30); do
    if python3 -c 'import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=3)' "$HEALTH_URL" 2>/dev/null; then
      log "health ok ($HEALTH_URL) after ${i}s"
      return 0
    fi
    sleep 1
  done
  log "health check FAILED ($HEALTH_URL)"
  return 1
}

# ---------- rollback ----------
SWAPPED_DIST=0
RESTARTED_API=0
rollback() {
  log "!!! rollback to ${J_FROM:0:12}"
  if [ -n "$J_FROM" ]; then
    git_ checkout -q -f -B "$BRANCH" "$J_FROM" || log "rollback: git checkout failed"
  fi
  if [ "$SWAPPED_DIST" = "1" ] && [ -d "$FRONTEND/dist.prev" ]; then
    rm -rf "$FRONTEND/dist.failed"
    mv "$FRONTEND/dist" "$FRONTEND/dist.failed" 2>/dev/null || true
    mv "$FRONTEND/dist.prev" "$FRONTEND/dist" && log "rollback: previous frontend restored"
  fi
  if [ "$RESTARTED_API" = "1" ]; then
    systemctl restart "$API_SERVICE" || true
    health_check || log "rollback: API still unhealthy, check: journalctl -u $API_SERVICE"
  fi
}

fail() {
  J_ERROR="$1"
  log "ERROR: $1"
  rollback
  J_STATUS="failed"; J_FINISHED="$(now_iso)"; write_job
  notify "❌ TON Nexus · деплой $TARGET не удался: $1. Откат на ${J_FROM:0:7}."
}

# ---------- main pipeline ----------
run_deploy() {
  J_STATUS="running"; J_STARTED="$(now_iso)"; write_job
  log "deploy $JOB_ID target=$TARGET force=$FORCE by=$REQ_BY ($REQ_BY_NAME)"

  [ -d "$APP_DIR/.git" ] || { fail "нет git-репозитория в $APP_DIR"; return; }

  step fetch
  git_ fetch --prune origin "$BRANCH" || { fail "git fetch не удался"; return; }
  J_FROM="$(git_ rev-parse HEAD)"
  J_TO="$(git_ rev-parse "origin/$BRANCH")"
  J_SUBJECT="$(git_ log -1 --format=%s "$J_TO")"
  J_COMMITS="$(git_ log --format='%h%x1f%s%x1f%an' -n 30 "$J_FROM..$J_TO" 2>/dev/null || true)"
  log "from ${J_FROM:0:12} to ${J_TO:0:12}"
  [ -n "$J_COMMITS" ] && printf '%s\n' "$J_COMMITS" | tr '\037' ' ' | sed 's/^/   /'
  step_done

  if [ -n "$(git_ status --porcelain --untracked-files=no)" ]; then
    step autosave
    git_ stash push -m "deploy $JOB_ID autosave" || { fail "не удалось сохранить локальные правки (git stash)"; return; }
    J_WARN="На сервере были ручные правки: сохранены в git stash ('deploy $JOB_ID autosave')."
    log "$J_WARN"
    step_done
  fi

  step checkout
  git_ checkout -q -f -B "$BRANCH" "$J_TO" || { fail "git checkout не удался"; return; }
  step_done

  local changed backend_changed=0 frontend_changed=0 reqs_changed=0 lock_changed=0
  changed="$(git_ diff --name-only "$J_FROM" "$J_TO" || true)"
  grep -q '^backend/' <<<"$changed" && backend_changed=1
  grep -q '^frontend/' <<<"$changed" && frontend_changed=1
  grep -qx 'backend/requirements.txt' <<<"$changed" && reqs_changed=1
  grep -qx 'frontend/package-lock.json' <<<"$changed" && lock_changed=1
  if [ "$FORCE" = "1" ]; then backend_changed=1; frontend_changed=1; reqs_changed=1; lock_changed=1; fi
  [ -f "$FRONTEND/dist/index.html" ] || frontend_changed=1
  [ -d "$FRONTEND/node_modules" ] || lock_changed=1
  log "changes: backend=$backend_changed frontend=$frontend_changed requirements=$reqs_changed lockfile=$lock_changed"

  if [ "$reqs_changed" = "1" ]; then
    step pip
    [ -x "$VENV/bin/pip" ] || { fail "нет venv: $VENV"; return; }
    timeout 600 "$VENV/bin/pip" install -q -r "$BACKEND/requirements.txt" || { fail "pip install не удался"; return; }
    step_done
  fi

  if [ "$backend_changed" = "1" ]; then
    step migrate
    (cd "$BACKEND" && timeout 300 "$VENV/bin/alembic" upgrade head) || { fail "alembic upgrade head не удался"; return; }
    step_done
  fi

  if [ "$frontend_changed" = "1" ]; then
    if [ "$lock_changed" = "1" ]; then
      step npm_ci
      (cd "$FRONTEND" && timeout 900 npm ci --no-audit --no-fund) || { fail "npm ci не удался"; return; }
      step_done
    fi
    step build
    rm -rf "$FRONTEND/dist.new"
    (cd "$FRONTEND" && timeout 900 npm run build -- --outDir dist.new --emptyOutDir) || { rm -rf "$FRONTEND/dist.new"; fail "сборка фронтенда не удалась (старая версия сайта оставлена)"; return; }
    [ -f "$FRONTEND/dist.new/index.html" ] || { fail "после сборки нет dist.new/index.html"; return; }
    rm -rf "$FRONTEND/dist.prev"
    [ -d "$FRONTEND/dist" ] && mv "$FRONTEND/dist" "$FRONTEND/dist.prev"
    mv "$FRONTEND/dist.new" "$FRONTEND/dist"
    SWAPPED_DIST=1
    step_done
  fi

  if [ "$backend_changed" = "1" ]; then
    step restart
    RESTARTED_API=1
    systemctl restart "$API_SERVICE" || { fail "systemctl restart $API_SERVICE не удался"; return; }
    step_done
  fi

  step health
  health_check || { fail "API не отвечает на $HEALTH_URL после обновления"; return; }
  step_done

  if [ "$SWAPPED_DIST" = "1" ]; then
    step nginx
    if nginx -t 2>&1; then
      systemctl reload nginx || log "warning: nginx reload failed"
    else
      J_WARN="${J_WARN:+$J_WARN }nginx -t выдал ошибку, reload пропущен."
      log "warning: nginx -t failed, reload skipped"
    fi
    step_done
  fi

  # Self-update: next deploy will use the runner from the new commit.
  if [ -f "$APP_DIR/scripts/deploy-runner.sh" ] && [ -f "$INSTALLED_RUNNER" ] \
     && ! cmp -s "$APP_DIR/scripts/deploy-runner.sh" "$INSTALLED_RUNNER"; then
    install -m 0755 "$APP_DIR/scripts/deploy-runner.sh" "$INSTALLED_RUNNER" \
      && log "runner updated from repo (takes effect on next deploy)"
  fi

  write_deployed "$J_TO" "$J_SUBJECT"
  J_STATUS="success"; J_STEP=""; J_FINISHED="$(now_iso)"; write_job
  log "deploy finished OK: ${J_TO:0:12} $J_SUBJECT"
  if [ "$J_FROM" = "$J_TO" ]; then
    notify "✅ TON Nexus · $TARGET уже актуален (${J_TO:0:7})."
  else
    notify "✅ TON Nexus · $TARGET обновлён до ${J_TO:0:7}: $J_SUBJECT"
  fi
}

process_request() {
  local req="$1" fields
  JOB_ID="$(basename "$req" .json)"
  if ! [[ "$JOB_ID" =~ $ID_RE ]]; then
    log "skip bad request name: $req"; rm -f "$req"; return
  fi
  fields="$(python3 - "$req" <<'PY' 2>/dev/null
import json, re, sys
d = json.load(open(sys.argv[1]))
t = str(d.get("target", ""))
t = t if re.fullmatch(r"[a-z]{1,16}", t) else ""
by = d.get("requested_by")
by = str(int(by)) if isinstance(by, int) else ""
name = re.sub(r"[^\w .@-]", "", str(d.get("requested_by_name") or ""))[:64]
at = str(d.get("requested_at") or "")
at = at if re.fullmatch(r"[0-9T:.Z+-]{10,40}", at) else ""
print(t or "-", "1" if d.get("force") is True else "0", by or "-", at or "-", name or "-", sep="\t")
PY
)"
  rm -f "$req"
  TARGET="-"; FORCE="0"; REQ_BY="-"; REQ_AT="-"; REQ_BY_NAME="-"
  IFS=$'\t' read -r TARGET FORCE REQ_BY REQ_AT REQ_BY_NAME <<<"$fields"
  [ "$TARGET" = "-" ] && TARGET=""
  [ "$REQ_BY" = "-" ] && REQ_BY=""
  [ "$REQ_AT" = "-" ] && REQ_AT=""
  [ "$REQ_BY_NAME" = "-" ] && REQ_BY_NAME=""
  FORCE="${FORCE:-0}"

  J_STATUS="queued"; J_STEP=""; J_ERROR=""; J_WARN=""; J_FROM=""; J_TO=""; J_SUBJECT=""
  J_STARTED="$(now_iso)"; J_FINISHED=""; J_COMMITS=""; J_STEPS_DONE=""
  SWAPPED_DIST=0; RESTARTED_API=0
  APP_DIR=""; BACKEND=""; FRONTEND=""; BRANCH="main"; API_SERVICE=""

  local logf="$SPOOL/logs/$JOB_ID.log"
  if ! load_target "$TARGET"; then
    TARGET="${TARGET:-unknown}"
    J_STATUS="failed"; J_ERROR="неизвестная цель деплоя: $TARGET"; J_FINISHED="$(now_iso)"
    write_job; echo "$J_ERROR" >"$logf"; return
  fi
  run_deploy >>"$logf" 2>&1
  chmod 0640 "$logf" 2>/dev/null || true
}

# keep last 50 jobs/logs
prune() {
  local f
  # shellcheck disable=SC2012
  ls -1t "$SPOOL"/jobs/*.json 2>/dev/null | tail -n +51 | while read -r f; do
    rm -f "$f" "$SPOOL/logs/$(basename "$f" .json).log"
  done
}

shopt -s nullglob
while :; do
  reqs=("$SPOOL"/requests/*.json)
  [ "${#reqs[@]}" -eq 0 ] && break
  process_request "${reqs[0]}"
done
prune
printf '{"version": "%s", "last_run": "%s"}\n' "$RUNNER_VERSION" "$(now_iso)" >"$SPOOL/runner.json"
exit 0
