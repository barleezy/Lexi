"use client";

import { isWatchHlsUrl } from "@/lib/voice/watch-adult";
import { mpegtsMediaType, watchPlaybackKind } from "@/lib/voice/watch-formats";
import { attachHlsPlayer } from "@/lib/voice/watch-hls";
import { attachMpegtsPlayer, iosLacksMsePlayback } from "@/lib/voice/watch-mpegts";

export const HLS_ATTACH_ERROR =
  "Could not play that HLS stream. Paste another m3u8 or mp4 URL, or try again.";

export type WatchPlayerPlan =
  | { mode: "hls"; url: string }
  | { mode: "native"; url: string }
  | { mode: "mpegts"; url: string; mpegtsType: "flv" | "mpegts" }
  | { mode: "remux" };

export function planWatchPlayback(input: {
  mediaUrl: string;
  playable: string;
  kind?: string;
  fileName?: string;
  fileType?: string;
}): WatchPlayerPlan {
  const media = input.mediaUrl || input.playable;
  const url = input.playable || input.mediaUrl;
  if (input.kind === "hls" || isWatchHlsUrl(media) || isWatchHlsUrl(url)) {
    return { mode: "hls", url };
  }
  const file = { name: input.fileName || media, type: input.fileType || "" };
  const kind = watchPlaybackKind(file);
  if (kind === "mpegts" && !iosLacksMsePlayback()) {
    return { mode: "mpegts", url, mpegtsType: mpegtsMediaType(file) };
  }
  if (kind === "remux" || (kind === "mpegts" && iosLacksMsePlayback())) {
    return { mode: "remux" };
  }
  return { mode: "native", url };
}

export async function attachWatchPlayer(
  video: HTMLVideoElement,
  plan: WatchPlayerPlan,
  onError: () => void,
) {
  try {
    if (plan.mode === "hls") return await attachHlsPlayer(video, plan.url, onError);
    if (plan.mode === "mpegts") {
      return await attachMpegtsPlayer(video, plan.url, plan.mpegtsType, onError);
    }
    if (plan.mode === "native") {
      video.src = plan.url;
    }
    return { destroy() {} };
  } catch {
    onError();
    return { destroy() {} };
  }
}
