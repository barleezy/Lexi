import { readFileSync } from "node:fs";
import {
  CHANNELS,
  CHANNEL_SETUP,
  anyChannelConfigured,
  channelSetupHint,
  channelStatus,
  isChannelConfigured,
  isDiscordConfigured,
  isEmailConfigured,
  isSmsConfigured,
  isTelegramConfigured,
  parseChannelPlatform,
  parseChannelText,
  parseInboundPayload,
  timingSafeEqualString,
} from "../lib/channels/config.ts";
import {
  CHAT_COMPLETIONS_URL,
  DEFAULT_CHAT_MODEL,
  DISCORD_API,
  DISCORD_APPLICATION_COMMAND,
  DISCORD_DEFERRED_CHANNEL_MESSAGE,
  DISCORD_PING,
  DISCORD_PONG,
  RESEND_API,
  TELEGRAM_API,
  TWILIO_API,
  chatModelFromEnv,
  discordChannelMessagesUrl,
  discordDmOpenUrl,
  discordFollowupUrl,
  normalizePhone,
  parseDiscordInteraction,
  parseEmailInbound,
  parseTelegramUpdate,
  parseTwilioInbound,
  readChatError,
  readChatText,
  sameEmail,
  samePhone,
  telegramApiUrl,
  twilioMessagesUrl,
  twilioSignatureBase,
  twimlMessage,
} from "../lib/channels/parse.ts";
import { CHANNEL_REFUSAL, clipOutboundText, refuseUnder21Message } from "../lib/channels/safety.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(CHANNELS.join(",") === "discord,telegram,sms,email", "channel list");
expect(parseChannelPlatform("Discord") === "discord", "discord platform");
expect(parseChannelPlatform("twilio") === "sms", "twilio alias");
expect(parseChannelPlatform("gmail") === "email", "gmail alias");
expect(parseChannelPlatform("imessage") === null, "no fake imessage");
expect(parseChannelPlatform("snapchat") === null, "no fake snapchat");
expect(parseChannelText("  hi  ") === "hi", "trim text");
expect(parseChannelText(1) === "", "non-string text");

const empty = {};
expect(!isDiscordConfigured(empty), "discord empty");
expect(!isTelegramConfigured(empty), "telegram empty");
expect(!isSmsConfigured(empty), "sms empty");
expect(!isEmailConfigured(empty), "email empty");
expect(!anyChannelConfigured(empty), "none configured");
expect(!isChannelConfigured("discord", empty), "discord not configured");
expect(channelStatus(empty).telegram === false, "status telegram");
expect(channelSetupHint("discord") === CHANNEL_SETUP.discord, "discord hint");
expect(channelSetupHint().includes(".env.example"), "generic hint");

expect(isDiscordConfigured({ DISCORD_BOT_TOKEN: "t", DISCORD_USER_ID: "1" }), "discord configured");
expect(isTelegramConfigured({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "9" }), "telegram configured");
expect(
  isSmsConfigured({
    TWILIO_ACCOUNT_SID: "AC",
    TWILIO_AUTH_TOKEN: "tok",
    TWILIO_FROM: "+1",
    TWILIO_TO: "+2",
  }),
  "sms configured",
);
expect(
  isEmailConfigured({ RESEND_API_KEY: "re", EMAIL_FROM: "a@b.c", EMAIL_TO: "d@e.f" }),
  "resend configured",
);
expect(
  isEmailConfigured({
    SMTP_HOST: "smtp.test",
    SMTP_USER: "u",
    SMTP_PASS: "p",
    EMAIL_FROM: "a@b.c",
    EMAIL_TO: "d@e.f",
  }),
  "smtp configured",
);

expect(timingSafeEqualString("abc", "abc"), "secret match");
expect(!timingSafeEqualString("abc", "abd"), "secret mismatch");
expect(!timingSafeEqualString("ab", "abc"), "secret length");

expect(refuseUnder21Message("").ok === false, "empty inbound refused");
expect(refuseUnder21Message("hey, what's up").ok === true, "adult hello allowed");
expect(refuseUnder21Message("I'm 17").ok === false, "self under 21 refused");
expect(refuseUnder21Message("teen sex").error === CHANNEL_REFUSAL, "minor + sexual refused");
expect(clipOutboundText("x".repeat(10), 8) === `${"x".repeat(7)}…`, "clip outbound");

expect(DISCORD_API === "https://discord.com/api/v10", "discord api");
expect(DISCORD_PING === 1 && DISCORD_PONG === 1, "discord ping/pong");
expect(DISCORD_APPLICATION_COMMAND === 2, "discord command type");
expect(DISCORD_DEFERRED_CHANNEL_MESSAGE === 5, "discord deferred");
expect(discordDmOpenUrl() === `${DISCORD_API}/users/@me/channels`, "dm open url");
expect(discordChannelMessagesUrl("99") === `${DISCORD_API}/channels/99/messages`, "channel messages url");
expect(discordFollowupUrl("app", "tok") === `${DISCORD_API}/webhooks/app/tok`, "followup url");

const interaction = parseDiscordInteraction({
  type: 2,
  token: "tok",
  application_id: "app",
  user: { id: "1" },
  data: { name: "lexi", options: [{ name: "text", type: 3, value: " hey " }] },
});
expect(interaction?.text === "hey", "discord option text");
expect(interaction?.userId === "1", "discord user");
expect(interaction?.command === "lexi", "discord command");

expect(TELEGRAM_API === "https://api.telegram.org", "telegram api");
expect(telegramApiUrl("sendMessage", "TOKEN") === `${TELEGRAM_API}/botTOKEN/sendMessage`, "telegram send url");
const tg = parseTelegramUpdate({
  message: { chat: { id: 42 }, from: { id: 42, is_bot: false }, text: "yo" },
});
expect(tg && !tg.ignore && tg.chatId === "42" && tg.text === "yo", "telegram parse");
const tgBot = parseTelegramUpdate({
  message: { chat: { id: 1 }, from: { id: 2, is_bot: true }, text: "no" },
});
expect(tgBot?.isBot === true, "ignore telegram bots");

expect(TWILIO_API.startsWith("https://api.twilio.com"), "twilio api");
expect(twilioMessagesUrl("ACxx").includes("/Accounts/ACxx/Messages.json"), "twilio messages url");
expect(normalizePhone("+1 (555) 0100") === "+15550100", "normalize phone");
expect(samePhone("+15550100", "5550100"), "same phone");
const sms = parseTwilioInbound({ From: "+1", To: "+2", Body: "hi", MessageSid: "SM1" });
expect(sms.from === "+1" && sms.text === "hi", "twilio inbound");
expect(twilioSignatureBase("https://x", { B: "2", A: "1" }) === "https://xA1B2", "twilio base");
expect(twimlMessage("hi <you>").includes("hi &lt;you&gt;"), "twiml escape");

expect(RESEND_API === "https://api.resend.com/emails", "resend api");
expect(sameEmail("Ian <a@b.c>", "a@b.c"), "same email");
const mail = parseEmailInbound({ data: { from: "a@b.c", subject: "Hi", text: "body" } });
expect(mail.from === "a@b.c" && mail.text.includes("body"), "email inbound");

const inbound = parseInboundPayload({ platform: "telegram", text: "  ping  ", userId: "Ian" });
expect(inbound.platform === "telegram" && inbound.text === "ping" && inbound.userId === "Ian", "inbound payload");
const inboundAnon = parseInboundPayload({ platform: "telegram", text: "ping" });
expect(inboundAnon.userId === "", "inbound does not invent Ian");

expect(CHAT_COMPLETIONS_URL === "https://api.x.ai/v1/chat/completions", "chat url");
expect(DEFAULT_CHAT_MODEL === "grok-4-1-fast-reasoning", "default chat model");
expect(chatModelFromEnv({}) === DEFAULT_CHAT_MODEL, "chat model default");
expect(chatModelFromEnv({ XAI_CHAT_MODEL: "grok-4" }) === "grok-4", "chat model override");
expect(
  chatModelFromEnv({ XAI_CHAT_MODEL: "grok-voice-latest" }) === DEFAULT_CHAT_MODEL,
  "never put voice model on text chat",
);
expect(readChatText({ choices: [{ message: { content: "  hey " } }] }) === "hey", "chat text");
expect(readChatError({ error: { message: "nope" } }) === "nope", "chat error");

const persona = readFileSync(new URL("../lib/voice/persona.ts", import.meta.url), "utf8");
expect(
  !persona.includes("refrain from interacting with the user on any platform other than this"),
  "persona allows channels",
);
expect(persona.includes("configured channels"), "persona mentions channels");
expect(persona.includes("send_message"), "persona has send_message");
expect(persona.includes("BANTER PRIVACY"), "persona has banter privacy");
expect(persona.includes("playful, fun, funny"), "public banter stays playful");
expect(persona.includes("Innuendo is fine"), "public innuendo allowed");
expect(persona.includes("No graphic sexual descriptions"), "no graphic public sex talk");
expect(persona.includes("Nothing obscene"), "nothing obscene in public");
expect(!/\bnon-sexual\b/.test(persona), "public banter is not fully non-sexual");
expect(persona.includes("FORTNITE"), "fortnite section");
expect(persona.includes("WATCH TOGETHER"), "watch section");
expect(persona.includes("If this channel could be seen or heard"), "channel note has public banter");

console.log("channels checks ok");
