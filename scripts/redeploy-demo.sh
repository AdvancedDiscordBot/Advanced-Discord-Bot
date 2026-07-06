#!/usr/bin/env bash
#
# redeploy-demo.sh — pull latest code + reset the ADB trial demo to brand-new.
#
# What it does, every run:
#   1. Pull the latest main from GitHub (hard reset; local drift never blocks).
#   2. Tear down the stack AND destroy its volumes  -> wipes Mongo (all users,
#      settings, economy, tickets, XP, plugin configs) and the registry cache.
#   3. Rebuild the image from the fresh code and start clean.
#   4. Scoped cleanup of only THIS project's dangling images.
#
# It is deliberately namespaced to the `adb` compose project, so it NEVER
# touches the other containers/volumes/images running on this host.
#
# Intended to be run from cron every ~5h. Safe to run by hand any time.

set -euo pipefail

# --- config ---------------------------------------------------------------
REPO_DIR="/home/dead/Prod/Advanced-Discord-Bot"
BRANCH="main"
PROJECT="adb-prod"                       # must match `name:` in docker-compose.yml
LOG_FILE="${REPO_DIR}/logs/redeploy-demo.log"
LOCK_FILE="/tmp/adb-redeploy.lock"

# --- single-instance lock -------------------------------------------------
# Prevents a slow run (big rebuild) from overlapping the next cron tick.
exec 9>"${LOCK_FILE}"
if ! flock -n 9; then
  echo "$(date '+%F %T') [skip] another redeploy is already running" >>"${LOG_FILE}"
  exit 0
fi

# --- logging --------------------------------------------------------------
mkdir -p "$(dirname "${LOG_FILE}")"
exec >>"${LOG_FILE}" 2>&1
log() { echo "$(date '+%F %T') $*"; }

log "===== redeploy start ====="
cd "${REPO_DIR}"

# --- 1. pull latest code --------------------------------------------------
# Hard reset so a dirty working tree or diverged history can never block the
# deploy. .env and the data/ volume are untracked/ignored, so they survive.
log "[git] fetching origin/${BRANCH}"
git fetch --prune origin "${BRANCH}"
OLD_REV="$(git rev-parse --short HEAD)"
git reset --hard "origin/${BRANCH}"
NEW_REV="$(git rev-parse --short HEAD)"
log "[git] ${OLD_REV} -> ${NEW_REV}"

# --- 2. reset: destroy stack + volumes ------------------------------------
log "[reset] docker compose down -v (wipes mongo + data volumes)"
docker compose -p "${PROJECT}" down -v --remove-orphans || true

# --- 3. rebuild from fresh code + start -----------------------------------
log "[deploy] docker compose up -d --build"
docker compose -p "${PROJECT}" up -d --build

# --- 4. scoped cleanup ----------------------------------------------------
# Only dangling images belonging to THIS project. Never a global prune.
log "[cleanup] pruning dangling images for project=${PROJECT}"
docker image prune -f \
  --filter "dangling=true" \
  --filter "label=com.docker.compose.project=${PROJECT}" || true

log "[status] running containers:"
docker compose -p "${PROJECT}" ps
log "===== redeploy done ====="
