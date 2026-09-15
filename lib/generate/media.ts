export type GeneratedMediaKind = "image" | "video";

export type GeneratedMediaStatus = "pending" | "done" | "failed";

export type GeneratedMediaItem = {
  id: string;
  kind: GeneratedMediaKind;
  prompt: string;
  status: GeneratedMediaStatus;
  url?: string;
  dataUrl?: string;
  requestId?: string;
  model?: string;
  error?: string;
  durationSec?: number;
};

export const IMAGE_GENERATIONS_URL = "https://api.x.ai/v1/images/generations";
export const VIDEO_GENERATIONS_URL = "https://api.x.ai/v1/videos/generations";
export const DEFAULT_IMAGE_MODEL = "grok-imagine-image-2.0";
export const DEFAULT_VIDEO_MODEL = "grok-imagine-video-1.5";

export const IMAGE_ASPECT_RATIOS = [
  "1:1",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "2:3",
  "3:2",
  "9:19.5",
  "19.5:9",
  "9:20",
  "20:9",
  "1:2",
  "2:1",
  "21:9",
  "5:2",
  "auto",
] as const;

export const VIDEO_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
export const IMAGE_RESOLUTIONS = ["1k", "2k"] as const;
export const VIDEO_RESOLUTIONS = ["480p", "720p", "1080p"] as const;
export const VIDEO_POLL_MS = 2000;
export const VIDEO_POLL_ATTEMPTS = 10;
export const VIDEO_REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];
export type ImageResolution = (typeof IMAGE_RESOLUTIONS)[number];
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number];

export function videoStatusUrl(requestId: string) {
  return `https://api.x.ai/v1/videos/${encodeURIComponent(requestId)}`;
}

export function imageModelFromEnv(env = process.env) {
  const override = env.XAI_IMAGE_MODEL?.trim();
  return override || DEFAULT_IMAGE_MODEL;
}

export function videoModelFromEnv(env = process.env) {
  const override = env.XAI_VIDEO_MODEL?.trim();
  return override || DEFAULT_VIDEO_MODEL;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function parseImageAspectRatio(value: unknown): ImageAspectRatio | undefined {
  return typeof value === "string" && (IMAGE_ASPECT_RATIOS as readonly string[]).includes(value)
    ? (value as ImageAspectRatio)
    : undefined;
}

export function parseImageResolution(value: unknown): ImageResolution | undefined {
  return typeof value === "string" && (IMAGE_RESOLUTIONS as readonly string[]).includes(value)
    ? (value as ImageResolution)
    : undefined;
}

export function imageDataUrl(b64: string, mimeType?: string) {
  if (b64.startsWith("data:")) return b64;
  const mime = mimeType && mimeType.startsWith("image/") ? mimeType : "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

export function buildImageGenerationBody(input: {
  prompt: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
  n?: number;
}) {
  const n = Number.isFinite(input.n) ? Math.min(10, Math.max(1, Math.round(input.n as number))) : 1;
  const body: Record<string, unknown> = {
    model: input.model?.trim() || DEFAULT_IMAGE_MODEL,
    prompt: input.prompt,
    n,
    response_format: "b64_json",
  };
  const aspectRatio = parseImageAspectRatio(input.aspectRatio);
  if (aspectRatio && aspectRatio !== "auto") body.aspect_ratio = aspectRatio;
  const resolution = parseImageResolution(input.resolution);
  if (resolution) body.resolution = resolution;
  return body;
}

export function readGeneratedImages(data: unknown) {
  const record = asRecord(data);
  const rows = Array.isArray(record?.data) ? record.data : [];
  const images: Array<{ url?: string; dataUrl?: string; mimeType?: string }> = [];
  for (const item of rows) {
    const row = asRecord(item);
    if (!row) continue;
    const mimeType = typeof row.mime_type === "string" ? row.mime_type : undefined;
    const url = typeof row.url === "string" && row.url ? row.url : undefined;
    const b64 = typeof row.b64_json === "string" && row.b64_json ? row.b64_json : "";
    const dataUrl = b64 ? imageDataUrl(b64, mimeType) : undefined;
    if (!url && !dataUrl) continue;
    images.push({ url, dataUrl, mimeType });
  }
  return images;
}

export function readImageError(data: unknown, fallback = "Could not generate an image.") {
  const record = asRecord(data);
  if (!record) return fallback;
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  const nested = asRecord(record.error);
  if (typeof nested?.message === "string" && nested.message.trim()) return nested.message.trim();
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  return fallback;
}

export function parseVideoAspectRatio(value: unknown): VideoAspectRatio | undefined {
  return typeof value === "string" && (VIDEO_ASPECT_RATIOS as readonly string[]).includes(value)
    ? (value as VideoAspectRatio)
    : undefined;
}

export function parseVideoResolution(value: unknown): VideoResolution | undefined {
  return typeof value === "string" && (VIDEO_RESOLUTIONS as readonly string[]).includes(value)
    ? (value as VideoResolution)
    : undefined;
}

export function parseVideoDuration(value: unknown) {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return undefined;
  const seconds = Math.round(n);
  if (seconds < 1 || seconds > 15) return undefined;
  return seconds;
}

export function parseVideoRequestId(value: unknown) {
  return typeof value === "string" && VIDEO_REQUEST_ID.test(value) ? value : "";
}

export function buildVideoGenerationBody(input: {
  prompt: string;
  model?: string;
  duration?: unknown;
  aspectRatio?: unknown;
  resolution?: unknown;
  silent?: unknown;
}) {
  const body: Record<string, unknown> = {
    model: input.model?.trim() || DEFAULT_VIDEO_MODEL,
    prompt: input.prompt,
  };
  const duration = parseVideoDuration(input.duration);
  if (duration) body.duration = duration;
  const aspectRatio = parseVideoAspectRatio(input.aspectRatio);
  if (aspectRatio) body.aspect_ratio = aspectRatio;
  const resolution = parseVideoResolution(input.resolution);
  if (resolution) body.resolution = resolution;
  if (input.silent === true || input.silent === "true") body.generate_audio = false;
  return body;
}

export function readVideoRequestId(data: unknown) {
  const record = asRecord(data);
  return parseVideoRequestId(record?.request_id);
}

export function readVideoStatus(data: unknown): "pending" | "done" | "failed" {
  const record = asRecord(data);
  const status = typeof record?.status === "string" ? record.status.toLowerCase() : "";
  if (status === "done") return "done";
  if (status === "failed" || status === "error") return "failed";
  if (record?.error) return "failed";
  return "pending";
}

export function readVideoError(data: unknown, fallback = "Could not generate a video.") {
  const record = asRecord(data);
  if (!record) return fallback;
  if (typeof record.error === "string" && record.error.trim()) return record.error.trim();
  const nested = asRecord(record.error);
  if (typeof nested?.message === "string" && nested.message.trim()) return nested.message.trim();
  if (typeof record.message === "string" && record.message.trim()) return record.message.trim();
  return fallback;
}

export function readVideoResult(data: unknown) {
  const record = asRecord(data);
  const video = asRecord(record?.video);
  const url =
    (typeof video?.url === "string" && video.url) ||
    (typeof video?.public_url === "string" && video.public_url) ||
    "";
  const duration =
    typeof video?.duration === "number" && Number.isFinite(video.duration) ? video.duration : undefined;
  const respect = video?.respect_moderation;
  const moderatedOut = respect === false && !url;
  const model = typeof record?.model === "string" ? record.model : undefined;
  const progress =
    typeof record?.progress === "number" && Number.isFinite(record.progress) ? record.progress : undefined;
  return {
    status: moderatedOut ? ("failed" as const) : readVideoStatus(data),
    url: url || undefined,
    durationSec: duration,
    model,
    progress,
    respectModeration: respect === true,
    error: moderatedOut ? "Video was blocked by moderation." : readVideoError(data, ""),
  };
}
