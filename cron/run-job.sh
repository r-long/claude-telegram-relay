#!/bin/bash
# Cron job runner: spawns Claude with a prompt, sends output to Telegram.
# Usage: run-job.sh <job-name> <chat-id> <prompt-file>

set -euo pipefail

# Resolve repo dir from script location so this works on any machine.
RELAY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Load .env
set -a
source "$RELAY_DIR/.env"
set +a

JOB_NAME="${1:-}"
CHAT_ID="${2:-}"
PROMPT_FILE="${3:-}"

if [ -z "$JOB_NAME" ] || [ -z "$CHAT_ID" ] || [ -z "$PROMPT_FILE" ]; then
  echo "Usage: run-job.sh <job-name> <chat-id> <prompt-file>"
  exit 1
fi

LOG_DIR="$RELAY_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/cron-${JOB_NAME}.log"

echo "$(date '+%Y-%m-%d %H:%M:%S') Starting $JOB_NAME" >> "$LOG_FILE"

PROMPT=$(cat "$PROMPT_FILE")

# Run Claude with the prompt
OUTPUT=$(claude -p "$PROMPT" \
  --add-dir "$HOME" \
  --permission-mode bypassPermissions \
  --output-format text \
  2>> "$LOG_FILE") || {
  echo "$(date '+%Y-%m-%d %H:%M:%S') ERROR: Claude failed for $JOB_NAME" >> "$LOG_FILE"
  exit 1
}

if [ -n "$OUTPUT" ]; then
  bun run "$RELAY_DIR/cron/send-telegram.ts" "$CHAT_ID" "$OUTPUT" 2>> "$LOG_FILE"
  echo "$(date '+%Y-%m-%d %H:%M:%S') Delivered $JOB_NAME to $CHAT_ID" >> "$LOG_FILE"
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') No output from $JOB_NAME" >> "$LOG_FILE"
fi
