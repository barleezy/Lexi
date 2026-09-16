"use client";

export function iosLacksMsePlayback() {
  if (typeof navigator === "undefined") return true;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export async function attachMpegtsPlayer(
  video: HTMLVideoElement,
  url: string,
  type: "flv" | "mpegts",
  onError: () => void,
) {
  const mpegts = (await import("mpegts.js")).default;
  if (!mpegts.isSupported()) {
    onError();
    return { destroy() {} };
  }
  const player = mpegts.createPlayer(
    { type, isLive: false, url },
    { enableWorker: false, stashInitialSize: 128 * 1024 },
  );
  let errored = false;
  const fail = () => {
    if (errored) return;
    errored = true;
    onError();
  };
  player.on(mpegts.Events.ERROR, fail);
  player.attachMediaElement(video);
  player.load();
  return {
    destroy() {
      try {
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
      } catch {
        // Already torn down after an error or remount.
      }
    },
  };
}
