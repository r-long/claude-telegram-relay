# Example cron prompt

Drop one or more `.md` files in this directory and reference them from a cron
runner script (see `cron/run-job.sh` and `cron/run-heartbeat.sh`).

Each prompt is just plain text — Claude Code reads it from stdin via
`claude -p "$PROMPT"`. It can use any MCP tools your relay has connected.

## Example: morning brief

```
Generate today's morning brief. Include:

1. **News** — Search the web for 3-5 stories I'd care about. My interests are in
   USER.md.
2. **Today's Focus** — Check memory for any active goals or commitments.
   Surface what needs attention today.

Keep it scannable. End by asking my top 3 priorities.
```

## Example: heartbeat

```
Heartbeat check. Run quick checks (recent emails, calendar, anything urgent in
the last 2 hours). Only report items that need my attention. If nothing does,
respond with just "all clear" (lowercase).
```

Personal prompts are gitignored — write your own without worrying about commits.
