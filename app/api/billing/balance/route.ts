import { cookies } from "next/headers";
import {
  LEXI_SESSION_COOKIE,
  readAuthSessionUserId,
  verifyAuthSession,
} from "@/lib/auth/session";
import { buyPagePacks, publicPacks, isStripeConfigured } from "@/lib/wallet/packs";
import { formatVoiceMinutes, readVoiceSeconds, sweepStaleVoiceSessions } from "@/lib/wallet/voice";

export async function GET(request: Request) {
  const fromRequest = readAuthSessionUserId(request);
  const jar = await cookies();
  const token = jar.get(LEXI_SESSION_COOKIE)?.value ?? "";
  const fromCookies = token ? verifyAuthSession(token) : null;
  const userId = fromRequest || fromCookies?.userId || null;
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
