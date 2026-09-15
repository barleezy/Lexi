export const WATCH_VIDEO_MAX_BYTES = 1024 * 1024 * 1024;

export const VIDEO_ACCEPT = [
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/x-m4v",
  "video/x-matroska",
  "video/x-flv",
  "video/x-msvideo",
  "video/mpeg",
  "video/x-ms-wmv",
  "video/3gpp",
  "video/mp2t",
  ".mp4",
  ".webm",
  ".ogv",
  ".ogg",
  ".mov",
  ".m4v",
  ".mkv",
  ".flv",
  ".avi",
  ".mpeg",
  ".mpg",
  ".mpe",
  ".wmv",
  ".asf",
  ".3gp",
  ".ts",
  ".m2ts",
  ".mts",
].join(",");

export type WatchPlaybackKind = "native" | "mpegts" | "remux";

const NATIVE_EXT = new Set(["mp4", "webm", "ogv", "ogg", "mov", "m4v", "3gp", "3g2"]);
const MPEGTS_EXT = new Set(["flv", "ts", "m2ts", "mts"]);
const REMUX_EXT = new Set(["avi", "wmv", "asf", "mpeg", "mpg", "mpe", "mkv"]);
const ALL_EXT = new Set([...NATIVE_EXT, ...MPEGTS_EXT, ...REMUX_EXT]);

const NATIVE_MIME = new Set([
  "video/mp4",
  "video/webm",
  "video/ogg",
  "video/quicktime",
  "video/x-m4v",
  "video/3gpp",
  "video/3gpp2",
]);
const MPEGTS_MIME = new Set(["video/x-flv", "video/flv", "video/mp2t"]);
const REMUX_MIME = new Set([
  "video/x-msvideo",
  "video/avi",
  "video/mpeg",
  "video/x-mpeg",
  "video/x-ms-wmv",
  "video/x-ms-asf",
  "video/x-matroska",
  "video/matroska",
]);

export function videoExtension(nameOrUrl: string) {
  const trimmed = nameOrUrl.trim();
  if (!trimmed) return "";
  let path = trimmed.split("#")[0] ?? trimmed;
  try {
    path = decodeURIComponent(new URL(trimmed, "http://localhost").pathname);
  } catch {
    path = (path.split("?")[0] ?? path).trim();
  }
  const base = path.split("/").filter(Boolean).pop() ?? path;
  const match = /\.([a-z0-9]+)$/i.exec(base);
  return match?.[1]?.toLowerCase() ?? "";
}

function mimeType(value: string | undefined) {
  return (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
}

export function isVideoFile(file: { name: string; type?: string }) {
  const type = mimeType(file.type);
  if (type.startsWith("video/")) return true;
  return ALL_EXT.has(videoExtension(file.name));
}

export function watchPlaybackKind(file: { name: string; type?: string }): WatchPlaybackKind {
  const ext = videoExtension(file.name);
  if (NATIVE_EXT.has(ext)) return "native";
  if (MPEGTS_EXT.has(ext)) return "mpegts";
  if (REMUX_EXT.has(ext)) return "remux";
  const type = mimeType(file.type);
  if (NATIVE_MIME.has(type)) return "native";
  if (MPEGTS_MIME.has(type)) return "mpegts";
  if (REMUX_MIME.has(type)) return "remux";
  return "native";
}

export function watchPlaysInHomeTab(file: { name: string; type?: string }) {
  return watchPlaybackKind(file) === "native";
}

export function watchShouldRemuxOnNativeError(file: { name: string; type?: string }) {
  const ext = videoExtension(file.name);
  if (ext === "mp4" || ext === "webm") return false;
  return watchPlaybackKind(file) !== "mpegts";
}

export function mpegtsMediaType(file: { name: string; type?: string }): "flv" | "mpegts" {
  const ext = videoExtension(file.name);
  const type = mimeType(file.type);
  if (ext === "flv" || type === "video/x-flv" || type === "video/flv") return "flv";
  return "mpegts";
}

export function watchInputFileName(nameOrUrl: string) {
  const ext = videoExtension(nameOrUrl) || "bin";
  return ALL_EXT.has(ext) || ext === "bin" ? `input.${ext}` : "input.bin";
}

export function formatWatchSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function watchSizeError(size: number) {
  if (!Number.isFinite(size) || size <= WATCH_VIDEO_MAX_BYTES) return null;
  return `That video is ${formatWatchSize(size)}. Watch-together max is 1 GB.`;
}
