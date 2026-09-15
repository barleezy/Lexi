import { formatDecayState, recallForUser } from "@/lib/memory/store";
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
  try {
    const body = (await request.json()) as { sessionId?: unknown };
    if (typeof body.sessionId === "string") sessionId = body.sessionId;
  } catch {
    sessionId = "";
  }

  const key = process.env.XAI_API_KEY;
  if (!key) {
    if (isVoiceLogEnabled() && isValidSessionId(sessionId)) {
      await appendVoiceLog(sessionId, [
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

  if (isVoiceLogEnabled() && isValidSessionId(sessionId)) {
    await appendVoiceLog(sessionId, [
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

  let decayState = "no active decay tags";
  try {
    decayState = formatDecayState(await recallForUser(resolveUserId(request)));
  } catch {
    decayState = "no active decay tags";
  }

  return Response.json({ token, decayState });
}
