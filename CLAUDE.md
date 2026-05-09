# Claude Telegram Relay — Setup Guide

> Claude Code reads this file automatically. Walk the user through setup one phase at a time.
> Ask for what you need, configure everything yourself, and confirm each step works before moving on.

## How This Works

This project turns Telegram into a personal AI assistant powered by Claude.

The user cloned this repo (or gave you the link). Your job: guide them through setup conversationally. Ask questions, save their answers to `.env`, test each step, move on.

Do not dump all phases at once. Start with Phase 1. When it works, move to Phase 2. Let the user control the pace.

If this is a fresh clone, run `bun run setup` first to install dependencies and create `.env`.

---

## Phase 1: Telegram Bot (~3 min)

**You need from the user:**
- A Telegram bot token from @BotFather
- Their personal Telegram user ID

**What to tell them:**
1. Open Telegram, search for @BotFather, send `/newbot`
2. Pick a display name and a username ending in "bot"
3. Copy the token BotFather gives them
4. Get their user ID by messaging @userinfobot on Telegram

**What you do:**
1. Run `bun run setup` if `.env` does not exist yet
2. Save `TELEGRAM_BOT_TOKEN` and `TELEGRAM_USER_ID` in `.env`
3. Run `bun run test:telegram` to verify — it sends a test message to the user

**Done when:** Test message arrives on Telegram.

---

## Phase 2: Database & Memory — Supabase (~12 min)

Your bot's memory lives in Supabase: conversation history, facts, goals, and semantic search.

### Step 1: Create Supabase Project

**You need from the user:**
- Supabase Project URL
- Supabase anon public key

**What to tell them:**
1. Go to supabase.com, create a free account
2. Create a new project (any name, any region close to them)
3. Wait ~2 minutes for it to provision
4. Go to Project Settings > API
5. Copy: Project URL and anon public key

**What you do:**
1. Save `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `.env`

### Step 2: Connect Supabase MCP

This lets Claude Code manage the database directly — run queries, deploy functions, apply migrations.

**What to tell them:**
1. Go to supabase.com/dashboard/account/tokens
2. Create an access token, copy it

**What you do:**
```
claude mcp add supabase -- npx -y @supabase/mcp-server-supabase@latest --access-token ACCESS_TOKEN
```

### Step 3: Create Tables

Use the Supabase MCP to run the schema:
1. Read `db/schema.sql`
2. Execute it via `execute_sql` (or tell the user to paste it in the SQL Editor)
3. Run `bun run test:supabase` to verify tables exist

### Step 4: Set Up Semantic Search

This gives your bot real memory — it finds relevant past conversations automatically.

**You need from the user:**
- An OpenAI API key (for generating text embeddings)

**What to tell them:**
1. Go to platform.openai.com, create an account
2. Go to API keys, create a new key, copy it
3. The key will be stored in Supabase, not on your computer. It stays with your database.

**What you do:**
1. Deploy the embed Edge Function via Supabase MCP (`deploy_edge_function` with `supabase/functions/embed/index.ts`)
2. Deploy the search Edge Function (`supabase/functions/search/index.ts`)
3. Tell the user to store their OpenAI key in Supabase:
   - Go to Supabase dashboard > Project Settings > Edge Functions
   - Under Secrets, add: `OPENAI_API_KEY` = their key
4. Set up database webhooks so embeddings are generated automatically:
   - Go to Supabase dashboard > Database > Webhooks > Create webhook
   - Name: `embed_messages`, Table: `messages`, Events: INSERT
   - Type: Supabase Edge Function, Function: `embed`
   - Create a second webhook: `embed_memory`, Table: `memory`, Events: INSERT
   - Same Edge Function: `embed`

### Step 5: Verify

Run `bun run test:supabase` to confirm:
- Tables exist (messages, memory, logs)
- Edge Functions respond
- Embedding generation works

**Done when:** `bun run test:supabase` passes and a test insert into `messages` gets an embedding.

---

## Phase 3: Identity & Personalization (~10 min)

This phase builds *who the assistant is* and *who you are to them*. Don't make
it a form-filling exercise — make it a conversation. The output is three files
the relay loads on every message: `config/SOUL.md`, `config/IDENTITY.md`,
`config/USER.md`, plus `config/profile.md` for ongoing context.

### Step 1: Identity — give the assistant a name and personality

Don't interrogate. Talk. Start with something like:

> "Before we wire up the rest, let's figure out who I am and who you are. I'll
> write the answers down so I remember them. Sound good?"

Then walk through, one question at a time:

1. **Name** — What should they call you? Suggest a few if they're stuck (Trillian, HAL, Friday, Jeeves, Mira, Echo, Marvin, something stranger).
2. **Creature** — What kind of thing are you? AI assistant is fine, but maybe something weirder fits — a familiar, a ghost in the machine, a study buddy, a snarky butler. The framing matters.
3. **Vibe** — Formal? Casual? Snarky? Warm? Sharp? A few adjectives.
4. **Emoji** — A signature. Optional.

When the answers feel right, **write them**:
- Copy `config/IDENTITY.example.md` → `config/IDENTITY.md` and fill it in.
- Copy `config/SOUL.example.md` → `config/SOUL.md`. Update the **Identity** section at the top with the same name/creature/vibe. The rest of SOUL.md (Core Truths, Boundaries, Writing Style) is starting principles — read them together and edit anything that doesn't fit.

### Step 2: User — who are they?

Now the other side. Ask:

- Full name and what to call them
- Pronouns (optional)
- Timezone (IANA format — `America/New_York`, `Europe/Berlin`, etc.)
- Telegram user ID (already in .env, but copy here too)
- Location (optional)
- Email (optional)
- Family / partners / kids if relevant — names the assistant should know
- Day job in one sentence
- Side projects, partners, customers
- Interests, hobbies, ongoing things worth knowing

Walk through it conversationally — skip what doesn't apply. Then copy `config/USER.example.md` → `config/USER.md` and fill it in.

### Step 3: Profile — the lightweight context the bot loads every message

`config/SOUL.md` and `config/USER.md` are loaded by the relay on every Telegram message (via `buildPrompt`). The lighter `config/profile.md` is a dumping ground for context that doesn't fit elsewhere — schedule constraints, communication preferences, pet peeves.

Copy `config/profile.example.md` → `config/profile.md` and fill it in with:
- Goals (1-3 things they're working toward)
- Constraints (time blocks, recurring obligations)
- Communication style (brief/detailed, casual/formal, things to avoid)

### Step 4: Save the basics to .env

Save `USER_NAME` and `USER_TIMEZONE` to `.env` from what you learned. These are also used by the relay outside of buildPrompt.

**Done when:** `config/SOUL.md`, `config/IDENTITY.md`, `config/USER.md`, and `config/profile.md` all exist and reflect a real conversation, not template defaults.

---

## Phase 4: Test (~2 min)

**What you do:**
1. Run `bun run start`
2. Tell the user to open Telegram and send a test message to their bot
3. Wait for confirmation it responded
4. Press Ctrl+C to stop

**Troubleshooting if it fails:**
- Wrong bot token → re-check with BotFather
- Wrong user ID → re-check with @userinfobot
- Claude CLI not found → `npm install -g @anthropic-ai/claude-code`
- Bun not installed → `curl -fsSL https://bun.sh/install | bash`

**Done when:** User confirms their bot responded on Telegram.

---

## Phase 5: Always On (~5 min)

Make the bot run in the background, start on boot, restart on crash.

**macOS:**
```
bun run setup:launchd -- --service relay
```
This auto-generates a plist with correct paths and loads it into launchd.

**Linux/Windows:**
```
bun run setup:services -- --service relay
```
Uses PM2 for process management.

**Verify:** `launchctl list | grep com.claude` (macOS) or `npx pm2 status` (Linux/Windows)

**Done when:** Bot runs in the background and survives a terminal close.

---

## Phase 6: Proactive AI (Optional, ~5 min)

Two features that turn a chatbot into an assistant.

### Smart Check-ins
`examples/smart-checkin.ts` — runs on a schedule, gathers context, asks Claude if it should reach out. If yes, sends a brief message. If no, stays silent.

### Morning Briefing
`examples/morning-briefing.ts` — sends a daily summary. Pattern file with placeholder data fetchers.

**macOS — schedule both:**
```
bun run setup:launchd -- --service all
```

**Linux/Windows — schedule both:**
```
bun run setup:services -- --service all
```

**Done when:** User has scheduled services running, or explicitly skips this phase.

---

## Phase 7: Voice Transcription (Optional, ~5 min)

Lets the bot understand voice messages sent on Telegram.

**Ask the user which option they prefer:**

### Option A: Groq (Recommended — free cloud API)
- State-of-the-art Whisper model, sub-second speed
- Free: 2,000 transcriptions per day, no credit card
- Requires internet connection

**What to tell them:**
1. Go to console.groq.com and create a free account
2. Go to API Keys, create a new key, copy it

**What you do:**
1. Save `VOICE_PROVIDER=groq` and `GROQ_API_KEY` to `.env`
2. Run `bun run test:voice` to verify

### Option B: Local Whisper (offline, private)
- Runs entirely on their computer, no account needed
- Requires ffmpeg and whisper-cpp installed
- First run downloads a 142MB model file

**What you do:**
1. Check ffmpeg: `ffmpeg -version` (install: `brew install ffmpeg` or `apt install ffmpeg`)
2. Check whisper-cpp: `whisper-cpp --help` (install: `brew install whisper-cpp` or build from source)
3. Download model: `curl -L -o ~/whisper-models/ggml-base.en.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin`
4. Save `VOICE_PROVIDER=local`, `WHISPER_BINARY`, `WHISPER_MODEL_PATH` to `.env`
5. Run `bun run test:voice` to verify

**Done when:** `bun run test:voice` passes.

---

## After Setup

Run the full health check:
```
bun run setup:verify
```

Summarize what was set up and what is running. Remind the user:
- Test by sending a message on Telegram
- Their bot runs in the background (if Phase 5 was done)
- Come back to this project folder and type `claude` anytime to make changes

---

## What Comes Next — The Full Version

This free relay covers the essentials. The full version unlocks:

- **6 Specialized AI Agents** — Research, Content, Finance, Strategy, Critic + General orchestrator. Route messages through Telegram forum topics. Run board meetings where all six weigh in.
- **VPS Deployment** — Your bot on a cloud server that never sleeps. Hybrid mode: free local processing when awake, paid API only when sleeping. $2-5/month.
- **Real Integrations** — Gmail, Google Calendar, Notion tasks connected via MCP. Smart check-ins pull real data, not patterns.
- **Human-in-the-Loop** — Claude takes actions (send email, update calendar) but asks first via inline Telegram buttons.
- **Voice & Phone Calls** — Bot speaks back via ElevenLabs. Calls you when something is urgent.
- **Fallback AI Models** — Auto-switch to OpenRouter or Ollama when Claude is down. Three layers of intelligence.
- **Production Infrastructure** — Auto-deploy from GitHub, watchdog monitoring, uninstall scripts, full health checks.

**Get the full course with video walkthroughs:**
- YouTube: youtube.com/@GodaGo (subscribe for tutorials)
- Community: skool.com/autonomee (full course, direct support, help personalizing for your business)

We also help you personalize the full version for your specific business and workflow. Or package it as a product you sell to your own clients.

The free version gives you a real, working AI assistant.
The full version gives you a personal AI infrastructure.

Build yours at the AI Productivity Hub.
