import { createPublicKey, verify } from "node:crypto";
import { isDiscordConfigured, readEnv } from "./config";
import {
  DISCORD_API,
  discordChannelMessagesUrl,
  discordDmOpenUrl,
  discordOriginalFollowupUrl,
} from "./parse";
import { clipOutboundText } from "./safety";

export {
  DISCORD_API,
  DISCORD_APPLICATION_COMMAND,
  DISCORD_CHANNEL_MESSAGE,
  DISCORD_DEFERRED_CHANNEL_MESSAGE,
  DISCORD_PING,
  DISCORD_PONG,
  discordChannelMessagesUrl,
  discordDmOpenUrl,
  discordFollowupUrl,
  discordOriginalFollowupUrl,
  parseDiscordInteraction,
} from "./parse";

export function discordUserId(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("DISCORD_USER_ID", env);
}

export function discordPublicKey(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("DISCORD_PUBLIC_KEY", env);
}

export function isIanDiscordUser(userId: string, env: NodeJS.ProcessEnv = process.env) {
  const expected = discordUserId(env);
  return Boolean(expected && userId && expected === userId);
}

export function verifyDiscordSignature(input: {
  publicKey: string;
  signature: string;
  timestamp: string;
  body: string;
}) {
  const { publicKey, signature, timestamp, body } = input;
  if (!publicKey || !signature || !timestamp) return false;
  if (!/^[0-9a-f]+$/i.test(publicKey) || !/^[0-9a-f]+$/i.test(signature)) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(publicKey, "hex"),
      ]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(`${timestamp}${body}`), key, Buffer.from(signature, "hex"));
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function discordJson(
  url: string,
  token: string,
  init?: { method?: string; body?: unknown },
) {
  const response = await fetch(url, {
    method: init?.method ?? "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  let data: unknown = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }
  return { response, data };
}

export async function sendDiscordDm(text: string, env: NodeJS.ProcessEnv = process.env) {
  const token = readEnv("DISCORD_BOT_TOKEN", env);
  const userId = discordUserId(env);
  if (!token || !userId) {
    return { ok: false as const, status: 503, error: "Discord is not configured." };
  }
  const content = clipOutboundText(text, 1900);
  if (!content) return { ok: false as const, status: 400, error: "Message is empty." };

  const opened = await discordJson(discordDmOpenUrl(), token, { body: { recipient_id: userId } });
  const channel = asRecord(opened.data);
  const channelId = typeof channel?.id === "string" ? channel.id : "";
  if (!opened.response.ok || !channelId) {
    const message =
      typeof asRecord(opened.data)?.message === "string"
        ? (asRecord(opened.data)?.message as string)
        : "Could not open a Discord DM.";
    const status = opened.response.status === 401 ? 401 : opened.response.status >= 400 ? 400 : 502;
    return { ok: false as const, status, error: message };
  }

  const sent = await discordJson(discordChannelMessagesUrl(channelId), token, { body: { content } });
  if (!sent.response.ok) {
    const message =
      typeof asRecord(sent.data)?.message === "string"
        ? (asRecord(sent.data)?.message as string)
        : "Could not send a Discord DM.";
    return { ok: false as const, status: sent.response.status >= 400 ? 400 : 502, error: message };
  }
  return { ok: true as const, status: 200, channelId, platform: "discord" as const };
}

export async function followupDiscordInteraction(input: {
  applicationId: string;
  token: string;
  text: string;
}) {
  const content = clipOutboundText(input.text, 1900);
  const response = await fetch(discordOriginalFollowupUrl(input.applicationId, input.token), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  return response.ok;
}

export function discordConfiguredHint() {
  return isDiscordConfigured()
    ? "Discord DMs are configured. Inbound slash commands need DISCORD_PUBLIC_KEY."
    : "Discord is not configured.";
}
