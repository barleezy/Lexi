import { jpegDataUrlFromImage, PHOTO_MAX_EDGE } from "@/lib/voice/vision";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_VIDEO_MAX_BYTES,
  ATTACHMENT_VIDEO_FIRST_LOOK_FRAMES,
  ATTACHMENT_VIDEO_MAX_FRAMES,
  formatFileSize,
  isAttachmentVideoFile,
  uploadVideoFirstLookCount,
  uploadVideoSampleTimes,
} from "@/lib/voice/upload-frames";

export {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_VIDEO_EVERY_SEC,
  ATTACHMENT_VIDEO_MAX_BYTES,
  ATTACHMENT_VIDEO_MAX_FRAMES,
  ATTACHMENT_VIDEO_FIRST_LOOK_FRAMES,
  ATTACHMENT_VIDEO_MIN_FRAMES,
  formatFileSize,
  isAttachmentVideoFile,
  uploadVideoFirstLookCount,
  uploadVideoSampleTimes,
} from "@/lib/voice/upload-frames";

export const ATTACHMENT_TEXT_MAX_CHARS = 24_000;
const UPLOAD_FRAME_MAX_EDGE = 800;
const UPLOAD_FRAME_QUALITY = 0.62;

export const ATTACHMENT_ACCEPT =
  "image/*,video/*,video/mp4,video/webm,video/quicktime,video/x-m4v,.mp4,.webm,.mov,.m4v,.ogv,.mkv,.pdf,.txt,.md,.json";

export type UploadedVideoFrame = {
  dataUrl: string;
  timeSec: number;
};

export type ReadyAttachment =
  | { kind: "image"; name: string; dataUrl: string }
  | { kind: "text"; name: string; text: string }
  | {
      kind: "video";
      name: string;
      frames: UploadedVideoFrame[];
      durationSec: number;
      hasAudio: boolean;
      analysis?: "first-look" | "refine";
    };

export type AttachmentProgress = {
  attachment: ReadyAttachment;
  done: boolean;
};

export type ProcessAttachmentResult =
  | { ok: true; attachment: ReadyAttachment }
  | { ok: false; message: string };

const TEXT_EXT = /\.(txt|md|markdown|json|csv)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|heif|svg)$/i;

function isImageFile(file: File) {
  return file.type.startsWith("image/") || IMAGE_EXT.test(file.name);
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isTextFile(file: File) {
  return (
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    TEXT_EXT.test(file.name)
  );
}

function truncateText(text: string) {
  const trimmed = text.replace(/^\uFEFF/, "");
  if (trimmed.length <= ATTACHMENT_TEXT_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, ATTACHMENT_TEXT_MAX_CHARS)}\n\n[truncated]`;
}

function fileNote(file: File, extra = "") {
  const type = file.type || "unknown type";
  const suffix = extra ? ` ${extra}` : "";
  return `FILE ${file.name} (${type}, ${formatFileSize(file.size)}): attached.${suffix}`;
}

function extractPdfTextIfTrivial(buffer: ArrayBuffer) {
  const raw = new TextDecoder("latin1").decode(buffer);
  if (!raw.includes("%PDF")) return null;
  const chunks: string[] = [];
  const pattern = /\((?:\\.|[^\\)])+\)\s*Tj/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    const close = match[0].lastIndexOf(")");
    const inner = match[0].slice(1, close);
    const text = inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, "\t")
      .replace(/\\(.)/g, "$1")
      .trim();
    if (text && /[A-Za-z]{3,}/.test(text)) chunks.push(text);
    if (chunks.join(" ").length >= ATTACHMENT_TEXT_MAX_CHARS) break;
  }
  const joined = chunks.join(" ").replace(/\s+/g, " ").trim();
  return joined.length >= 40 ? truncateText(joined) : null;
}

async function jpegFromFile(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const dataUrl = jpegDataUrlFromImage(bitmap, bitmap.width, bitmap.height);
      if (dataUrl) return dataUrl;
    } finally {
      bitmap.close();
    }
  } catch {
    // Fall through to HTMLImageElement for formats createImageBitmap rejects.
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode image."));
      el.src = objectUrl;
    });
    const dataUrl = jpegDataUrlFromImage(
      image,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      PHOTO_MAX_EDGE,
    );
    if (!dataUrl) throw new Error("Could not encode photo.");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function waitForVideoEvent(video: HTMLVideoElement, event: string, timeoutMs = 10_000) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}.`));
    }, timeoutMs);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error("Could not decode video."));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, onOk);
      video.removeEventListener("error", onErr);
    };
    video.addEventListener(event, onOk);
    video.addEventListener("error", onErr);
  });
}

async function seekVideo(video: HTMLVideoElement, timeSec: number) {
  if (
    Math.abs(video.currentTime - timeSec) < 0.02 &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
  ) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Seek timed out."));
    }, 6000);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Could not seek video."));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    try {
      video.currentTime = timeSec;
    } catch {
      cleanup();
      reject(new Error("Could not seek video."));
    }
  });
}

function captureUploadFrame(video: HTMLVideoElement): UploadedVideoFrame | null {
  const dataUrl = jpegDataUrlFromImage(
    video,
    video.videoWidth,
    video.videoHeight,
    UPLOAD_FRAME_MAX_EDGE,
    UPLOAD_FRAME_QUALITY,
  );
  if (!dataUrl) return null;
  return {
    dataUrl,
    timeSec: Number.isFinite(video.currentTime) ? video.currentTime : 0,
  };
}

function videoElementHasAudio(video: HTMLVideoElement) {
  const extended = video as HTMLVideoElement & {
    mozHasAudio?: boolean;
    webkitAudioDecodedByteCount?: number;
    audioTracks?: { length: number };
  };
  if (extended.audioTracks && extended.audioTracks.length > 0) return true;
  if (extended.mozHasAudio === true) return true;
  if ((extended.webkitAudioDecodedByteCount ?? 0) > 0) return true;
  return false;
}

async function peekVideoAudioViaWebAudio(file: File) {
  if (typeof AudioContext === "undefined" || file.size > 12 * 1024 * 1024) return false;
  const ctx = new AudioContext();
  try {
    // Decode only — never connect to destination or the mic capture graph.
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    return decoded.numberOfChannels > 0 && decoded.duration > 0;
  } catch {
    return false;
  } finally {
    await ctx.close().catch(() => {});
  }
}

function attachHiddenVideo() {
  const video = document.createElement("video");
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.controls = false;
  video.tabIndex = -1;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("aria-hidden", "true");
  video.style.cssText =
    "position:fixed;left:-9999px;top:0;width:16px;height:16px;opacity:0;pointer-events:none;";
  document.body.appendChild(video);
  return video;
}

async function sampleUploadedVideo(
  file: File,
  onFirstLook?: (partial: {
    frames: UploadedVideoFrame[];
    durationSec: number;
    hasAudio: boolean;
  }) => void,
) {
  const objectUrl = URL.createObjectURL(file);
  const video = attachHiddenVideo();
  video.src = objectUrl;
  try {
    await waitForVideoEvent(video, "loadedmetadata");
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      await waitForVideoEvent(video, "loadeddata").catch(() => {});
    }

    const frames: UploadedVideoFrame[] = [];
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const sampleTimes = duration > 0 ? uploadVideoSampleTimes(duration) : [];
    const firstLookAt = uploadVideoFirstLookCount(
      sampleTimes.length || ATTACHMENT_VIDEO_FIRST_LOOK_FRAMES,
    );
    let firstLookSent = false;
    const emitFirstLook = () => {
      if (firstLookSent || !frames.length || frames.length < firstLookAt) return;
      firstLookSent = true;
      onFirstLook?.({
        frames: frames.slice(0, firstLookAt),
        durationSec: duration || frames[frames.length - 1]?.timeSec || 0,
        hasAudio: videoElementHasAudio(video),
      });
    };

    if (duration > 0) {
      for (const time of sampleTimes) {
        try {
          await seekVideo(video, time);
          const shot = captureUploadFrame(video);
          if (shot) frames.push(shot);
          emitFirstLook();
        } catch {
          // Skip a failed seek and keep the rest of the clip.
        }
      }
    }

    if (!frames.length) {
      try {
        await video.play();
        await waitForVideoEvent(video, "playing", 4000).catch(() => {});
        const deadline = Date.now() + 8000;
        while (frames.length < ATTACHMENT_VIDEO_MAX_FRAMES && Date.now() < deadline) {
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            const shot = captureUploadFrame(video);
            if (
              shot &&
              !frames.some((frame) => Math.abs(frame.timeSec - shot.timeSec) < 0.15)
            ) {
              frames.push(shot);
              emitFirstLook();
            }
          }
          if (video.ended) break;
          await new Promise((resolve) => window.setTimeout(resolve, 400));
        }
      } catch {
        // Headless or codec-missing browsers fail here; caller surfaces a clear error.
      } finally {
        video.pause();
      }
    }

    if (!frames.length) {
      throw new Error(`Could not read video ${file.name}. The browser could not decode it.`);
    }

    if (!firstLookSent) emitFirstLook();
    if (!firstLookSent && frames.length) {
      firstLookSent = true;
      onFirstLook?.({
        frames: frames.slice(0, firstLookAt),
        durationSec: duration || frames[frames.length - 1]?.timeSec || 0,
        hasAudio: videoElementHasAudio(video),
      });
    }

    let hasAudio = videoElementHasAudio(video);
    if (!hasAudio) hasAudio = await peekVideoAudioViaWebAudio(file);

    return {
      frames,
      durationSec: duration || frames[frames.length - 1]?.timeSec || 0,
      hasAudio,
    };
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(objectUrl);
  }
}

export async function processAttachment(
  file: File,
  onProgress?: (update: AttachmentProgress) => void,
): Promise<ProcessAttachmentResult> {
  if (isAttachmentVideoFile(file)) {
    if (file.size > ATTACHMENT_VIDEO_MAX_BYTES) {
      return {
        ok: false,
        message: `${file.name} is ${formatFileSize(file.size)}. Video max is 40 MB.`,
      };
    }
    try {
      const sampled = await sampleUploadedVideo(file, (partial) => {
        onProgress?.({
          done: false,
          attachment: {
            kind: "video",
            name: file.name,
            frames: partial.frames,
            durationSec: partial.durationSec,
            hasAudio: partial.hasAudio,
            analysis: "first-look",
          },
        });
      });
      return {
        ok: true,
        attachment: {
          kind: "video",
          name: file.name,
          frames: sampled.frames,
          durationSec: sampled.durationSec,
          hasAudio: sampled.hasAudio,
        },
      };
    } catch (caught) {
      return {
        ok: false,
        message:
          caught instanceof Error
            ? caught.message
            : `Could not read video ${file.name}.`,
      };
    }
  }

  if (file.size > ATTACHMENT_MAX_BYTES) {
    return {
      ok: false,
      message: `${file.name} is ${formatFileSize(file.size)}. Max size is 4 MB.`,
    };
  }

  if (isImageFile(file)) {
    try {
      const dataUrl = await jpegFromFile(file);
      return { ok: true, attachment: { kind: "image", name: file.name, dataUrl } };
    } catch {
      return { ok: false, message: `Could not read photo ${file.name}.` };
    }
  }

  if (isTextFile(file)) {
    const text = truncateText(await file.text());
    return {
      ok: true,
      attachment: { kind: "text", name: file.name, text: `FILE ${file.name}:\n${text}` },
    };
  }

  if (isPdfFile(file)) {
    const buffer = await file.arrayBuffer();
    const extracted = extractPdfTextIfTrivial(buffer);
    if (extracted) {
      return {
        ok: true,
        attachment: {
          kind: "text",
          name: file.name,
          text: `FILE ${file.name} (extracted text):\n${extracted}`,
        },
      };
    }
    return {
      ok: true,
      attachment: {
        kind: "text",
        name: file.name,
        text: fileNote(file, "Binary contents were not sent."),
      },
    };
  }

  return {
    ok: true,
    attachment: {
      kind: "text",
      name: file.name,
      text: fileNote(file, "Binary contents were not sent."),
    },
  };
}
