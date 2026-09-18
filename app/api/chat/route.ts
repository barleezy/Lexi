import { connection } from "next/server";
import { requireAuthSessionUserId } from "@/lib/auth/session";
import { replyInAppChat, textChatModel } from "@/lib/chat/reply";
import { logVoiceFallback } from "@/lib/voice/server-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

/**
 * First-class typed chat. Text model only — never mints a realtime client
 * secret, never opens the voice WebSocket, and never holds or debits
 * Call minutes.
 */
export async function POST(request: Request) {
  await connection();
  let body: {
    text?: unknown;
    message?: unknown;
    userId?: unknown;
    sessionId?: unknown;
    source?: unknown;
    platform?: unknown;
    fallbackReason?: unknown;
    reason?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const claimed = typeof body.userId === "string" ? body.userId : null;
  const userId = await requireAuthSessionUserId(request, claimed);
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  const fallbackReason =
    (typeof body.fallbackReason === "string" && body.fallbackReason.trim()) ||
    (typeof body.reason === "string" && body.reason.trim()) ||
    "";
  if (fallbackReason) {
    logVoiceFallback({
      reason: fallbackReason,
      source:
        typeof body.source === "string"
          ? body.source
          : typeof body.platform === "string"
            ? body.platform
            : "chat",
      sessionId: typeof body.sessionId === "string" ? body.sessionId : undefined,
      userId,
    });
  }

  const text = typeof body.text === "string" ? body.text : typeof body.message === "string" ? body.message : "";
  if (!text.trim()) {
    return Response.json({ error: "Message is empty." }, { status: 400 });
  }

  const result = await replyInAppChat({
    text,
    userId,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
    source:
      typeof body.source === "string"
        ? body.source
        : typeof body.platform === "string"
          ? body.platform
          : "app",
  });
  if (!result.ok) {
    return Response.json({ error: result.error, model: result.model || textChatModel() }, { status: result.status });
  }
  return Response.json({
    ok: true,
    reply: result.reply,
    sessionId: result.sessionId,
    persisted: result.persisted,
    model: result.model,
  });
}
