export const DISCORD_API = "https://discord.com/api/v10";
export const TELEGRAM_API = "https://api.telegram.org";
export const TWILIO_API = "https://api.twilio.com/2010-04-01";
export const RESEND_API = "https://api.resend.com/emails";
export const CHAT_COMPLETIONS_URL = "https://api.x.ai/v1/chat/completions";
export const DEFAULT_CHAT_MODEL = "grok-4-1-fast-reasoning";

export const DISCORD_PING = 1;
export const DISCORD_APPLICATION_COMMAND = 2;
export const DISCORD_PONG = 1;
export const DISCORD_CHANNEL_MESSAGE = 4;
export const DISCORD_DEFERRED_CHANNEL_MESSAGE = 5;

export function discordDmOpenUrl() {
  return `${DISCORD_API}/users/@me/channels`;
}

export function discordChannelMessagesUrl(channelId: string) {
  return `${DISCORD_API}/channels/${encodeURIComponent(channelId)}/messages`;
}

export function discordFollowupUrl(applicationId: string, token: string) {
  return `${DISCORD_API}/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(token)}`;
}

export function discordOriginalFollowupUrl(applicationId: string, token: string) {
  return `${discordFollowupUrl(applicationId, token)}/messages/@original`;
}

export function telegramApiUrl(method: string, token: string) {
  return `${TELEGRAM_API}/bot${token}/${method}`;
}

export function twilioMessagesUrl(accountSid: string) {
  return `${TWILIO_API}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
}

export function chatModelFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const override = env.XAI_CHAT_MODEL?.trim();
  // Never allow a voice/realtime model on text chat paths.
  if (override && /grok-voice|realtime/i.test(override)) return DEFAULT_CHAT_MODEL;
  return override || DEFAULT_CHAT_MODEL;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringOption(options: unknown): string {
  if (!Array.isArray(options)) return "";
  for (const item of options) {
    const row = asRecord(item);
    if (!row) continue;
    if (typeof row.value === "string" && row.value.trim()) return row.value.trim();
    const nested = readStringOption(row.options);
    if (nested) return nested;
  }
  return "";
}

export function parseDiscordInteraction(raw: unknown) {
  const body = asRecord(raw);
  if (!body) return null;
  const type = Number(body.type);
  const token = typeof body.token === "string" ? body.token : "";
  const applicationId =
    typeof body.application_id === "string"
      ? body.application_id
      : typeof body.applicationId === "string"
        ? body.applicationId
        : "";
  const user = asRecord(body.user) ?? asRecord(asRecord(body.member)?.user);
  const userId = typeof user?.id === "string" ? user.id : "";
  const data = asRecord(body.data);
  const text = data ? readStringOption(data.options) : "";
  return {
    type,
    token,
    applicationId,
    userId,
    text,
    command: typeof data?.name === "string" ? data.name : "",
  };
}

export function parseTelegramUpdate(raw: unknown) {
  const body = asRecord(raw);
  if (!body) return null;
  const message = asRecord(body.message) ?? asRecord(body.edited_message);
  if (!message) return { ignore: true as const, text: "", chatId: "", fromId: "", isBot: false };
  const chat = asRecord(message.chat);
  const from = asRecord(message.from);
  const text =
    typeof message.text === "string"
      ? message.text
      : typeof message.caption === "string"
        ? message.caption
        : "";
  return {
    ignore: false as const,
    text: text.trim(),
    chatId: chat && (typeof chat.id === "number" || typeof chat.id === "string") ? String(chat.id) : "",
    fromId: from && (typeof from.id === "number" || typeof from.id === "string") ? String(from.id) : "",
    isBot: from?.is_bot === true,
  };
}

export function parseTwilioInbound(params: URLSearchParams | Record<string, string>) {
  const get = (key: string) =>
    params instanceof URLSearchParams ? params.get(key)?.trim() ?? "" : params[key]?.trim() ?? "";
  return {
    from: get("From"),
    to: get("To"),
    text: get("Body"),
    sid: get("MessageSid") || get("SmsSid"),
  };
}

export function twilioSignatureBase(url: string, params: Record<string, string>) {
  const keys = Object.keys(params).sort();
  let base = url;
  for (const key of keys) base += key + params[key];
  return base;
}

export function normalizePhone(raw: string) {
  return raw.trim().replace(/[^\d+]/g, "");
}

export function samePhone(left: string, right: string) {
  const a = normalizePhone(left).replace(/^\+/, "");
  const b = normalizePhone(right).replace(/^\+/, "");
  return Boolean(a && b && (a === b || a.endsWith(b) || b.endsWith(a)));
}

export function sameEmail(left: string, right: string) {
  const unwrap = (value: string) => {
    const match = value.match(/<([^>]+)>/);
    return (match?.[1] ?? value).trim().toLowerCase();
  };
  const a = unwrap(left);
  const b = unwrap(right);
  return Boolean(a && b && a === b);
}

export function parseEmailInbound(raw: unknown) {
  const body = asRecord(raw);
  if (!body) return { from: "", text: "", subject: "" };
  const data = asRecord(body.data) ?? body;
  const from =
    typeof data.from === "string"
      ? data.from
      : typeof asRecord(data.from)?.email === "string"
        ? (asRecord(data.from)?.email as string)
        : typeof body.from === "string"
          ? body.from
          : "";
  const text =
    typeof data.text === "string"
      ? data.text
      : typeof data.html === "string"
        ? data.html.replace(/<[^>]+>/g, " ")
        : typeof body.text === "string"
          ? body.text
          : "";
  const subject = typeof data.subject === "string" ? data.subject : typeof body.subject === "string" ? body.subject : "";
  const combined = [subject && subject !== text ? `Subject: ${subject}` : "", text].filter(Boolean).join("\n");
  return { from: from.trim(), text: combined.trim(), subject: subject.trim() };
}

export function twimlMessage(text: string) {
  const escaped = text
    .trim()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escaped}</Message></Response>`;
}

export function twimlEmpty() {
  return `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
}

export function readChatText(data: unknown) {
  const record = asRecord(data);
  const choices = record?.choices;
  if (Array.isArray(choices)) {
    const message = asRecord(asRecord(choices[0])?.message);
    if (typeof message?.content === "string" && message.content.trim()) {
      return message.content.trim();
    }
  }
  if (typeof record?.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }
  return "";
}

export function readChatError(data: unknown, fallback = "Could not write a reply.") {
  const record = asRecord(data);
  const error = asRecord(record?.error);
  if (typeof error?.message === "string" && error.message.trim()) return error.message.trim();
  if (typeof record?.error === "string" && record.error.trim()) return record.error.trim();
  return fallback;
}
