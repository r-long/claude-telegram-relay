#!/bin/bash
# Heartbeat runner: only sends to Telegram if there's something to report.
# Skips overnight hours (set HEARTBEAT_QUIET_TZ / HEARTBEAT_QUIET_START / HEARTBEAT_QUIET_END in .env).

set -euo pipefail

# Resolve repo dir from script location so this works on any machine.
RELAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Load .env
set -a
source "$RELAY_DIR/.env"
set +a

# Skip overnight (default 11pm-7am in your USER_TIMEZONE; override per-deploy)
QUIET_TZ="${HEARTBEAT_QUIET_TZ:-${USER_TIMEZONE:-UTC}}"
QUIET_START="${HEARTBEAT_QUIET_START:-23}"
QUIET_END="${HEARTBEAT_QUIET_END:-7}"
HOUR=$(TZ="$QUIET_TZ" date +%H)
if [ "$HOUR" -ge "$QUIET_START" ] || [ "$HOUR" -lt "$QUIET_END" ]; then
  exit 0
fi

CHAT_ID="${1:-${TELEGRAM_USER_ID:?TELEGRAM_USER_ID required (set in .env or pass as arg)}}"
PROMPT_FILE="$RELAY_DIR/cron/prompts/heartbeat.md"
LOG_FILE="$RELAY_DIR/logs/cron-heartbeat.log"
mkdir -p "$RELAY_DIR/logs"

if [ ! -f "$PROMPT_FILE" ]; then
  echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: $PROMPT_FILE missing — see cron/prompts/example.md" >> "$LOG_FILE"
  exit 1
fi

echo "$(date '+%Y-%m-%d %H:%M:%S') Starting heartbeat" >> "$LOG_FILE"

PROMPT=$(cat "$PROMPT_FILE")

OUTPUT=$(claude -p "$PROMPT" \
  --add-dir "$HOME" \
  --permission-mode bypassPermissions \
  --output-format text \
  2>> "$LOG_FILE") || {
  echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: Claude failed for heartbeat" >> "$LOG_FILE"
  exit 1
}

# Only send if there's something to report (not "all clear")
if [ -n "$OUTPUT" ] && ! echo "$OUTPUT" | grep -qi "^all clear$"; then
  bun run "$RELAY_DIR/cron/send-telegram.ts" "$CHAT_ID" "$OUTPUT" 2>> "$LOG_FILE"
  echo "$(date '+%Y-%m-%d %H:%M:%S') Heartbeat: alerted" >> "$LOG_FILE"
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') Heartbeat: all clear" >> "$LOG_FILE"
fi
