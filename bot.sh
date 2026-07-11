#!/usr/bin/env bash
set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$BOT_DIR/data/bot.pid"
LOG_FILE="$BOT_DIR/logs/bot.log"
WATCHDOG_PID_FILE="$BOT_DIR/data/watchdog.pid"
CMD="${1:-help}"

_watchdog_running() {
    [ -f "$WATCHDOG_PID_FILE" ] && kill -0 "$(cat "$WATCHDOG_PID_FILE")" 2>/dev/null
}

_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

_pid() {
    cat "$PID_FILE" 2>/dev/null || echo "?"
}

start() {
    if _watchdog_running; then
        echo "Watchdog is running — use ./adb-watchdog.sh for lifecycle management."
        echo "The watchdog manages the bot automatically; no need to start it manually."
        exit 0
    fi

    if _running; then
        echo "Already running (PID $(_pid)). Use 'restart' to restart."
        exit 1
    fi

    mkdir -p "$BOT_DIR/logs" "$BOT_DIR/data"
    printf '\n[%s] ──── Starting bot ────\n' "$(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG_FILE"

    nohup node "$BOT_DIR/index.js" >> "$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"

    # give it a moment to confirm it didn't immediately crash
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        echo "Bot started  │  PID $pid  │  log: $LOG_FILE"
    else
        rm -f "$PID_FILE"
        echo "Bot crashed on startup. Check logs:"
        tail -20 "$LOG_FILE"
        exit 1
    fi
}

stop() {
    if _watchdog_running; then
        echo "Watchdog is running — use ./adb-watchdog.sh stop or the dashboard."
        echo "Killing the bot directly will cause the watchdog to restart it."
        return 0
    fi

    if ! _running; then
        echo "Bot not running."
        rm -f "$PID_FILE"
        return 0
    fi

    local pid
    pid=$(_pid)
    echo "Stopping bot (PID $pid)..."

    kill -SIGTERM "$pid"

    local waited=0
    while kill -0 "$pid" 2>/dev/null && (( waited < 10 )); do
        sleep 1
        (( waited++ ))
    done

    if kill -0 "$pid" 2>/dev/null; then
        kill -SIGKILL "$pid"
        echo "Force-killed (PID $pid)"
    else
        echo "Stopped (PID $pid)"
    fi

    rm -f "$PID_FILE"
}

restart() {
    stop
    sleep 1
    start
}

status() {
    if _running; then
        local pid
        pid=$(_pid)
        echo "Bot: running  │  PID $pid"
        echo "Log: $LOG_FILE"
        ps -p "$pid" -o pid=,etime=,pcpu=,pmem= --no-headers 2>/dev/null \
            | awk '{printf "      uptime %-12s  cpu %s%%  mem %s%%\n", $2, $3, $4}' \
            || true
    elif [ -f "$PID_FILE" ]; then
        echo "Bot: stopped  │  stale PID $(_pid) (removed)"
        rm -f "$PID_FILE"
    else
        echo "Bot: stopped"
    fi
}

logs() {
    if [ ! -f "$LOG_FILE" ]; then
        echo "No log file yet: $LOG_FILE"
        exit 1
    fi
    exec tail -f "$LOG_FILE"
}

case "$CMD" in
    start)   start   ;;
    stop)    stop    ;;
    restart) restart ;;
    status)  status  ;;
    logs)    logs    ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "  start      Start bot directly (or use ./adb-watchdog.sh for production)"
        echo "  stop       Gracefully stop the bot (SIGTERM, SIGKILL after 10s)"
        echo "  restart  stop + start"
        echo "  status   Show running state, PID, uptime, cpu/mem"
        echo "  logs     Tail live log output (Ctrl-C to exit)"
        ;;
esac
