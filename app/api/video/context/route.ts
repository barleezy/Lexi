import { appendVoiceLog, isValidSessionId, isVoiceLogEnabled } from "@/lib/voice/server-log";
import {
  VIDEO_CONTEXT_ENDPOINT,
  VIDEO_CONTEXT_MODEL,
  buildVideoContextRequest,
  readResponsesError,
  readResponsesText,
} from "@/lib/voice/video-context";

const MAX_FRAMES = 3;
const MAX_DATA_URL_CHARS = 1_200_000;

type FrameBody = {
  dataUrl?: unknown;
  timeSec?: unknown;
};

function parseFrames(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const frames: Array<{ dataUrl: string; timeSec: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as FrameBody;
    if (typeof row.dataUrl !== "string") continue;
    if (!row.dataUrl.startsWith("data:image/jpeg") && !row.dataUrl.startsWith("data:image/png")) {
      continue;
    }
    if (row.dataUrl.length > MAX_DATA_URL_CHARS) continue;
    const timeSec = typeof row.timeSec === "number" && Number.isFinite(row.timeSec) ? row.timeSec : 0;
    frames.push({ dataUrl: row.dataUrl, timeSec });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames;
}

export async function POST(request: Request) {
  const started = Date.now();
  const key = process.env.XAI_API_KEY;
  if (!key) {
    return Response.json({ error: "Voice is not configured." }, { status: 500 });
  }

  let body: {
    frames?: unknown;
    question?: unknown;
    title?: unknown;
    currentTime?: unknown;
    duration?: unknown;
    playing?: unknown;
    logSessionId?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid video context request." }, { status: 400 });
  }

  const frames = parseFrames(body.frames);
  if (!frames.length) {
    return Response.json({ error: "No video frames to analyze." }, { status: 400 });
  }

  const question = typeof body.question === "string" ? body.question : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const currentTime = typeof body.currentTime === "number" ? body.currentTime : frames[frames.length - 1]?.timeSec;
  const duration = typeof body.duration === "number" ? body.duration : null;
  const playing = body.playing === true;

  const upstream = await fetch(VIDEO_CONTEXT_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildVideoContextRequest(frames, question)),
  });

  let data: unknown = {};
  try {
    data = await upstream.json();
  } catch {
    data = {};
  }

  const description = readResponsesText(data);
  const error = readResponsesError(data);
  const logSessionId = typeof body.logSessionId === "string" ? body.logSessionId : "";
  if (isVoiceLogEnabled() && isValidSessionId(logSessionId)) {
    await appendVoiceLog(logSessionId, [
      {
        src: "server",
        ts: Date.now(),
        kind: "server.video_context",
        ok: upstream.ok && Boolean(description),
        status: upstream.status,
        ms: Date.now() - started,
        model: VIDEO_CONTEXT_MODEL,
        frames: frames.length,
      },
    ]);
  }

  if (!upstream.ok || !description) {
    return Response.json(
      { error: error || "Could not analyze the video frame." },
      { status: 502 },
    );
  }

  return Response.json({
    description,
    model: VIDEO_CONTEXT_MODEL,
    title,
    currentTime,
    duration,
    playing,
    frames: frames.map((frame) => ({ timeSec: frame.timeSec })),
  });
}
