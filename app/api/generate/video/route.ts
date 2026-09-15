import {
  VIDEO_GENERATIONS_URL,
  VIDEO_POLL_ATTEMPTS,
  VIDEO_POLL_MS,
  buildVideoGenerationBody,
  readVideoError,
  readVideoRequestId,
  readVideoResult,
  videoModelFromEnv,
  videoStatusUrl,
} from "@/lib/generate/media";
import { refusePornSubject } from "@/lib/generate/safety";

export const maxDuration = 60;

async function pollVideo(key: string, requestId: string) {
  let last: unknown = { request_id: requestId, status: "pending" };
  for (let attempt = 0; attempt < VIDEO_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_MS));
    }
    const upstream = await fetch(videoStatusUrl(requestId), {
      headers: { Authorization: `Bearer ${key}` },
    });
    try {
      last = await upstream.json();
    } catch {
      last = {};
    }
    const result = readVideoResult(last);
    if (result.status !== "pending") {
      return { httpStatus: upstream.status, data: last, result };
    }
  }
  return { httpStatus: 200, data: last, result: readVideoResult(last) };
}

export async function POST(request: Request) {
  const key = process.env.XAI_API_KEY?.trim();
  if (!key) {
    return Response.json({ error: "Video generation is not configured.", configured: false }, { status: 503 });
  }

  let body: {
    prompt?: unknown;
    duration?: unknown;
    aspect_ratio?: unknown;
    aspectRatio?: unknown;
    resolution?: unknown;
    silent?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid video request." }, { status: 400 });
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const safety = refusePornSubject(prompt);
  if (!safety.ok) {
    return Response.json({ error: safety.error }, { status: 400 });
  }

  const model = videoModelFromEnv();
  const upstream = await fetch(VIDEO_GENERATIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      buildVideoGenerationBody({
        prompt,
        model,
        duration: body.duration,
        aspectRatio: body.aspect_ratio ?? body.aspectRatio,
        resolution: body.resolution,
        silent: body.silent,
      }),
    ),
  });

  let started: unknown = {};
  try {
    started = await upstream.json();
  } catch {
    started = {};
  }

  const requestId = readVideoRequestId(started);
  if (!upstream.ok || !requestId) {
    const status = upstream.status === 401 ? 401 : upstream.status >= 400 && upstream.status < 500 ? 400 : 502;
    return Response.json({ error: readVideoError(started), configured: true }, { status });
  }

  const polled = await pollVideo(key, requestId);
  const result = polled.result;
  if (result.status === "failed") {
    return Response.json(
      {
        ok: false,
        kind: "video",
        prompt,
        model: result.model || model,
        requestId,
        status: "failed",
        error: result.error || "Video generation failed.",
      },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    kind: "video",
    prompt,
    model: result.model || model,
    requestId,
    status: result.status,
    url: result.url,
    durationSec: result.durationSec,
    progress: result.progress,
  });
}
