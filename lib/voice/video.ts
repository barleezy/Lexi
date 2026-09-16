import {
  captureDetailJpegDataUrl,
  captureJpegDataUrl,
  LIVE_ANALYZE_INTERVAL_MS,
  LIVE_LOOK_INTERVAL_MS,
} from "@/lib/voice/vision";
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
  label?: string;
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
  /** Live 30fps camera/screen already in the voice session — do not grab stills. */
  liveStream?: "camera" | "screen";
};

export function snapshotFromLiveStream(
  source: "camera" | "screen",
  title: string,
): VideoContextSnapshot {
  return {
    loaded: true,
    playing: true,
    paused: false,
    currentTime: 0,
    duration: 0,
    title,
    source: "url",
    frames: [],
    liveStream: source,
  };
}

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

export function captureDetailVideoShot(video: HTMLVideoElement): VideoFrameShot | null {
  try {
    const dataUrl = captureDetailJpegDataUrl(video);
    if (!dataUrl) return null;
    const timeSec = Number.isFinite(video.currentTime) && video.currentTime > 0
      ? video.currentTime
      : Date.now() / 1000;
    return { dataUrl, timeSec };
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
  const frames: VideoFrameShot[] = [];
  if (video) {
    const detail = captureDetailVideoShot(video);
    if (detail) {
      detail.label = title;
      buffer.push(detail);
      frames.push(detail);
    }
  }
  if (!frames.length) {
    const last = buffer.list().at(-1);
    if (last) frames.push({ ...last, label: last.label || title });
  }
  return {
    loaded: true,
    playing: Boolean(video && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA),
    paused: Boolean(!video || video.paused || video.ended),
    currentTime: frames.at(-1)?.timeSec ?? 0,
    duration: 0,
    title,
    source: "url",
    frames,
    liveStream: title.toLowerCase().includes("camera") ? "camera" : "screen",
    captureError: frames.length ? undefined : `Could not capture ${title.toLowerCase()}.`,
  };
}

export function startLiveDecipher(
  video: HTMLVideoElement,
  onLook: (shot: VideoFrameShot) => void,
  onAnalyze: (shot: VideoFrameShot) => void,
) {
  let lastLook = 0;
  let lastAnalyze = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
    const shot = captureDetailVideoShot(video);
    if (!shot) return;
    const now = Date.now();
    if (now - lastLook >= LIVE_LOOK_INTERVAL_MS) {
      lastLook = now;
      onLook(shot);
    }
    if (now - lastAnalyze >= LIVE_ANALYZE_INTERVAL_MS) {
      lastAnalyze = now;
      onAnalyze(shot);
    }
  };
  void video.play().catch(() => {});
  const timer = setInterval(tick, 200);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

export function mergeVideoSnapshots(parts: VideoContextSnapshot[]): VideoContextSnapshot {
  const live = parts.filter((part) => part.loaded);
  if (!live.length) {
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
  const frames = live.flatMap((part) => part.frames).slice(0, 4);
  const titles = [...new Set(live.map((part) => part.title).filter(Boolean))];
  return {
    loaded: true,
    playing: live.some((part) => part.playing),
    paused: live.every((part) => part.paused),
    currentTime: frames.at(-1)?.timeSec ?? 0,
    duration: Math.max(0, ...live.map((part) => part.duration)),
    title: titles.join(" + "),
    source: live.find((part) => part.source)?.source ?? "url",
    frames,
    liveStream: live.length === 1 ? live[0]?.liveStream : undefined,
    captureError: frames.length ? undefined : live.find((part) => part.captureError)?.captureError,
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

  const live = captureDetailVideoShot(video) ?? captureVideoShot(video);
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
