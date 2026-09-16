import { captureJpegDataUrl } from "@/lib/voice/vision";
import { directVideoHref } from "@/lib/voice/watch-formats";

export {
  VIDEO_ACCEPT,
  WATCH_VIDEO_MAX_BYTES,
  directVideoHref,
  isVideoFile,
  watchPlaybackKind,
  watchPlaysInHomeTab,
  watchShouldRemuxOnNativeError,
} from "@/lib/voice/watch-formats";
export const VIDEO_FRAME_INTERVAL_MS = 600;
export const VIDEO_FRAME_BUFFER = 4;
export const WATCH_CAPTURE_INTERVAL_MS = 250;
export const WATCH_SEND_GAP_MS = 500;

export type VideoSourceKind = "url" | "file";

export type VideoFrameShot = {
  dataUrl: string;
  timeSec: number;
};

export type VideoContextSnapshot = {
  loaded: boolean;
  playing: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  title: string;
  source: VideoSourceKind | null;
  frames: VideoFrameShot[];
  captureError?: string;
};

export function formatTimecode(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const mmss = `${hours > 0 ? String(minutes).padStart(2, "0") : minutes}:${String(secs).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

export function titleFromVideoUrl(url: string) {
  try {
    const parsed = new URL(url, typeof location === "undefined" ? "http://localhost" : location.href);
    const last = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? "");
    return last || parsed.hostname || "Video";
  } catch {
    return "Video";
  }
}

export function isPageLikeVideoUrl(raw: string) {
  try {
    const host = new URL(raw.trim()).hostname.replace(/^www\./, "").toLowerCase();
    return (
      host === "youtube.com" ||
      host === "youtu.be" ||
      host === "m.youtube.com" ||
      host.endsWith(".youtube.com") ||
      host === "vimeo.com"
    );
  } catch {
    return false;
  }
}

export function playableVideoSrc(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (
    trimmed.startsWith("blob:") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith(".")
  ) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return trimmed;
    if (typeof location !== "undefined" && parsed.origin === location.origin) return trimmed;
    return `/api/video/proxy?url=${encodeURIComponent(parsed.href)}`;
  } catch {
    return trimmed;
  }
}

export function nextWatchPlaybackSrc(raw: string, failedSrc: string) {
  const direct = directVideoHref(raw);
  const proxy = playableVideoSrc(raw);
  if (!failedSrc) return direct;
  if (direct && failedSrc === direct && proxy && proxy !== direct) return proxy;
  return "";
}

export class VideoFrameBuffer {
  private shots: VideoFrameShot[] = [];

  push(shot: VideoFrameShot) {
    const last = this.shots[this.shots.length - 1];
    if (last && Math.abs(last.timeSec - shot.timeSec) < 0.2 && last.dataUrl === shot.dataUrl) {
      return;
    }
    this.shots.push(shot);
    if (this.shots.length > VIDEO_FRAME_BUFFER) this.shots.shift();
  }

  list() {
    return this.shots.map((shot) => ({ ...shot }));
  }

  clear() {
    this.shots = [];
  }
}

export function captureVideoShot(video: HTMLVideoElement): VideoFrameShot | null {
  try {
    const dataUrl = captureJpegDataUrl(video);
    if (!dataUrl) return null;
    return { dataUrl, timeSec: Number.isFinite(video.currentTime) ? video.currentTime : 0 };
  } catch {
    return null;
  }
}

export type VideoSnapshotMeta = {
  title: string;
  source: VideoSourceKind | null;
  playing?: boolean;
  currentTime?: number;
  duration?: number;
};

export function snapshotFromFrames(
  buffer: VideoFrameBuffer,
  meta: VideoSnapshotMeta,
): VideoContextSnapshot {
  if (!meta.source) {
    return {
      loaded: false,
      playing: false,
      paused: true,
      currentTime: 0,
      duration: 0,
      title: "",
      source: null,
      frames: [],
    };
  }
  const frames = buffer.list();
  const last = frames[frames.length - 1];
  return {
    loaded: true,
    playing: Boolean(meta.playing),
    paused: !meta.playing,
    currentTime: meta.currentTime ?? last?.timeSec ?? 0,
    duration: meta.duration ?? 0,
    title: meta.title,
    source: meta.source,
    frames,
    captureError: frames.length ? undefined : "Could not capture a frame from this video.",
  };
}

export function snapshotFromShareStream(
  video: HTMLVideoElement | null,
  buffer: VideoFrameBuffer,
  title = "Shared tab",
): VideoContextSnapshot {
  if (video) {
    const live = captureVideoShot(video);
    if (live) buffer.push(live);
  }
  const frames = buffer.list();
  return {
    loaded: true,
    playing: Boolean(video && !video.paused && !video.ended),
    paused: Boolean(!video || video.paused || video.ended),
    currentTime: frames.at(-1)?.timeSec ?? 0,
    duration: 0,
    title,
    source: "url",
    frames,
    captureError: frames.length ? undefined : "Could not capture the shared tab.",
  };
}

export function snapshotFromVideo(
  video: HTMLVideoElement | null,
  buffer: VideoFrameBuffer,
  meta: VideoSnapshotMeta,
): VideoContextSnapshot {
  if (!meta.source) {
    return snapshotFromFrames(buffer, meta);
  }
  if (!video) return snapshotFromFrames(buffer, meta);

  const live = captureVideoShot(video);
  if (live) buffer.push(live);

  const frames = buffer.list();
  if (live && !frames.some((shot) => shot.timeSec === live.timeSec)) {
    frames.push(live);
  }

  return {
    loaded: true,
    playing: !video.paused && !video.ended,
    paused: video.paused,
    currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
    duration: Number.isFinite(video.duration) ? video.duration : 0,
    title: meta.title,
    source: meta.source,
    frames,
    captureError: frames.length ? undefined : "Could not capture a frame from this video.",
  };
}

export function startVideoFrameLoop(
  video: HTMLVideoElement,
  buffer: VideoFrameBuffer,
  onShot?: (shot: VideoFrameShot) => void,
) {
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    if (video.paused || video.ended || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    const shot = captureVideoShot(video);
    if (shot) {
      buffer.push(shot);
      onShot?.(shot);
    }
  };

  timer = setInterval(tick, VIDEO_FRAME_INTERVAL_MS);
  tick();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
