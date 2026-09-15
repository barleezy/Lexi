"use client";

import { iosLacksMsePlayback } from "@/lib/voice/watch-mpegts";

export function nativeHlsPlayback() {
  if (typeof document === "undefined") return false;
  const video = document.createElement("video");
  return Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
}

export function iosHlsOnly() {
  return iosLacksMsePlayback() && nativeHlsPlayback();
}

export async function attachHlsPlayer(video: HTMLVideoElement, url: string, onError: () => void) {
  if (nativeHlsPlayback() && iosLacksMsePlayback()) {
    video.src = url;
    return { destroy() {} };
  }
  const { default: Hls } = await import("hls.js");
  if (!Hls.isSupported()) {
    if (nativeHlsPlayback()) {
      video.src = url;
      return { destroy() {} };
    }
    onError();
    return { destroy() {} };
  }
  const player = new Hls({ enableWorker: false });
  let errored = false;
  const fail = () => {
    if (errored) return;
    errored = true;
    onError();
  };
  player.on(Hls.Events.ERROR, (_event, data) => {
    if (data?.fatal) fail();
  });
  player.loadSource(url);
  player.attachMedia(video);
  return {
    destroy() {
      try {
        player.destroy();
      } catch {
        // Already torn down after an error or remount.
      }
    },
  };
}
