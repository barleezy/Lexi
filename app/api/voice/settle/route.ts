import { requireAuthSessionUserId } from "@/lib/auth/session";
import { summarizeSettledCall } from "@/lib/memory/call-summaries";
import { settleVoiceSession, sweepStaleVoiceSessions } from "@/lib/wallet/voice";

export const maxDuration = 60;

/** Hangup settle: used = min(elapsed, hold); refund unused hold; then store a call summary. */
export async function POST(request: Request) {
  let body: { voiceSessionId?: unknown; userId?: unknown; sessionId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const userId = requireAuthSessionUserId(
    request,
    typeof body.userId === "string" ? body.userId : null,
  );
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  await sweepStaleVoiceSessions(userId);

  const voiceSessionId = typeof body.voiceSessionId === "string" ? body.voiceSessionId.trim() : "";
  if (!voiceSessionId) {
    return Response.json({ error: "voiceSessionId is required." }, { status: 400 });
  }

  const settled = await settleVoiceSession(userId, voiceSessionId);
  if (!settled) {
    return Response.json({ error: "Voice session not found." }, { status: 404 });
  }

  const memorySessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
  let memory: { ok: boolean; reason?: string; summary?: string } = { ok: false, reason: "skipped" };
  if (memorySessionId && !settled.alreadySettled) {
    try {
      memory = await summarizeSettledCall({ userId, sessionId: memorySessionId });
    } catch {
      memory = { ok: false, reason: "error" };
    }
  }

  return Response.json({
    ok: true,
    userId,
    voiceSessionId,
    ...settled,
    memory,
  });
}
