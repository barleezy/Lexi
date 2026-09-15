export const CHANNELS = ["discord", "telegram", "sms", "email"] as const;
export type ChannelId = (typeof CHANNELS)[number];

export const CHANNEL_SETUP = {
  discord:
    "Set DISCORD_BOT_TOKEN and DISCORD_USER_ID. For inbound slash commands also set DISCORD_PUBLIC_KEY and point Discord's Interactions URL at /api/discord/interactions. No gateway on Vercel — plain DMs inbound need a host that can keep a socket.",
  telegram:
    "Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and TELEGRAM_WEBHOOK_SECRET. Then POST setWebhook to https://api.telegram.org/bot<token>/setWebhook with url=/api/telegram/webhook and secret_token.",
  sms: "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, and TWILIO_TO. Point the Twilio number's inbound webhook at /api/sms/webhook.",
  email:
    "Set EMAIL_FROM, EMAIL_TO, and RESEND_API_KEY (preferred) or SMTP_HOST + SMTP_USER + SMTP_PASS. Inbound: Resend webhook → /api/email/inbound, or POST /api/channels/inbound.",
} as const;

export function readEnv(name: string, env: NodeJS.ProcessEnv = process.env) {
  return env[name]?.trim() ?? "";
}

export function parseChannelPlatform(raw: unknown): ChannelId | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value === "text" || value === "imessage") return null;
  if (value === "discord" || value === "telegram" || value === "sms" || value === "email") {
    return value;
  }
  if (value === "twilio" || value === "phone" || value === "text_message") return "sms";
  if (value === "mail" || value === "gmail") return "email";
  return null;
}

export function parseChannelText(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim();
}

export function parseInboundPayload(body: {
  platform?: unknown;
  channel?: unknown;
  text?: unknown;
  message?: unknown;
  userId?: unknown;
  replyOnChannel?: unknown;
}) {
  const platform = parseChannelPlatform(body.platform ?? body.channel);
  const text = parseChannelText(body.text ?? body.message);
  const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : "Ian";
  const sendReply = body.replyOnChannel !== false && body.replyOnChannel !== "false";
  return { platform, text, userId, sendReply };
}

export function isDiscordConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(readEnv("DISCORD_BOT_TOKEN", env) && readEnv("DISCORD_USER_ID", env));
}

export function isDiscordInboundConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(readEnv("DISCORD_PUBLIC_KEY", env) && isDiscordConfigured(env));
}

export function isTelegramConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(readEnv("TELEGRAM_BOT_TOKEN", env) && readEnv("TELEGRAM_CHAT_ID", env));
}

export function isSmsConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    readEnv("TWILIO_ACCOUNT_SID", env) &&
      readEnv("TWILIO_AUTH_TOKEN", env) &&
      readEnv("TWILIO_FROM", env) &&
      readEnv("TWILIO_TO", env),
  );
}

export function isEmailConfigured(env: NodeJS.ProcessEnv = process.env) {
  const from = readEnv("EMAIL_FROM", env);
  const to = readEnv("EMAIL_TO", env);
  if (!from || !to) return false;
  return Boolean(readEnv("RESEND_API_KEY", env) || smtpHost(env));
}

export function smtpHost(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("SMTP_HOST", env);
}

export function channelStatus(env: NodeJS.ProcessEnv = process.env) {
  return {
    discord: isDiscordConfigured(env),
    telegram: isTelegramConfigured(env),
    sms: isSmsConfigured(env),
    email: isEmailConfigured(env),
  };
}

export function anyChannelConfigured(env: NodeJS.ProcessEnv = process.env) {
  const status = channelStatus(env);
  return status.discord || status.telegram || status.sms || status.email;
}

export function isChannelConfigured(platform: ChannelId, env: NodeJS.ProcessEnv = process.env) {
  return channelStatus(env)[platform];
}

export function configuredChannels(env: NodeJS.ProcessEnv = process.env): ChannelId[] {
  const status = channelStatus(env);
  return CHANNELS.filter((name) => status[name]);
}

export function channelSetupHint(platform?: ChannelId | null) {
  if (platform) return CHANNEL_SETUP[platform];
  return "Set Discord, Telegram, Twilio, or email tokens in .env.local. See .env.example.";
}

export function inboundSecret(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("CHANNELS_INBOUND_SECRET", env) || readEnv("RESEND_WEBHOOK_SECRET", env);
}

export function timingSafeEqualString(left: string, right: string) {
  if (!left || !right || left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i++) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}

export function readInboundSecret(request: Request, body?: { secret?: unknown }) {
  const header =
    request.headers.get("x-lexi-channel-secret")?.trim() ||
    request.headers.get("x-webhook-secret")?.trim() ||
    "";
  if (header) return header;
  const auth = request.headers.get("authorization")?.trim() ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  if (typeof body?.secret === "string") return body.secret.trim();
  const url = new URL(request.url);
  return url.searchParams.get("secret")?.trim() ?? "";
}

export function verifyInboundSecret(request: Request, body?: { secret?: unknown }, env = process.env) {
  const expected = inboundSecret(env);
  if (!expected) return false;
  return timingSafeEqualString(readInboundSecret(request, body), expected);
}
