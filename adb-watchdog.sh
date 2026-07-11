#!/usr/bin/env bash
# adb-watchdog.sh  —  Manage the ADB watchdog daemon.
#
# The watchdog is a small, independent Node.js process that runs the bot as
# its child. It handles restarts, crash recovery, and lifecycle outside of
# the bot itself — so the bot never has to orchestrate its own death.
#
# Usage:
#   ./adb-watchdog.sh start        Start the watchdog (and the bot)
#   ./adb-watchdog.sh stop         Stop the watchdog (and the bot)
#   ./adb-watchdog.sh restart      Stop + start
#   ./adb-watchdog.sh status       Show daemon + bot status
#   ./adb-watchdog.sh logs         Tail watchdog log output
#   ./adb-watchdog.sh attach       Run watchdog in foreground (Ctrl-C to stop)

set -euo pipefail

BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCHDOG_PID_FILE="$BOT_DIR/data/watchdog.pid"
WATCHDOG_LOG="$BOT_DIR/logs/watchdog.log"
CMD="${1:-help}"

# Source .env so the watchdog and status checks use the correct ports
if [ -f "$BOT_DIR/.env" ]; then
    set -a; source "$BOT_DIR/.env"; set +a
fi

_running() {
    [ -f "$WATCHDOG_PID_FILE" ] && kill -0 "$(cat "$WATCHDOG_PID_FILE")" 2>/dev/null
}

_pid() {
    cat "$WATCHDOG_PID_FILE" 2>/dev/null || echo "?"
}

start() {
    if _running; then
        echo "Watchdog already running (PID $(_pid))."
        exit 1
    fi

    mkdir -p "$BOT_DIR/logs" "$BOT_DIR/data"

    nohup node "$BOT_DIR/core/adb-watchdog.js" >> "$WATCHDOG_LOG" 2>&1 &
    local pid=$!
    echo "$pid" > "$WATCHDOG_PID_FILE"

    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        echo "Watchdog started  │  PID $pid  │  log: $WATCHDOG_LOG"
    else
        rm -f "$WATCHDOG_PID_FILE"
        echo "Watchdog crashed on startup. Logs:"
        tail -10 "$WATCHDOG_LOG" 2>/dev/null || true
        exit 1
    fi
}

stop() {
    if ! _running; then
        echo "Watchdog not running."
        rm -f "$WATCHDOG_PID_FILE"
        return 0
    fi

    local pid
    pid=$(_pid)
    echo "Stopping watchdog (PID $pid)..."

    kill -SIGTERM "$pid"

    local waited=0
    while kill -0 "$pid" 2>/dev/null && (( waited < 15 )); do
        sleep 1
        (( waited++ ))
    done

    if kill -0 "$pid" 2>/dev/null; then
        kill -SIGKILL "$pid"
        echo "Force-killed (PID $pid)"
    else
        echo "Stopped (PID $pid)"
    fi

    rm -f "$WATCHDOG_PID_FILE"
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
        echo "Watchdog: running  │  PID $pid"
        echo "Watchdog log: $WATCHDOG_LOG"

        # Read watchdog port from .env or env var (no hardcoded fallback)
        local wport="${WATCHDOG_PORT:-}"
        if [ -z "$wport" ]; then
            echo "WATCHDOG_PORT not set — cannot check bot status"
            echo ""
            echo "Add WATCHDOG_PORT=3008 to your .env file"
            return
        fi

        local bot_status
        bot_status="$(curl -s "http://localhost:${wport}/status" 2>/dev/null || echo '{"error":"unreachable"}')"
        echo ""
        echo "Bot status (from watchdog API on port ${wport}):"
        echo "$bot_status" | python3 -m json.tool 2>/dev/null || echo "$bot_status"
    elif [ -f "$WATCHDOG_PID_FILE" ]; then
        echo "Watchdog: stopped  │  stale PID $(_pid)"
        rm -f "$WATCHDOG_PID_FILE"
    else
        echo "Watchdog: stopped"
    fi
}

logs() {
    if [ ! -f "$WATCHDOG_LOG" ]; then
        echo "No watchog log yet: $WATCHDOG_LOG"
        exit 1
    fi
    exec tail -f "$WATCHDOG_LOG"
}

attach() {
    mkdir -p "$BOT_DIR/logs" "$BOT_DIR/data"
    echo "Running watchdog in foreground (Ctrl-C to stop all)..."
    node "$BOT_DIR/core/adb-watchdog.js"
}

case "$CMD" in
    start)   start   ;;
    stop)    stop    ;;
    restart) restart ;;
    status)  status  ;;
    logs)    logs    ;;
    attach)  attach  ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs|attach}"
        echo ""
        echo "  start    Start watchdog daemon (starts bot too)"
        echo "  stop     Gracefully stop watchdog + bot"
        echo "  restart  stop + start"
        echo "  status   Show daemon + bot status"
        echo "  logs     Tail watchdog log output"
        echo "  attach   Run watchdog in foreground (Ctrl-C to exit)"
        ;;
esac
