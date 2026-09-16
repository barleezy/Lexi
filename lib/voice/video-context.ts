export const VIDEO_CONTEXT_MODEL = "grok-4.6";
export const VIDEO_CONTEXT_ENDPOINT = "https://api.x.ai/v1/responses";
export const VIDEO_CONTEXT_CACHE_MS = 12_000;

type CachedVideoContext = {
  key: string;
  at: number;
  description: string;
  model: string;
};

let videoContextCache: CachedVideoContext | null = null;

export function videoContextCacheKey(input: {
  title?: string;
  question?: string;
  currentTime?: number;
  frames: Array<{ timeSec: number; dataUrl?: string }>;
}) {
  const time = Number.isFinite(input.currentTime) ? Math.round((input.currentTime as number) / 2) * 2 : 0;
  const frames = input.frames
    .slice(0, 4)
    .map((frame) => {
      const stamp = Number.isFinite(frame.timeSec) ? frame.timeSec.toFixed(1) : "0.0";
      const mark = frame.dataUrl ? `${frame.dataUrl.length}:${frame.dataUrl.slice(-24)}` : "";
      return `${stamp}:${mark}`;
    })
    .join(",");
  return `${input.title?.trim() ?? ""}|${time}|${input.question?.trim() ?? ""}|${frames}`;
}

export function readVideoContextCache(key: string) {
  if (!videoContextCache || videoContextCache.key !== key) return null;
  if (Date.now() - videoContextCache.at > VIDEO_CONTEXT_CACHE_MS) return null;
  return {
    description: videoContextCache.description,
    model: videoContextCache.model,
  };
}

export function writeVideoContextCache(key: string, description: string, model = VIDEO_CONTEXT_MODEL) {
  videoContextCache = { key, at: Date.now(), description, model };
}

export type VideoContextFrame = {
  dataUrl: string;
  timeSec: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectText(value: unknown, into: string[]) {
  const record = asRecord(value);
  if (!record) return;
  if (typeof record.text === "string" && record.text.trim()) {
    const type = typeof record.type === "string" ? record.type : "";
    if (!type || type === "output_text" || type === "text") into.push(record.text.trim());
  }
  if (Array.isArray(record.content)) {
    for (const item of record.content) collectText(item, into);
  }
}

export function readResponsesText(data: unknown): string {
  const record = asRecord(data);
  if (!record) return "";
  if (typeof record.output_text === "string" && record.output_text.trim()) {
    return record.output_text.trim();
  }
  const parts: string[] = [];
  if (Array.isArray(record.output)) {
    for (const item of record.output) collectText(item, parts);
  }
  if (parts.length) return parts.join("\n").trim();

  const choices = record.choices;
  if (Array.isArray(choices)) {
    for (const choice of choices) {
      const message = asRecord(asRecord(choice)?.message);
      if (typeof message?.content === "string" && message.content.trim()) {
        return message.content.trim();
      }
    }
  }
  return "";
}

export function readResponsesError(data: unknown): string {
  const record = asRecord(data);
  if (!record) return "";
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  const nested = asRecord(record.error);
  if (typeof nested?.message === "string" && nested.message.trim()) return nested.message.trim();
  return "";
}

export function buildVideoContextInput(frames: VideoContextFrame[], question: string) {
  const content: Array<Record<string, unknown>> = [];
  for (const frame of frames.slice(0, 4)) {
    content.push({
      type: "input_image",
      image_url: frame.dataUrl,
      detail: "high",
    });
    content.push({
      type: "input_text",
      text: `Frame at ${frame.timeSec.toFixed(1)}s.`,
    });
  }
  content.push({
    type: "input_text",
    text:
      (question.trim() ||
        "Describe what is happening on screen right now. Name visible people, objects, text, setting, and action. Two or three short sentences.") +
      " Adults-only porn/media: if anyone on screen looks under 18, or is a minor, refuse and stop. Voice roleplay age rules are separate.",
  });
  return [
    {
      role: "user",
      content,
    },
  ];
}

export function buildVideoContextRequest(frames: VideoContextFrame[], question: string) {
  return {
    model: VIDEO_CONTEXT_MODEL,
    store: false,
    reasoning: { effort: "none" },
    max_output_tokens: 400,
    search_parameters: { mode: "off" },
    input: buildVideoContextInput(frames, question),
  };
}
