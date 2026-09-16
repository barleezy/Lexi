import { scoreSalience } from "../memory/decay";
import { extractFactsMemo } from "../memory/extract";
import {
  createOrResumeSession,
  formatDecayState,
  formatMemoryInstructions,
  latestOpenSession,
  listRecentTurns,
  recallForUser,
  recordExchange,
} from "../memory/store";
import { formatPriorChat } from "../memory/turns";
import { normalizeUserId } from "../memory/user";
import {
  DEFAULT_FORTNITE_STATE,
  DEFAULT_TOYS_STATE,
  buildInstructions,
} from "../voice/persona";
import {
  CHAT_COMPLETIONS_URL,
  buildChannelMessages,
  chatModelFromEnv,
  readChatError,
  readChatText,
} from "./chat";
import type { ChannelId } from "./config";
import { channelStatus } from "./config";
import { refuseUnder21Message } from "./safety";

export {
  CHAT_COMPLETIONS_URL,
  DEFAULT_CHAT_MODEL,
  buildChannelMessages,
  chatModelFromEnv,
  readChatError,
  readChatText,
} from "./chat";

export async function replyOnChannel(input: {
  platform: ChannelId | "inbound";
  text: string;
  userId?: string;
}) {
  const userText = input.text.trim();
  const safety = refuseUnder21Message(userText);
  if (!safety.ok) {
    return { ok: true as const, reply: safety.error, refused: true, persisted: false };
  }

  const userId = normalizeUserId(input.userId);
  if (!userId) {
    return { ok: false as const, status: 401, error: "Sign in first.", reply: "" };
  }
  const [recalled, prior, session] = await Promise.all([
    recallForUser(userId).catch(() => []),
    listRecentTurns(userId).catch(() => []),
    latestOpenSession(userId)
      .then((open) => createOrResumeSession(userId, open?.id))
      .catch(() => createOrResumeSession(userId).catch(() => null)),
  ]);
  const instructions = buildInstructions(
    formatMemoryInstructions(recalled),
    formatPriorChat(prior),
    session?.id ?? "",
    DEFAULT_TOYS_STATE,
    DEFAULT_FORTNITE_STATE,
    channelStatus(),
    "",
    null,
    undefined,
    userId,
  );
  const decay = formatDecayState(recalled);
  const withDecay =
    decay && decay !== "no active decay tags" ? `${instructions}\n\nCURRENT DECAY STATE: ${decay}` : instructions;

  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    return { ok: false as const, status: 503, error: "XAI_API_KEY is not configured.", reply: "" };
  }

  const model = chatModelFromEnv();
  const upstream = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: buildChannelMessages({
        platform: input.platform,
        userText,
        instructions: withDecay,
        prior,
      }),
      max_tokens: 800,
      temperature: 0.8,
    }),
  });
  let data: unknown = {};
  try {
    data = await upstream.json();
  } catch {
    data = {};
  }
  if (!upstream.ok) {
    return {
      ok: false as const,
      status: upstream.status === 401 ? 401 : 502,
      error: readChatError(data),
      reply: "",
    };
  }
  const reply = readChatText(data);
  if (!reply) {
    return { ok: false as const, status: 502, error: "Empty model reply.", reply: "" };
  }

  const extracted = extractFactsMemo(userText, reply);
  const recorded = await recordExchange({
    userId,
    userText,
    assistantText: reply,
    facts: extracted,
    affect: scoreSalience(userText, reply),
    sessionId: session?.id ?? null,
  }).catch(() => null);

  return {
    ok: true as const,
    reply,
    refused: false,
    persisted: Boolean(recorded?.turn),
    sessionId: recorded?.turn?.session_id ?? session?.id ?? null,
    model,
  };
}
