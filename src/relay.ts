/**
 * Claude Code Telegram Relay
 *
 * Minimal relay that connects Telegram to Claude Code CLI.
 * Customize this for your own needs.
 *
 * Run: bun run src/relay.ts
 */

import { Bot, Context } from "grammy";
import { spawn } from "bun";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import { join, dirname } from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { transcribe } from "./transcribe.ts";
import {
  processMemoryIntents,
  getMemoryContext,
  getRelevantContext,
  getRecentMessages,
} from "./memory.ts";

const PROJECT_ROOT = dirname(dirname(import.meta.path));

// ============================================================
// CONFIGURATION
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID || "";
const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const PROJECT_DIR = process.env.PROJECT_DIR || "";
const RELAY_DIR = process.env.RELAY_DIR || join(process.env.HOME || "~", ".claude-relay");

// Group chat channel mappings: chatId -> channel name.
// Channel names are arbitrary strings. The valid set (for /channel <name>
// validation and group-title auto-detect) comes from config/channels.json
// — see config/channels.example.json for the format.
const CHANNEL_MAP_FILE = join(process.env.RELAY_DIR || join(process.env.HOME || "~", ".claude-relay"), "channels.json");
let channelMap: Record<string, string> = {};

async function loadChannelMap(): Promise<Record<string, string>> {
  try {
    const content = await readFile(CHANNEL_MAP_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveChannelMap(): Promise<void> {
  await writeFile(CHANNEL_MAP_FILE, JSON.stringify(channelMap, null, 2));
}

channelMap = await loadChannelMap();

// Auto-detect channel from group title using the configured channel names.
function detectChannelFromTitle(title: string): string | null {
  const lower = title.toLowerCase();
  for (const ch of Object.keys(channelHints)) {
    if (lower.includes(ch)) return ch;
  }
  return null;
}

// Get or auto-detect channel for a chat
function getChannel(ctx: Context): string {
  const chatId = ctx.chat?.id.toString() || "";
  if (channelMap[chatId]) return channelMap[chatId];
  if (!isGroupChat(ctx)) return "direct";

  // Try auto-detect from group title
  const title = (ctx.chat as any)?.title || "";
  const detected = detectChannelFromTitle(title);
  if (detected) {
    channelMap[chatId] = detected;
    saveChannelMap(); // fire and forget
    console.log(`Auto-mapped group "${title}" (${chatId}) → ${detected}`);
    return detected;
  }

  return "unknown";
}

// Directories
const TEMP_DIR = join(RELAY_DIR, "temp");
const UPLOADS_DIR = join(RELAY_DIR, "uploads");

// Session tracking for conversation continuity (per chat)
const SESSION_FILE = join(RELAY_DIR, "sessions.json");

interface SessionState {
  sessionId: string | null;
  lastActivity: string;
}

// ============================================================
// SESSION MANAGEMENT (per chat ID)
// ============================================================

let sessions: Record<string, SessionState> = {};

async function loadSessions(): Promise<Record<string, SessionState>> {
  try {
    const content = await readFile(SESSION_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function saveSessions(): Promise<void> {
  await writeFile(SESSION_FILE, JSON.stringify(sessions, null, 2));
}

function getSession(chatId: string): SessionState {
  if (!sessions[chatId]) {
    sessions[chatId] = { sessionId: null, lastActivity: new Date().toISOString() };
  }
  return sessions[chatId];
}

sessions = await loadSessions();

// ============================================================
// LOCK FILE (prevent multiple instances)
// ============================================================

const LOCK_FILE = join(RELAY_DIR, "bot.lock");

async function acquireLock(): Promise<boolean> {
  try {
    const existingLock = await readFile(LOCK_FILE, "utf-8").catch(() => null);

    if (existingLock) {
      const pid = parseInt(existingLock);
      try {
        process.kill(pid, 0); // Check if process exists
        console.log(`Another instance running (PID: ${pid})`);
        return false;
      } catch {
        console.log("Stale lock found, taking over...");
      }
    }

    await writeFile(LOCK_FILE, process.pid.toString());
    return true;
  } catch (error) {
    console.error("Lock error:", error);
    return false;
  }
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_FILE).catch(() => {});
}

// Cleanup on exit
process.on("exit", () => {
  try {
    require("fs").unlinkSync(LOCK_FILE);
  } catch {}
});
process.on("SIGINT", async () => {
  await releaseLock();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await releaseLock();
  process.exit(0);
});

// ============================================================
// SETUP
// ============================================================

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set!");
  console.log("\nTo set up:");
  console.log("1. Message @BotFather on Telegram");
  console.log("2. Create a new bot with /newbot");
  console.log("3. Copy the token to .env");
  process.exit(1);
}

// Create directories
await mkdir(TEMP_DIR, { recursive: true });
await mkdir(UPLOADS_DIR, { recursive: true });

// ============================================================
// SUPABASE (optional — only if configured)
// ============================================================

const supabase: SupabaseClient | null =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

async function saveMessage(
  role: string,
  content: string,
  chatId: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("messages").insert({
      role,
      content,
      channel: `telegram:${chatId}`,
      metadata: metadata || {},
    });
  } catch (error) {
    console.error("Supabase save error:", error);
  }
}

// Acquire lock
if (!(await acquireLock())) {
  console.error("Could not acquire lock. Another instance may be running.");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ============================================================
// SECURITY: Only respond to authorized user
// ============================================================

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();

  // If ALLOWED_USER_ID is set, enforce it (checks sender, works in groups too)
  if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
    console.log(`Unauthorized: ${userId}`);
    // Only reply "private" in DMs, stay silent in groups for unknown users
    if (ctx.chat?.type === "private") {
      await ctx.reply("This bot is private.");
    }
    return;
  }

  await next();
});

// ============================================================
// GROUP CHAT: Only respond when @mentioned, replied to, or command
// ============================================================

let botUsername = "";
bot.api.getMe().then((me) => {
  botUsername = me.username || "";
  console.log(`Bot username: @${botUsername}`);
});

function isGroupChat(ctx: Context): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function shouldRespondInGroup(ctx: Context): boolean {
  if (!isGroupChat(ctx)) return true; // Always respond in DMs

  // In mapped/known groups, respond to all messages from the authorized user
  const chatId = ctx.chat?.id.toString() || "";
  const title = (ctx.chat as any)?.title || "";
  if (channelMap[chatId] || detectChannelFromTitle(title)) return true;

  // Unmapped groups: only respond to @mentions, replies, or commands
  const text = ctx.message?.text || ctx.message?.caption || "";
  if (text.startsWith("/")) return true;
  if (botUsername && text.toLowerCase().includes(`@${botUsername.toLowerCase()}`)) return true;
  if (ctx.message?.reply_to_message?.from?.username === botUsername) return true;

  return false;
}

// Strip @botname from message text so Claude sees clean input
function cleanGroupMessage(text: string): string {
  if (!botUsername) return text;
  return text.replace(new RegExp(`@${botUsername}\\b`, "gi"), "").trim();
}

// ============================================================
// CORE: Call Claude CLI
// ============================================================

async function callClaude(
  prompt: string,
  options?: { resume?: boolean; imagePath?: string; session?: SessionState }
): Promise<string> {
  const ADD_DIR = process.env.CLAUDE_ADD_DIR || process.env.HOME || ".";
  const args = [CLAUDE_PATH, "-p", prompt, "--add-dir", ADD_DIR, "--permission-mode", "bypassPermissions"];

  const chatSession = options?.session;

  // Resume previous session if available and requested
  if (options?.resume && chatSession?.sessionId) {
    args.push("--resume", chatSession.sessionId);
  }

  args.push("--output-format", "json");

  console.log(`Calling Claude: ${prompt.substring(0, 50)}...`);

  try {
    const proc = spawn(args, {
      stdout: "pipe",
      stderr: "pipe",
      cwd: PROJECT_DIR || undefined,
      env: {
        ...process.env,
      },
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("Claude error:", stderr);
      return `Error: ${stderr || "Claude exited with code " + exitCode}`;
    }

    let parsed: { session_id?: string; result?: string; is_error?: boolean } | null = null;
    try {
      parsed = JSON.parse(output.trim());
    } catch {
      console.error("Claude JSON parse failed, raw output:", output.slice(0, 500));
      return output.trim();
    }

    if (parsed?.session_id && chatSession) {
      chatSession.sessionId = parsed.session_id;
      chatSession.lastActivity = new Date().toISOString();
      await saveSessions();
    }

    if (parsed?.is_error) {
      return `Error: ${parsed.result ?? "Claude reported an error"}`;
    }

    return (parsed?.result ?? "").trim();
  } catch (error) {
    console.error("Spawn error:", error);
    return `Error: Could not run Claude CLI`;
  }
}

// ============================================================
// COMMANDS: Channel management for groups
// ============================================================

bot.command("channel", async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const args = ctx.match?.trim();

  if (!args) {
    // Show current channel
    const current = channelMap[chatId];
    if (current) {
      await ctx.reply(`This chat is mapped to channel: **${current}**`, { parse_mode: "Markdown" });
    } else if (isGroupChat(ctx)) {
      await ctx.reply(`This group isn't mapped to a channel yet.\nUse: /channel random|personal|projects|pathik`);
    } else {
      await ctx.reply("Channel mapping is for group chats. This is a DM (direct).");
    }
    return;
  }

  const channel = args.toLowerCase();
  const validChannels = Object.keys(channelHints);
  if (validChannels.length > 0 && !validChannels.includes(channel)) {
    await ctx.reply(`Unknown channel "${channel}". Configured: ${validChannels.join(", ")}\n\n(Add new channels by editing config/channels.json.)`);
    return;
  }

  channelMap[chatId] = channel;
  await saveChannelMap();
  await ctx.reply(`Mapped this chat to channel: **${channel}**`, { parse_mode: "Markdown" });
});

// Auto-detect when bot is added to a group
bot.on("my_chat_member", async (ctx) => {
  const chat = ctx.myChatMember.chat;
  const newStatus = ctx.myChatMember.new_chat_member.status;

  if ((chat.type === "group" || chat.type === "supergroup") && (newStatus === "member" || newStatus === "administrator")) {
    const chatId = chat.id.toString();
    const title = (chat as any).title || "";
    const detected = detectChannelFromTitle(title);

    if (detected) {
      channelMap[chatId] = detected;
      await saveChannelMap();
      console.log(`Bot added to group "${title}" (${chatId}) → auto-mapped to ${detected}`);
      await ctx.api.sendMessage(chat.id, `Mapped to #${detected}. I'll respond to all messages here.`);
    } else {
      await ctx.api.sendMessage(chat.id, `Added! Use /channel random|personal|projects to set this group's channel.`);
    }
  }
});

bot.command("groups", async (ctx) => {
  if (Object.keys(channelMap).length === 0) {
    await ctx.reply("No groups mapped yet. Add the bot to a group and use /channel <name>.");
    return;
  }

  const lines = Object.entries(channelMap).map(
    ([chatId, channel]) => `• **${channel}** → chat ${chatId}`
  );
  await ctx.reply(`Mapped groups:\n${lines.join("\n")}`, { parse_mode: "Markdown" });
});

// ============================================================
// MESSAGE HANDLERS
// ============================================================

// Text messages
bot.on("message:text", async (ctx) => {
  // In groups, only respond when @mentioned, replied to, or command
  if (!shouldRespondInGroup(ctx)) return;

  const rawText = ctx.message.text;
  const text = isGroupChat(ctx) ? cleanGroupMessage(rawText) : rawText;
  if (!text) return; // Empty after stripping @mention

  const chatId = ctx.chat.id.toString();
  const channel = getChannel(ctx);
  console.log(`Message [${channel}:${chatId}]: ${text.substring(0, 50)}...`);

  await ctx.replyWithChatAction("typing");

  await saveMessage("user", text, chatId, { channel });

  // Gather context: recent messages + semantic search + facts/goals (scoped to this chat)
  const [recentMessages, relevantContext, memoryContext] = await Promise.all([
    getRecentMessages(supabase, 20, chatId),
    getRelevantContext(supabase, text),
    getMemoryContext(supabase),
  ]);

  const session = getSession(chatId);
  const enrichedPrompt = buildPrompt(text, relevantContext, memoryContext, recentMessages, channel);
  const rawResponse = await callClaude(enrichedPrompt, { resume: true, session });

  // Parse and save any memory intents, strip tags from response
  const response = await processMemoryIntents(supabase, rawResponse);

  await saveMessage("assistant", response, chatId);
  await sendResponse(ctx, response);
});

// Voice messages
bot.on("message:voice", async (ctx) => {
  if (!shouldRespondInGroup(ctx)) return;

  const voice = ctx.message.voice;
  console.log(`Voice message: ${voice.duration}s`);
  await ctx.replyWithChatAction("typing");

  if (!process.env.VOICE_PROVIDER) {
    await ctx.reply(
      "Voice transcription is not set up yet. " +
        "Run the setup again and choose a voice provider (Groq or local Whisper)."
    );
    return;
  }

  const chatId = ctx.chat.id.toString();
  const channel = getChannel(ctx);

  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const response = await fetch(url);
    const buffer = Buffer.from(await response.arrayBuffer());

    const transcription = await transcribe(buffer);
    if (!transcription) {
      await ctx.reply("Could not transcribe voice message.");
      return;
    }

    await saveMessage("user", `[Voice ${voice.duration}s]: ${transcription}`, chatId, { channel });

    const [recentMessages, relevantContext, memoryContext] = await Promise.all([
      getRecentMessages(supabase, 20, chatId),
      getRelevantContext(supabase, transcription),
      getMemoryContext(supabase),
    ]);

    const session = getSession(chatId);
    const enrichedPrompt = buildPrompt(
      `[Voice message transcribed]: ${transcription}`,
      relevantContext,
      memoryContext,
      recentMessages,
      channel
    );
    const rawResponse = await callClaude(enrichedPrompt, { resume: true, session });
    const claudeResponse = await processMemoryIntents(supabase, rawResponse);

    await saveMessage("assistant", claudeResponse, chatId);
    await sendResponse(ctx, claudeResponse);
  } catch (error) {
    console.error("Voice error:", error);
    await ctx.reply("Could not process voice message. Check logs for details.");
  }
});

// Photos/Images
bot.on("message:photo", async (ctx) => {
  if (!shouldRespondInGroup(ctx)) return;

  const chatId = ctx.chat.id.toString();
  const channel = getChannel(ctx);
  console.log(`Image received [${channel}:${chatId}]`);
  await ctx.replyWithChatAction("typing");

  try {
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const file = await ctx.api.getFile(photo.file_id);

    const timestamp = Date.now();
    const filePath = join(UPLOADS_DIR, `image_${timestamp}.jpg`);

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    const caption = ctx.message.caption || "Analyze this image.";
    const userMessage = `[Image: ${filePath}]\n\n${caption}`;

    await saveMessage("user", `[Image]: ${caption}`, chatId, { channel });

    const [recentMessages, relevantContext, memoryContext] = await Promise.all([
      getRecentMessages(supabase, 20, chatId),
      getRelevantContext(supabase, caption),
      getMemoryContext(supabase),
    ]);

    const session = getSession(chatId);
    const enrichedPrompt = buildPrompt(userMessage, relevantContext, memoryContext, recentMessages, channel);
    const claudeResponse = await callClaude(enrichedPrompt, { resume: true, session });

    await unlink(filePath).catch(() => {});

    const cleanResponse = await processMemoryIntents(supabase, claudeResponse);
    await saveMessage("assistant", cleanResponse, chatId);
    await sendResponse(ctx, cleanResponse);
  } catch (error) {
    console.error("Image error:", error);
    await ctx.reply("Could not process image.");
  }
});

// Documents
bot.on("message:document", async (ctx) => {
  if (!shouldRespondInGroup(ctx)) return;

  const doc = ctx.message.document;
  const chatId = ctx.chat.id.toString();
  const channel = getChannel(ctx);
  console.log(`Document [${channel}:${chatId}]: ${doc.file_name}`);
  await ctx.replyWithChatAction("typing");

  try {
    const file = await ctx.getFile();
    const timestamp = Date.now();
    const fileName = doc.file_name || `file_${timestamp}`;
    const filePath = join(UPLOADS_DIR, `${timestamp}_${fileName}`);

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    const caption = ctx.message.caption || `Analyze: ${doc.file_name}`;
    const userMessage = `[File: ${filePath}]\n\n${caption}`;

    await saveMessage("user", `[Document: ${doc.file_name}]: ${caption}`, chatId, { channel });

    const [recentMessages, relevantContext, memoryContext] = await Promise.all([
      getRecentMessages(supabase, 20, chatId),
      getRelevantContext(supabase, caption),
      getMemoryContext(supabase),
    ]);

    const session = getSession(chatId);
    const enrichedPrompt = buildPrompt(userMessage, relevantContext, memoryContext, recentMessages, channel);
    const claudeResponse = await callClaude(enrichedPrompt, { resume: true, session });

    await unlink(filePath).catch(() => {});

    const cleanResponse = await processMemoryIntents(supabase, claudeResponse);
    await saveMessage("assistant", cleanResponse, chatId);
    await sendResponse(ctx, cleanResponse);
  } catch (error) {
    console.error("Document error:", error);
    await ctx.reply("Could not process document.");
  }
});

// ============================================================
// HELPERS
// ============================================================

// Load profile and soul once at startup
let profileContext = "";
try {
  profileContext = await readFile(join(PROJECT_ROOT, "config", "profile.md"), "utf-8");
} catch {
  // No profile yet — that's fine
}

let soulContext = "";
try {
  soulContext = await readFile(join(PROJECT_ROOT, "config", "SOUL.md"), "utf-8");
} catch {
  // No soul file — that's fine
}

let channelHints: Record<string, string> = {};
try {
  channelHints = JSON.parse(await readFile(join(PROJECT_ROOT, "config", "channels.json"), "utf-8"));
} catch {
  // No channel hints — channel name still gets injected, just no description
}

const USER_NAME = process.env.USER_NAME || "";
const USER_TIMEZONE = process.env.USER_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

function buildPrompt(
  userMessage: string,
  relevantContext?: string,
  memoryContext?: string,
  recentMessages?: string,
  channel?: string
): string {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: USER_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts: string[] = [];

  // Soul comes first — it defines who you are
  if (soulContext) parts.push(soulContext);

  parts.push(
    "You have persistent memory — the conversation history and facts below are from your database. Use them naturally. Never say you don't have context or that each session starts fresh.",
    "You also have MemPalace MCP tools available for deep memory search. Use mempalace_search to find relevant past conversations and context when the user references something you should know about.",
  );

  if (USER_NAME) parts.push(`You are speaking with ${USER_NAME}.`);
  parts.push(`Current time: ${timeStr}`);

  // Channel context for group chats — loaded from config/channels.json if
  // present, otherwise a minimal default. See config/channels.example.json.
  if (channel && channel !== "direct") {
    parts.push(`\nChannel: ${channel}`);
    const hint = channelHints[channel];
    if (hint) parts.push(hint);
  }

  if (profileContext) parts.push(`\nProfile:\n${profileContext}`);
  if (memoryContext) parts.push(`\n${memoryContext}`);
  if (recentMessages) parts.push(`\n${recentMessages}`);
  if (relevantContext) parts.push(`\n${relevantContext}`);

  parts.push(
    "\nMEMORY MANAGEMENT:" +
      "\nWhen the user shares something worth remembering, sets goals, or completes goals, " +
      "include these tags in your response (they are processed automatically and hidden from the user):" +
      "\n[REMEMBER: fact to store]" +
      "\n[GOAL: goal text | DEADLINE: optional date]" +
      "\n[DONE: search text for completed goal]"
  );

  parts.push(`\nUser: ${userMessage}`);

  return parts.join("\n");
}

async function sendResponse(ctx: Context, response: string): Promise<void> {
  // Telegram has a 4096 character limit
  const MAX_LENGTH = 4000;

  if (response.length <= MAX_LENGTH) {
    await ctx.reply(response);
    return;
  }

  // Split long responses
  const chunks = [];
  let remaining = response;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Try to split at a natural boundary
    let splitIndex = remaining.lastIndexOf("\n\n", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf(" ", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = MAX_LENGTH;

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trim();
  }

  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }
}

// ============================================================
// START
// ============================================================

console.log("Starting Claude Telegram Relay...");
console.log(`Authorized user: ${ALLOWED_USER_ID || "ANY (not recommended)"}`);
console.log(`Project directory: ${PROJECT_DIR || "(relay working directory)"}`);

bot.start({
  onStart: () => {
    console.log("Bot is running!");
  },
});
