import { requireAuthSessionUserId } from "@/lib/auth/session";
import { appendVoiceLog, isValidSessionId, isVoiceLogEnabled, logVoiceFallback } from "@/lib/voice/server-log";

function readPlatform(raw: unknown) {
  return raw === "ios" || raw === "web" || raw === "android" ? raw : "";
}

export async function POST(request: Request) {
  let body: {
    sessionId?: unknown;
    entries?: unknown;
    reason?: unknown;
    platform?: unknown;
    kind?: unknown;
    userId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const platform = readPlatform(body.platform);
  if (reason && platform) {
    const userId = await requireAuthSessionUserId(
      request,
      typeof body.userId === "string" ? body.userId : null,
    );
    if (!userId) {
      return Response.json({ error: "Sign in first." }, { status: 401 });
    }
    const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
    logVoiceFallback({
      reason,
      source: platform,
      sessionId: sessionId || undefined,
      userId,
    });
    console.error("[voice.connect]", {
      userId,
      platform,
      reason,
      sessionId: sessionId || undefined,
      kind: typeof body.kind === "string" ? body.kind : "connect.fail",
    });
    if (isVoiceLogEnabled() && sessionId && isValidSessionId(sessionId)) {
      await appendVoiceLog(sessionId, [
        { kind: "connect.fail", platform, reason, userId, ts: Date.now() },
      ]);
    }
    return new Response(null, { status: 204 });
  }

  if (!isVoiceLogEnabled()) {
    return new Response(null, { status: 404 });
  }

  if (typeof body.sessionId !== "string" || !isValidSessionId(body.sessionId)) {
    return Response.json({ error: "Invalid sessionId" }, { status: 400 });
  }
  if (!Array.isArray(body.entries)) {
    return Response.json({ error: "Invalid entries" }, { status: 400 });
  }

  const entries = body.entries.filter(
    (entry): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && !Array.isArray(entry),
  );

  await appendVoiceLog(body.sessionId, entries);
  return new Response(null, { status: 204 });
}
