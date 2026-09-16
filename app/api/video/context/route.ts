import { appendVoiceLog, isValidSessionId, isVoiceLogEnabled } from "@/lib/voice/server-log";
import { refusePornSubject } from "@/lib/generate/safety";
import {
  VIDEO_CONTEXT_CHAT_ENDPOINT,
  VIDEO_CONTEXT_ENDPOINT,
  VIDEO_CONTEXT_MODEL,
  buildVideoContextChatRequest,
  buildVideoContextRequest,
  readChatCompletionsText,
  readResponsesError,
  readResponsesText,
  readVideoContextCache,
  videoContextCacheKey,
  writeVideoContextCache,
} from "@/lib/voice/video-context";

const MAX_FRAMES = 4;
const MAX_DATA_URL_CHARS = 2_400_000;

type FrameBody = {
  dataUrl?: unknown;
  timeSec?: unknown;
  label?: unknown;
};

function parseFrames(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  const frames: Array<{ dataUrl: string; timeSec: number; label?: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as FrameBody;
    if (typeof row.dataUrl !== "string") continue;
    if (!row.dataUrl.startsWith("data:image/jpeg") && !row.dataUrl.startsWith("data:image/png")) {
      continue;
    }
    if (row.dataUrl.length > MAX_DATA_URL_CHARS) continue;
    const timeSec = typeof row.timeSec === "number" && Number.isFinite(row.timeSec) ? row.timeSec : 0;
    const label = typeof row.label === "string" && row.label.trim() ? row.label.trim() : undefined;
    frames.push({ dataUrl: row.dataUrl, timeSec, label });
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
  const titleSafety = title ? refusePornSubject(title) : { ok: true as const };
  if (!titleSafety.ok) {
    return Response.json({ error: titleSafety.error }, { status: 400 });
  }
  const currentTime = typeof body.currentTime === "number" ? body.currentTime : frames[frames.length - 1]?.timeSec;
  const duration = typeof body.duration === "number" ? body.duration : null;
  const playing = body.playing === true;
  const cacheKey = videoContextCacheKey({ title, question, currentTime, frames });
  const cached = readVideoContextCache(cacheKey);
  if (cached) {
    return Response.json({
      description: cached.description,
      model: cached.model,
      title,
      currentTime,
      duration,
      playing,
      cached: true,
      frames: frames.map((frame) => ({ timeSec: frame.timeSec })),
    });
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const upstream = await fetch(VIDEO_CONTEXT_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(buildVideoContextRequest(frames, question)),
  });

  let data: unknown = {};
  try {
    data = await upstream.json();
  } catch {
    data = {};
  }

  let description = readResponsesText(data);
  let error = readResponsesError(data);
  let via = "responses";
  let status = upstream.status;

  if (!description) {
    const chat = await fetch(VIDEO_CONTEXT_CHAT_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(buildVideoContextChatRequest(frames, question)),
    });
    let chatData: unknown = {};
    try {
      chatData = await chat.json();
    } catch {
      chatData = {};
    }
    const chatText = readChatCompletionsText(chatData);
    if (chatText) {
      description = chatText;
      error = "";
      via = "chat";
      status = chat.status;
    } else if (!error) {
      error = readResponsesError(chatData) || `Video analysis returned ${chat.status}.`;
      status = chat.status;
    }
  }
  const logSessionId = typeof body.logSessionId === "string" ? body.logSessionId : "";
  if (isVoiceLogEnabled() && isValidSessionId(logSessionId)) {
    await appendVoiceLog(logSessionId, [
      {
        src: "server",
        ts: Date.now(),
        kind: "server.video_context",
        ok: Boolean(description),
        status,
        ms: Date.now() - started,
        model: VIDEO_CONTEXT_MODEL,
        frames: frames.length,
        via,
      },
    ]);
  }

  if (!description) {
    return Response.json(
      { error: error || "Could not analyze the video frame." },
      { status: 502 },
    );
  }

  writeVideoContextCache(cacheKey, description, VIDEO_CONTEXT_MODEL);
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
