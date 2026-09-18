import { readXaiClientSecret } from "@/lib/ios/config";
import { REALTIME_VOICE_MODEL } from "@/lib/xai/realtime-model";

const UPSTREAM = "https://api.x.ai/v1/realtime/client_secrets";

export async function mintXaiClientSecret(apiKey: string, ttlSeconds = 3600) {
  const ttl = Math.max(30, Math.min(3600, Math.floor(ttlSeconds)));
  const upstream = await fetch(UPSTREAM, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { seconds: ttl },
      session: {
        model: REALTIME_VOICE_MODEL,
        reasoning: { effort: "none" },
      },
    }),
  });
  let data: Parameters<typeof readXaiClientSecret>[0] = {};
  try {
    data = (await upstream.json()) as Parameters<typeof readXaiClientSecret>[0];
  } catch {
    data = {};
  }
  const token = readXaiClientSecret(data);
  return { ok: upstream.ok && Boolean(token), token, status: upstream.status, ttl, data };
}
