import { connection } from "next/server";
import { requireAuthSessionUserId } from "@/lib/auth/session";
import { buyPagePacks, publicPacks, isStripeConfigured } from "@/lib/wallet/packs";
import { readAccountSubscribed } from "@/lib/wallet/subscription";
import { formatVoiceMinutes, readVoiceSeconds, sweepStaleVoiceSessions } from "@/lib/wallet/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "private, no-store, no-cache, must-revalidate" };

export async function GET(request: Request) {
  await connection();
  const userId = await requireAuthSessionUserId(request);
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401, headers: NO_STORE });
  }
  await sweepStaleVoiceSessions(userId);
  const voiceSeconds = (await readVoiceSeconds(userId)) ?? 0;
  const subscribed = await readAccountSubscribed(userId);
  return Response.json(
    {
      ok: true,
      userId,
      voiceSeconds,
      subscribed,
      label: formatVoiceMinutes(voiceSeconds),
      packs: publicPacks(),
      buyPacks: buyPagePacks(),
      stripeConfigured: isStripeConfigured(),
    },
    { headers: NO_STORE },
  );
}
