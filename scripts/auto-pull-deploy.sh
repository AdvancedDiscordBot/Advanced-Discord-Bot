#!/bin/bash
set -euo pipefail
cd /home/dead/Prod/Advanced-Discord-Bot

LOG=logs/auto-pull.log
echo "[$(date)] checking for updates..." >> "$LOG"

git fetch origin main >> "$LOG" 2>&1

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "[$(date)] no changes." >> "$LOG"
  exit 0
fi

echo "[$(date)] new commits found ($LOCAL -> $REMOTE), pulling..." >> "$LOG"
git reset --hard origin/main >> "$LOG" 2>&1

echo "[$(date)] rebuilding and restarting docker stack..." >> "$LOG"
docker compose up -d --build >> "$LOG" 2>&1

echo "[$(date)] deploy complete." >> "$LOG"
