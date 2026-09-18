import { connection } from "next/server";
import { buildIosSession, IOS_REALTIME_URL, IOS_TARGET_RATE } from "@/lib/ios/session";
import { mintXaiClientSecret } from "@/lib/xai/client-secret";
import { readIosSession } from "@/lib/ios/auth";
import { requireAuthSessionUserId } from "@/lib/auth/session";
import { logVoiceEnv, readMintError, voiceMintFailureMessage, xaiInferenceKey } from "@/lib/xai/env";
import type { DeviceLocationState } from "@/lib/voice/location";
import type { MusicSessionState } from "@/lib/voice/persona";
import {
  OUT_OF_MINUTES_CODE,
  OUT_OF_MINUTES_MESSAGE,
  SESSION_LIMIT_CODE,
  VOICE_MAX_SESSION_SECONDS,
  VOICE_MAX_SESSION_SPEND_USD,
  estimateVoiceSessionSpendUsd,
  extendVoiceHold,
  placeVoiceHold,
  REALTIME_VOICE_MODEL,
  releaseVoiceHold,
  shrinkVoiceHold,
  sweepStaleVoiceSessions,
} from "@/lib/wallet/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function parseLocation(raw: unknown): DeviceLocationState | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const latitude = typeof row.latitude === "number" ? row.latitude : Number(row.latitude);
  const longitude = typeof row.longitude === "number" ? row.longitude : Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { granted: false };
  }
  return {
    granted: row.granted !== false,
    latitude,
    longitude,
    accuracyM: typeof row.accuracyM === "number" ? row.accuracyM : undefined,
    city: typeof row.city === "string" ? row.city : undefined,
    region: typeof row.region === "string" ? row.region : undefined,
    country: typeof row.country === "string" ? row.country : undefined,
  };
}

export async function POST(request: Request) {
  await connection();
  logVoiceEnv("ios-session");
  let body: {
    sessionId?: unknown;
    previousSessionId?: unknown;
    userId?: unknown;
    clientTimeZone?: unknown;
    timeZone?: unknown;
    location?: unknown;
    musicPlaying?: unknown;
    musicTitle?: unknown;
    musicSource?: unknown;
    rehearsal?: unknown;
    voiceSessionId?: unknown;
    extend?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const iosAuth = readIosSession(request);
  const claimed =
    iosAuth?.userId ?? (typeof body.userId === "string" ? body.userId : null);
  // Signed iOS bearer (or web session). Do not trust x-lexi-user-id alone.
  const userId = await requireAuthSessionUserId(request, claimed);
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  if (body.rehearsal === true) {
    return Response.json({
      rehearsal: true,
      token: null,
      realtimeUrl: IOS_REALTIME_URL,
      model: REALTIME_VOICE_MODEL,
      userId,
      priorChat: "",
      sessionId: null,
      voiceSessionId: null,
    });
  }

  const key = xaiInferenceKey();
  if (!key) {
    return Response.json({ error: "Voice is not configured." }, { status: 500 });
  }

  await sweepStaleVoiceSessions(userId);
  const resumeVoiceSessionId =
    typeof body.voiceSessionId === "string" ? body.voiceSessionId.trim() : "";
  const hold =
    body.extend === true && resumeVoiceSessionId
      ? await extendVoiceHold(userId, resumeVoiceSessionId)
      : await placeVoiceHold(userId);
  if (!hold.ok) {
    const status =
      hold.code === OUT_OF_MINUTES_CODE || hold.code === SESSION_LIMIT_CODE
        ? 402
        : hold.code === "busy"
          ? 409
          : 401;
    return Response.json(
      {
        error:
          hold.code === OUT_OF_MINUTES_CODE
            ? OUT_OF_MINUTES_MESSAGE
            : hold.error,
        code: hold.code,
      },
      { status },
    );
  }

  const minted = await mintXaiClientSecret(key, hold.mintTtlSeconds);
  if (!minted.ok || !minted.token) {
    if (body.extend === true) {
      await shrinkVoiceHold(userId, hold.voiceSessionId, hold.addedSeconds ?? 0);
    } else {
      await releaseVoiceHold(userId, hold.voiceSessionId);
    }
    const error = voiceMintFailureMessage(readMintError(minted.data));
    return Response.json({ error }, { status: 502 });
  }

  const musicSource = body.musicSource;
  const source: MusicSessionState["source"] =
    musicSource === "apple" || musicSource === "url" || musicSource === "none"
      ? musicSource
      : "none";

  const built = await buildIosSession({
    request,
    requestedUserId: userId,
    sessionId: typeof body.sessionId === "string" ? body.sessionId : null,
    previousSessionId: typeof body.previousSessionId === "string" ? body.previousSessionId : null,
    clientTimeZone:
      (typeof body.clientTimeZone === "string" && body.clientTimeZone) ||
      (typeof body.timeZone === "string" && body.timeZone) ||
      "",
    location: parseLocation(body.location),
    musicPlaying: body.musicPlaying === true,
    musicTitle: typeof body.musicTitle === "string" ? body.musicTitle : "",
    musicSource: source,
  });

  return Response.json({
    token: minted.token,
    realtimeUrl: IOS_REALTIME_URL,
    model: REALTIME_VOICE_MODEL,
    sampleRate: IOS_TARGET_RATE,
    voice: "aria",
    userId: built.userId,
    sessionId: built.sessionId,
    voiceSessionId: hold.voiceSessionId,
    holdSeconds: hold.holdSeconds,
    voiceSeconds: hold.voiceSeconds,
    startedAt: hold.startedAt,
    capAtMs: hold.capAtMs,
    maxDurationSeconds: VOICE_MAX_SESSION_SECONDS,
    maxSpendUsd: VOICE_MAX_SESSION_SPEND_USD,
    estimatedSpendUsd: estimateVoiceSessionSpendUsd(
      Math.max(0, Math.floor((Date.now() - Date.parse(hold.startedAt)) / 1000) || 0),
    ),
    mintTtlSeconds: minted.ttl,
    decayState: built.decayState,
    memoryInstructions: built.memoryInstructions,
    priorChat: "",
    instructions: built.instructions,
    sessionUpdate: built.sessionUpdate,
  });
}
