import { appendVoiceLog, isValidSessionId, isVoiceLogEnabled } from "@/lib/voice/server-log";

export async function POST(request: Request) {
  if (!isVoiceLogEnabled()) {
    return new Response(null, { status: 404 });
  }

  let body: { sessionId?: unknown; entries?: unknown };
  try {
    body = (await request.json()) as { sessionId?: unknown; entries?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
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
