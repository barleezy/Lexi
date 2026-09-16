import {
  createOrResumeSession,
  endSession,
  formatDecayState,
  formatMemoryInstructions,
  listRecentTurns,
  recallForUser,
} from "@/lib/memory/store";
import { formatSessionIdLine, parseSessionId } from "@/lib/memory/session-id";
import { formatPriorChat } from "@/lib/memory/turns";
import { requireAuthSessionUserId } from "@/lib/auth/session";
import { appendVoiceLog, isValidSessionId, isVoiceLogEnabled } from "@/lib/voice/server-log";
import {
  OUT_OF_MINUTES_CODE,
  OUT_OF_MINUTES_MESSAGE,
  extendVoiceHold,
  placeVoiceHold,
  readOpenVoiceSession,
  REALTIME_VOICE_MODEL,
  releaseVoiceHold,
  shrinkVoiceHold,
  sweepStaleVoiceSessions,
} from "@/lib/wallet/voice";

const UPSTREAM = "https://api.x.ai/v1/realtime/client_secrets";

type SecretBody = {
  value?: unknown;
  client_secret?: { value?: unknown } | string;
};

function readToken(data: SecretBody) {
  if (typeof data.value === "string" && data.value) return data.value;
  if (typeof data.client_secret === "string" && data.client_secret) {
    return data.client_secret;
  }
  if (
    data.client_secret &&
    typeof data.client_secret === "object" &&
    typeof data.client_secret.value === "string"
  ) {
    return data.client_secret.value;
  }
  return null;
}

async function mintEphemeralToken(key: string, ttlSeconds: number) {
  const ttl = Math.max(30, Math.min(3600, Math.floor(ttlSeconds)));
  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expires_after: { seconds: ttl } }),
  });
  let data: SecretBody = {};
  try {
    data = (await upstream.json()) as SecretBody;
  } catch {
    data = {};
  }
  return { upstream, data, token: readToken(data), ttl };
}

export async function POST(request: Request) {
  const started = Date.now();
  let sessionId = "";
  let logSessionId = "";
  let claimedUserId: string | null = null;
  let previousSessionId: string | null = null;
  let rehearsal = false;
  let resumeVoiceSessionId = "";
  let extendHold = false;
  try {
    const body = (await request.json()) as {
      sessionId?: unknown;
      logSessionId?: unknown;
      memorySessionId?: unknown;
      userId?: unknown;
      previousSessionId?: unknown;
      rehearsal?: unknown;
      voiceSessionId?: unknown;
      resume?: unknown;
      extend?: unknown;
    };
    if (typeof body.sessionId === "string") sessionId = body.sessionId;
    if (typeof body.logSessionId === "string") logSessionId = body.logSessionId;
    else if (typeof body.sessionId === "string") logSessionId = body.sessionId;
    if (typeof body.userId === "string") claimedUserId = body.userId;
    // Fresh Call: client must send null after hangup. Non-null only ends a prior memory row.
    if (typeof body.previousSessionId === "string") previousSessionId = body.previousSessionId;
    else previousSessionId = null;
    rehearsal = body.rehearsal === true;
    extendHold = body.extend === true;
    if (typeof body.voiceSessionId === "string") resumeVoiceSessionId = body.voiceSessionId.trim();
    const requestedMemory =
      parseSessionId(typeof body.memorySessionId === "string" ? body.memorySessionId : null) ??
      parseSessionId(sessionId);
    if (requestedMemory) sessionId = requestedMemory;
  } catch {
    sessionId = "";
    logSessionId = "";
    previousSessionId = null;
  }

  // Auth: signed web cookie or iOS bearer. x-lexi-user-id alone is not enough.
  const userId = requireAuthSessionUserId(request, claimedUserId);
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  if (rehearsal) {
    // Rehearsal must not mint a realtime token and must not call xAI / debit.
    return Response.json({
      rehearsal: true,
      token: null,
      model: REALTIME_VOICE_MODEL,
      userId,
      priorChat: "",
      priorTurns: [],
      sessionId: null,
      voiceSessionId: null,
    });
  }

  const key = process.env.XAI_API_KEY;
  if (!key) {
    if (isVoiceLogEnabled() && isValidSessionId(logSessionId)) {
      await appendVoiceLog(logSessionId, [
        {
          src: "server",
          ts: Date.now(),
          kind: "server.token",
          ok: false,
          status: 500,
          ms: Date.now() - started,
          upstream: "missing XAI_API_KEY",
        },
      ]);
    }
    return Response.json({ error: "Voice is not configured." }, { status: 500 });
  }

  await sweepStaleVoiceSessions(userId);

  let hold: Awaited<ReturnType<typeof placeVoiceHold>> | null = null;
  let extended: Awaited<ReturnType<typeof extendVoiceHold>> | null = null;
  let mintTtl = 90;
  let voiceSessionId = "";
  let holdSeconds = 90;
  let voiceSeconds = 0;
  let capAtMs = Date.now() + 90_000;

  if (extendHold && resumeVoiceSessionId) {
    extended = await extendVoiceHold(userId, resumeVoiceSessionId);
    if (!extended.ok) {
      const status = extended.code === OUT_OF_MINUTES_CODE ? 402 : extended.code === "busy" ? 409 : 401;
      return Response.json(
        {
          error: extended.code === OUT_OF_MINUTES_CODE ? OUT_OF_MINUTES_MESSAGE : extended.error,
          code: extended.code,
        },
        { status },
      );
    }
    mintTtl = extended.mintTtlSeconds;
    voiceSessionId = extended.voiceSessionId;
    holdSeconds = extended.holdSeconds;
    voiceSeconds = extended.voiceSeconds;
    capAtMs = extended.capAtMs;
  } else if (resumeVoiceSessionId) {
    const open = await readOpenVoiceSession(userId, resumeVoiceSessionId);
    if (!open) {
      return Response.json({ error: "Voice session expired. Start a new Call." }, { status: 409 });
    }
    mintTtl = open.remainingSeconds;
    voiceSessionId = open.voiceSessionId;
    holdSeconds = open.holdSeconds;
    voiceSeconds = open.voiceSeconds;
    capAtMs = open.capAtMs;
  } else {
    hold = await placeVoiceHold(userId);
    if (!hold.ok) {
      const status = hold.code === OUT_OF_MINUTES_CODE ? 402 : hold.code === "busy" ? 409 : 401;
      return Response.json(
        {
          error: hold.code === OUT_OF_MINUTES_CODE ? OUT_OF_MINUTES_MESSAGE : hold.error,
          code: hold.code,
        },
        { status },
      );
    }
    mintTtl = hold.mintTtlSeconds;
    voiceSessionId = hold.voiceSessionId;
    holdSeconds = hold.holdSeconds;
    voiceSeconds = hold.voiceSeconds;
    capAtMs = hold.capAtMs;
  }

  const minted = await mintEphemeralToken(key, mintTtl);
  const ms = Date.now() - started;

  if (isVoiceLogEnabled() && isValidSessionId(logSessionId)) {
    await appendVoiceLog(logSessionId, [
      {
        src: "server",
        ts: Date.now(),
        kind: "server.token",
        ok: minted.upstream.ok && Boolean(minted.token),
        status: minted.upstream.status,
        ms,
        upstream: minted.upstream.ok ? "client_secrets" : `http ${minted.upstream.status}`,
        hold_seconds: holdSeconds,
        voice_session: voiceSessionId,
      },
    ]);
  }

  if (!minted.upstream.ok || !minted.token) {
    if (extended?.ok) await shrinkVoiceHold(userId, extended.voiceSessionId, extended.addedSeconds ?? 0);
    else if (hold?.ok) await releaseVoiceHold(userId, hold.voiceSessionId);
    const raw =
      minted.data &&
      typeof minted.data === "object" &&
      "error" in minted.data &&
      typeof (minted.data as { error?: unknown }).error === "string"
        ? (minted.data as { error: string }).error
        : "";
    const error = /credit|spending limit|permission-denied|does not have permission/i.test(raw)
      ? "xAI is out of credits or at its monthly spend limit. Add credits at console.x.ai, then start voice again."
      : "Could not start a voice session.";
    return Response.json({ error }, { status: 502 });
  }

  // Empty prior on fresh Call (previousSessionId null). Keep short memory facts only.
  const includePrior = Boolean(parseSessionId(previousSessionId));
  let decayState = "no active decay tags";
  let memoryInstructions = "";
  let priorChat = "";
  let priorTurns: Awaited<ReturnType<typeof listRecentTurns>> = [];
  let memorySessionId: string | null = null;
  const [recalled, turns, session] = await Promise.all([
    recallForUser(userId).catch(() => []),
    includePrior ? listRecentTurns(userId).catch(() => []) : Promise.resolve([]),
    (async () => {
      if (previousSessionId && previousSessionId !== sessionId) {
        await endSession(userId, previousSessionId);
      }
      return createOrResumeSession(userId, sessionId || null);
    })().catch(() => null),
  ]);
  decayState = formatDecayState(recalled);
  memoryInstructions = formatMemoryInstructions(recalled);
  priorTurns = includePrior ? turns : [];
  priorChat = includePrior ? formatPriorChat(priorTurns) : "";
  memorySessionId = session?.id ?? parseSessionId(sessionId);

  const sessionLine = formatSessionIdLine(memorySessionId);
  if (sessionLine && !memoryInstructions.includes(sessionLine)) {
    memoryInstructions = memoryInstructions
      ? `${memoryInstructions}\n\n${sessionLine}`
      : sessionLine;
  }

  return Response.json({
    token: minted.token,
    model: REALTIME_VOICE_MODEL,
    decayState,
    memoryInstructions,
    priorChat,
    priorTurns,
    sessionId: memorySessionId,
    voiceSessionId,
    holdSeconds,
    voiceSeconds,
    capAtMs,
    mintTtlSeconds: minted.ttl,
  });
}
