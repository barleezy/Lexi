import { readEnv, timingSafeEqualString } from "./config";
import { telegramApiUrl } from "./parse";
import { clipOutboundText } from "./safety";

export { TELEGRAM_API, parseTelegramUpdate, telegramApiUrl } from "./parse";

export function telegramChatId(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("TELEGRAM_CHAT_ID", env);
}

export function telegramWebhookSecret(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("TELEGRAM_WEBHOOK_SECRET", env);
}

export function isIanTelegramChat(chatId: string, env: NodeJS.ProcessEnv = process.env) {
  const expected = telegramChatId(env);
  return Boolean(expected && chatId && expected === chatId);
}

export function verifyTelegramSecret(header: string, env: NodeJS.ProcessEnv = process.env) {
  const expected = telegramWebhookSecret(env);
  if (!expected) return false;
  return timingSafeEqualString(header.trim(), expected);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function sendTelegramMessage(text: string, env: NodeJS.ProcessEnv = process.env) {
  const token = readEnv("TELEGRAM_BOT_TOKEN", env);
  const chatId = telegramChatId(env);
  if (!token || !chatId) {
    return { ok: false as const, status: 503, error: "Telegram is not configured." };
  }
  const content = clipOutboundText(text, 3900);
  if (!content) return { ok: false as const, status: 400, error: "Message is empty." };

  const response = await fetch(telegramApiUrl("sendMessage", token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: content }),
  });
  let data: unknown = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  const record = asRecord(data);
  if (!response.ok || record?.ok === false) {
    const description = typeof record?.description === "string" ? record.description : "Telegram send failed.";
    return { ok: false as const, status: response.status >= 400 ? response.status : 502, error: description };
  }
  return { ok: true as const, status: 200, platform: "telegram" as const, chatId };
}
