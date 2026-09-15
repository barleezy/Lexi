import { buildIosSession, IOS_REALTIME_URL, IOS_TARGET_RATE, mintXaiClientSecret } from "@/lib/ios/session";
import { readIosSession } from "@/lib/ios/auth";
import { requireSignedInUserId } from "@/lib/memory/user";
import type { DeviceLocationState } from "@/lib/voice/location";
import type { MusicSessionState } from "@/lib/voice/persona";

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
  const key = process.env.XAI_API_KEY;
  if (!key) {
    return Response.json({ error: "Voice is not configured." }, { status: 500 });
  }

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
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const iosAuth = readIosSession(request);
  const requestedUserId =
    iosAuth?.userId ?? (typeof body.userId === "string" ? body.userId : null);
  const userId = requireSignedInUserId(request, requestedUserId);
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  const minted = await mintXaiClientSecret(key);
  if (!minted.ok || !minted.token) {
    return Response.json({ error: "Could not start a voice session." }, { status: 502 });
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
    sampleRate: IOS_TARGET_RATE,
    voice: "aria",
    userId: built.userId,
    sessionId: built.sessionId,
    decayState: built.decayState,
    memoryInstructions: built.memoryInstructions,
    priorChat: built.priorChat,
    instructions: built.instructions,
    sessionUpdate: built.sessionUpdate,
  });
}
