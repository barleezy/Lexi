import { parseVideoRequestId, readVideoError, readVideoResult, videoStatusUrl } from "@/lib/generate/media";

export const maxDuration = 30;

export async function GET(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    return Response.json({ error: "Video generation is not configured.", configured: false }, { status: 503 });
  }

  const { requestId: rawId } = await context.params;
  const requestId = parseVideoRequestId(rawId);
  if (!requestId) {
    return Response.json({ error: "Invalid video request id." }, { status: 400 });
  }

  const upstream = await fetch(videoStatusUrl(requestId), {
    headers: { Authorization: `Bearer ${key}` },
  });

  let data: unknown = {};
  try {
    data = await upstream.json();
  } catch {
    data = {};
  }

  const result = readVideoResult(data);
  if (!upstream.ok && result.status === "pending") {
    const status = upstream.status === 401 ? 401 : 502;
    return Response.json({ error: readVideoError(data), configured: true }, { status });
  }

  return Response.json({
    ok: result.status !== "failed",
    kind: "video",
    requestId,
    status: result.status,
    url: result.url,
    durationSec: result.durationSec,
    model: result.model,
    progress: result.progress,
    error: result.status === "failed" ? result.error || "Video generation failed." : undefined,
  });
}
