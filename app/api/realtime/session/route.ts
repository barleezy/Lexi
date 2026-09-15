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
import { resolveUserId } from "@/lib/memory/user";
import { appendVoiceLog, isValidSessionId, isVoiceLogEnabled } from "@/lib/voice/server-log";

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

export async function POST(request: Request) {
  const started = Date.now();
  let sessionId = "";
  let logSessionId = "";
  let requestedUserId: string | null = null;
  let previousSessionId: string | null = null;
  try {
    const body = (await request.json()) as {
      sessionId?: unknown;
      logSessionId?: unknown;
      memorySessionId?: unknown;
      userId?: unknown;
      previousSessionId?: unknown;
    };
    if (typeof body.sessionId === "string") sessionId = body.sessionId;
    if (typeof body.logSessionId === "string") logSessionId = body.logSessionId;
    else if (typeof body.sessionId === "string") logSessionId = body.sessionId;
    if (typeof body.userId === "string") requestedUserId = body.userId;
    if (typeof body.previousSessionId === "string") previousSessionId = body.previousSessionId;
    const requestedMemory =
      parseSessionId(typeof body.memorySessionId === "string" ? body.memorySessionId : null) ??
      parseSessionId(sessionId);
    if (requestedMemory) sessionId = requestedMemory;
  } catch {
    sessionId = "";
    logSessionId = "";
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

  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ expires_after: { seconds: 3600 } }),
  });

  const ms = Date.now() - started;
  let data: SecretBody = {};
  try {
    data = (await upstream.json()) as SecretBody;
  } catch {
    data = {};
  }

  if (isVoiceLogEnabled() && isValidSessionId(logSessionId)) {
    await appendVoiceLog(logSessionId, [
        {
          src: "server",
          ts: Date.now(),
          kind: "server.token",
          ok: upstream.ok,
          status: upstream.status,
          ms,
          upstream: upstream.ok ? "client_secrets" : `http ${upstream.status}`,
        },
    ]);
  }

  const token = readToken(data);
  if (!upstream.ok || !token) {
    return Response.json({ error: "Could not start a voice session." }, { status: 502 });
  }

  const userId = resolveUserId(request, requestedUserId);
  let decayState = "no active decay tags";
  let memoryInstructions = "";
  let priorChat = "";
  let priorTurns: Awaited<ReturnType<typeof listRecentTurns>> = [];
  let memorySessionId: string | null = null;
  try {
    const recalled = await recallForUser(userId);
    decayState = formatDecayState(recalled);
    memoryInstructions = formatMemoryInstructions(recalled);
  } catch {
    decayState = "no active decay tags";
    memoryInstructions = "";
  }
  try {
    priorTurns = await listRecentTurns(userId);
    priorChat = formatPriorChat(priorTurns);
  } catch {
    priorTurns = [];
    priorChat = "";
  }
  try {
    if (previousSessionId && previousSessionId !== sessionId) {
      await endSession(userId, previousSessionId);
    }
    const session = await createOrResumeSession(userId, sessionId);
    memorySessionId = session?.id ?? parseSessionId(sessionId);
  } catch {
    memorySessionId = parseSessionId(sessionId);
  }

  const sessionLine = formatSessionIdLine(memorySessionId);
  if (sessionLine && !memoryInstructions.includes(sessionLine)) {
    memoryInstructions = memoryInstructions
      ? `${memoryInstructions}\n\n${sessionLine}`
      : sessionLine;
  }

  return Response.json({
    token,
    decayState,
    memoryInstructions,
    priorChat,
    priorTurns,
    sessionId: memorySessionId,
  });
}
