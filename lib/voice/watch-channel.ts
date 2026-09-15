import type { VideoSourceKind } from "@/lib/voice/video";

export const WATCH_CHANNEL_NAME = "lexi-watch";

/** Flip to true to show the watch tab button and media URL load bar again. */
export const WATCH_UI_ENABLED = false;

export type WatchChannelMessage =
  | { type: "hello" }
  | { type: "ready" }
  | {
      type: "start";
      title: string;
      source: VideoSourceKind;
      hasAudio: boolean;
    }
  | {
      type: "frame";
      dataUrl: string;
      timeSec: number;
      title: string;
      playing: boolean;
      duration: number;
    }
  | { type: "audio-state"; hasAudio: boolean }
  | { type: "stop" };

export function isWatchChannelMessage(value: unknown): value is WatchChannelMessage {
  if (!value || typeof value !== "object") return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === "hello" ||
    type === "ready" ||
    type === "start" ||
    type === "frame" ||
    type === "audio-state" ||
    type === "stop"
  );
}

export function openWatchChannel(onMessage: (message: WatchChannelMessage) => void) {
  if (typeof BroadcastChannel === "undefined") return null;
  const channel = new BroadcastChannel(WATCH_CHANNEL_NAME);
  channel.onmessage = (event) => {
    if (isWatchChannelMessage(event.data)) onMessage(event.data);
  };
  return channel;
}

export function watchTabHref(rawUrl = "") {
  const trimmed = rawUrl.trim();
  return trimmed ? `/watch?url=${encodeURIComponent(trimmed)}` : "/watch";
}

export function videoElementHasAudio(video: HTMLVideoElement) {
  const withTracks = video as HTMLVideoElement & {
    audioTracks?: { length: number };
    mozHasAudio?: boolean;
  };
  if (typeof withTracks.mozHasAudio === "boolean") return withTracks.mozHasAudio;
  if (withTracks.audioTracks) return withTracks.audioTracks.length > 0;
  return true;
}
