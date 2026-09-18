import { TEXT_FAST_MAX_TOKENS, textFastModelFromEnv } from "../wallet/models";
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
  readChatError,
  readChatText,
} from "../channels/chat";
import { channelStatus } from "../channels/config";
import { refuseUnder21Message } from "../channels/safety";
import { xaiInferenceKey } from "../xai/env";

/** Short prior for in-app text. Voice Call still uses its own transcript window. */
export const TEXT_CHAT_PRIOR_LIMIT = 8;

const TEXT_CHAT_NOTE =
  "This turn is typed in TalkToLexi. Reply in short plain text — no stage directions, no audio tags, no reading SESSION ID or PRIOR CHAT aloud. Same you as voice. Do not call tools. There is no microphone and no audio on this turn.";

export function textChatModel(env: NodeJS.ProcessEnv = process.env) {
  return textFastModelFromEnv(env);
}

export async function replyInAppChat(input: {
  text: string;
  userId?: string | null;
  sessionId?: string | null;
  source?: string | null;
}) {
  const userText = input.text.trim();
  const safety = refuseUnder21Message(userText);
  if (!safety.ok) {
    return { ok: true as const, reply: safety.error, refused: true, persisted: false, sessionId: null, model: textChatModel() };
  }

  const userId = normalizeUserId(input.userId);
  if (!userId) {
    return { ok: false as const, status: 401, error: "Sign in first.", reply: "", sessionId: null, model: "" };
  }

  const requestedSession = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
  const [recalled, prior, session] = await Promise.all([
    recallForUser(userId).catch(() => []),
    listRecentTurns(userId, TEXT_CHAT_PRIOR_LIMIT).catch(() => []),
    (requestedSession
      ? createOrResumeSession(userId, requestedSession)
      : latestOpenSession(userId).then((open) => createOrResumeSession(userId, open?.id))
    ).catch(() => createOrResumeSession(userId).catch(() => null)),
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

  const key = xaiInferenceKey();
  if (!key) {
    return { ok: false as const, status: 503, error: "XAI_API_KEY is not configured.", reply: "", sessionId: session?.id ?? null, model: "" };
  }

  const model = textChatModel();
  const source = input.source?.trim() || "app";
  const upstream = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: buildChannelMessages({
        platform: source,
        userText,
        instructions: `${withDecay}\n\n${TEXT_CHAT_NOTE}`,
        prior,
      }),
      max_tokens: TEXT_FAST_MAX_TOKENS,
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
      sessionId: session?.id ?? null,
      model,
    };
  }
  const reply = readChatText(data);
  if (!reply) {
    return { ok: false as const, status: 502, error: "Empty model reply.", reply: "", sessionId: session?.id ?? null, model };
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
