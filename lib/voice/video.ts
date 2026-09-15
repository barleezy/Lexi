import { captureJpegDataUrl } from "@/lib/voice/vision";

export const VIDEO_ACCEPT = "video/mp4,video/webm,.mp4,.webm";
export const VIDEO_FRAME_INTERVAL_MS = 1000;
export const VIDEO_FRAME_BUFFER = 3;

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

const VIDEO_EXT = /\.(mp4|webm)$/i;

export function isVideoFile(file: File) {
  return file.type === "video/mp4" || file.type === "video/webm" || VIDEO_EXT.test(file.name);
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

export function snapshotFromVideo(
  video: HTMLVideoElement | null,
  buffer: VideoFrameBuffer,
  meta: { title: string; source: VideoSourceKind | null },
): VideoContextSnapshot {
  if (!video || !meta.source) {
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
) {
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = () => {
    if (video.paused || video.ended || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      return;
    }
    const shot = captureVideoShot(video);
    if (shot) buffer.push(shot);
  };

  timer = setInterval(tick, VIDEO_FRAME_INTERVAL_MS);
  tick();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
