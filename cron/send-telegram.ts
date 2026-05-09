/**
 * Utility: Send a message to a Telegram chat via the bot.
 * Used by cron jobs to deliver results.
 *
 * Usage: bun run cron/send-telegram.ts <chatId> <message>
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const chatId = process.argv[2];
const message = process.argv[3];

if (!BOT_TOKEN || !chatId || !message) {
  console.error("Usage: send-telegram.ts <chatId> <message>");
  process.exit(1);
}

const MAX_LENGTH = 4000;

async function send(text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!res.ok) {
    // Retry without markdown if it fails
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  }
}

// Split long messages
if (message.length <= MAX_LENGTH) {
  await send(message);
} else {
  let remaining = message;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      await send(remaining);
      break;
    }
    let splitIndex = remaining.lastIndexOf("\n\n", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitIndex === -1) splitIndex = MAX_LENGTH;
    await send(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trim();
  }
}
