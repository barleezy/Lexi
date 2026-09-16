import { requireAuthSessionUserId } from "@/lib/auth/session";
import { settleVoiceSession, sweepStaleVoiceSessions } from "@/lib/wallet/voice";

export const maxDuration = 15;

/** Hangup settle: used = min(elapsed, hold); refund unused hold. */
export async function POST(request: Request) {
  let body: { voiceSessionId?: unknown; userId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const userId = await requireAuthSessionUserId(
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
  return Response.json({
    ok: true,
    userId,
    voiceSessionId,
    ...settled,
  });
}
