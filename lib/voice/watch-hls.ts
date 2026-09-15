"use client";

import { iosLacksMsePlayback } from "@/lib/voice/watch-mpegts";

export function nativeHlsPlayback() {
  if (typeof document === "undefined") return false;
  try {
    const video = document.createElement("video");
    return Boolean(video.canPlayType("application/vnd.apple.mpegurl"));
  } catch {
    return false;
  }
}

export function iosHlsOnly() {
  return iosLacksMsePlayback() && nativeHlsPlayback();
}

function attachNativeHls(video: HTMLVideoElement, url: string, onError: () => void) {
  const fail = () => onError();
  video.addEventListener("error", fail);
  video.src = url;
  return {
    destroy() {
      video.removeEventListener("error", fail);
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        // Element may already be gone.
      }
    },
  };
}

export async function attachHlsPlayer(video: HTMLVideoElement, url: string, onError: () => void) {
  try {
    if (nativeHlsPlayback()) {
      return attachNativeHls(video, url, onError);
    }
    const { default: Hls } = await import("hls.js");
    if (!Hls.isSupported()) {
      if (nativeHlsPlayback()) return attachNativeHls(video, url, onError);
      onError();
      return { destroy() {} };
    }
    const player = new Hls({ enableWorker: false, lowLatencyMode: false });
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
  } catch {
    onError();
    return { destroy() {} };
  }
}
