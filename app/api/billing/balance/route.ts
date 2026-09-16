import { requireAuthSessionUserId } from "@/lib/auth/session";
import { buyPagePacks, publicPacks, isStripeConfigured } from "@/lib/wallet/packs";
import { formatVoiceMinutes, readVoiceSeconds, sweepStaleVoiceSessions } from "@/lib/wallet/voice";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = requireAuthSessionUserId(request, url.searchParams.get("userId"));
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }
  await sweepStaleVoiceSessions(userId);
  const voiceSeconds = (await readVoiceSeconds(userId)) ?? 0;
  return Response.json({
    ok: true,
    userId,
    voiceSeconds,
    label: formatVoiceMinutes(voiceSeconds),
    packs: publicPacks(),
    buyPacks: buyPagePacks(),
    stripeConfigured: isStripeConfigured(),
  });
}
