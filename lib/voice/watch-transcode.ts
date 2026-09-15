"use client";

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import { WATCH_VIDEO_MAX_BYTES, watchInputFileName, watchSizeError } from "@/lib/voice/watch-formats";

const CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";

let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

async function getFfmpeg(onStatus?: (message: string) => void) {
  if (ffmpeg?.loaded) return ffmpeg;
  if (!loading) {
    loading = (async () => {
      onStatus?.("Loading converter…");
      const instance = new FFmpeg();
      await instance.load({
        coreURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
      });
      ffmpeg = instance;
      return instance;
    })();
  }
  try {
    return await loading;
  } catch (error) {
    loading = null;
    throw error;
  }
}

async function readMp4(ffmpeg: FFmpeg) {
  const data = await ffmpeg.readFile("out.mp4");
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(0);
  if (bytes.byteLength < 32) return null;
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "video/mp4" });
}

export async function fetchWatchBlob(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load the video.");
  const length = Number(response.headers.get("content-length") || 0);
  const lengthError = watchSizeError(length);
  if (lengthError) throw new Error(lengthError);
  const blob = await response.blob();
  const sizeError = watchSizeError(blob.size);
  if (sizeError) throw new Error(sizeError);
  return blob;
}

export async function remuxWatchVideo(
  source: File | Blob | string,
  nameOrUrl: string,
  onStatus?: (message: string) => void,
  forceTranscode = false,
) {
  if (typeof source !== "string" && source.size > WATCH_VIDEO_MAX_BYTES) {
    throw new Error(watchSizeError(source.size) ?? "That video is too large.");
  }
  const ff = await getFfmpeg(onStatus);
  const input = watchInputFileName(nameOrUrl);
  onStatus?.(forceTranscode ? "Converting video…" : "Preparing video…");
  await ff.writeFile(input, await fetchFile(source));
  try {
    if (!forceTranscode) {
      const copied = await ff.exec(["-i", input, "-c", "copy", "-movflags", "+faststart", "out.mp4"]);
      if (copied === 0) {
        const blob = await readMp4(ff);
        if (blob) return { blob, copied: true as const };
      }
      await ff.deleteFile("out.mp4").catch(() => {});
    }
    onStatus?.("Converting video… this can take a minute.");
    const transcoded = await ff.exec(["-i", input, "-preset", "ultrafast", "-movflags", "+faststart", "out.mp4"]);
    if (transcoded !== 0) {
      throw new Error("Could not convert this video. The codecs may be unsupported.");
    }
    const blob = await readMp4(ff);
    if (!blob) throw new Error("Could not convert this video. The codecs may be unsupported.");
    return { blob, copied: false as const };
  } finally {
    await ff.deleteFile(input).catch(() => {});
    await ff.deleteFile("out.mp4").catch(() => {});
  }
}
