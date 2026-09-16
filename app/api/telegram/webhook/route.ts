import { isTelegramConfigured } from "@/lib/channels/config";
import { handleInboundText } from "@/lib/channels/inbound";
import { IAN_USER_ID } from "@/lib/memory/user";
import {
  isIanTelegramChat,
  parseTelegramUpdate,
  telegramWebhookSecret,
  verifyTelegramSecret,
} from "@/lib/channels/telegram";

export const maxDuration = 60;

export async function GET() {
  if (!isTelegramConfigured()) {
    return Response.json(
      {
        error: "Telegram is not configured.",
        configured: false,
        hint: "Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and TELEGRAM_WEBHOOK_SECRET.",
      },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, configured: true, inbound: true });
}

export async function POST(request: Request) {
  if (!isTelegramConfigured()) {
    return Response.json(
      { error: "Telegram is not configured.", configured: false },
      { status: 503 },
    );
  }
  if (telegramWebhookSecret()) {
    const header = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
    const query = new URL(request.url).searchParams.get("secret") ?? "";
    if (!verifyTelegramSecret(header) && !verifyTelegramSecret(query)) {
      return Response.json({ error: "Unauthorized Telegram webhook." }, { status: 401 });
    }
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update = parseTelegramUpdate(body);
  if (!update || update.ignore || update.isBot || !update.text) {
    return Response.json({ ok: true, ignored: true });
  }
  if (!isIanTelegramChat(update.chatId)) {
    return Response.json({ ok: true, ignored: true });
  }

  const result = await handleInboundText({
    platform: "telegram",
    text: update.text,
    userId: IAN_USER_ID,
    sendReply: true,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true });
}
