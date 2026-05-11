# Setup Prompt

Paste the prompt below into a fresh Claude Code session on a new machine. It
hands Claude the repo URL and tells it to drive setup conversationally via
`CLAUDE.md`.

> The bootstrap-style **Phase 3: Identity & Personalization** in `CLAUDE.md`
> walks you through naming the assistant and shaping its personality before
> any of the technical wiring. The prompt below makes sure Claude reads it
> first instead of jumping straight to API keys.

---

## The prompt

```
I want to set up a Telegram → Claude Code bridge with persistent
Supabase-backed memory and a custom AI persona. Walk me through it.

## Step 1 — Get the code

Clone https://github.com/r-long/claude-telegram-relay into
~/Desktop/claude-telegram-relay-master (or wherever I tell you), then
`cd` in and run `bun run setup` to install dependencies and create .env.

## Step 2 — Read CLAUDE.md and walk me through it

The repo's CLAUDE.md is the source of truth for the setup. Read it and
then drive me through the phases conversationally — one phase at a time,
ask one question at a time, verify before moving on. Don't dump it all
at once.

Pay special attention to **Phase 3: Identity & Personalization**. Don't
treat it like a form. Talk to me. Help me figure out who the assistant
should be (name, creature, vibe, emoji) and write the answers to
config/SOUL.md, config/IDENTITY.md, and config/USER.md from the
.example versions. Same for config/profile.md.

Skip Phase 6 (proactive cron jobs) and Phase 7 (voice transcription)
unless I ask for them.

## Step 3 — Verify

When CLAUDE.md says we're done:

1. `bun run start` should print "Bot is running!" and "Bot username:
   @<botname>".
2. Send my bot a text message → confirm it replies and the personality
   matches what we configured.
3. Send my bot an image with a caption referencing earlier context (e.g.
   "remember the X we discussed?") → confirm Claude has the context, not
   a cold start.
4. `cat ~/.claude-relay/sessions.json` should show my chat id mapped to
   a session_id uuid (proves CLI session resume is working).
5. Set up the supervisor:
   - Linux: `bun run setup:services -- --service relay`
   - macOS: `bun run setup:launchd -- --service relay`
   And confirm it survives a terminal close.

If any step fails, diagnose root cause — don't paper over.
```

---

## Bringing your stuff with you

These files are gitignored and won't come along when Claude clones the repo.
The bootstrap conversation in Phase 3 will recreate the persona files from
scratch — but if you want to skip that and reuse what you already have, copy
these manually after the clone:

| File | Contents |
|---|---|
| `.env` | Telegram token, Supabase creds, USER_NAME, USER_TIMEZONE |
| `config/SOUL.md` | Assistant's persona |
| `config/IDENTITY.md` | Assistant's name/vibe |
| `config/USER.md` | Your details |
| `config/profile.md` | Lightweight ongoing context |
| `config/channels.json` | Group-chat channel hints |
| `cron/prompts/*.md` | Personal cron prompts (heartbeat, morning brief, etc.) |
