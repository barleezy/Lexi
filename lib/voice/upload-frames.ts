export const ATTACHMENT_MAX_BYTES = 4 * 1024 * 1024;
export const ATTACHMENT_VIDEO_MAX_BYTES = 40 * 1024 * 1024;
export const ATTACHMENT_VIDEO_MIN_FRAMES = 6;
export const ATTACHMENT_VIDEO_MAX_FRAMES = 12;
export const ATTACHMENT_VIDEO_FIRST_LOOK_FRAMES = 3;
export const ATTACHMENT_VIDEO_EVERY_SEC = 2;

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv|mkv|avi)$/i;

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function isAttachmentVideoFile(file: { name: string; type: string }) {
  return file.type.startsWith("video/") || VIDEO_EXT.test(file.name);
}

export function uploadVideoSampleTimes(
  durationSec: number,
  everySec = ATTACHMENT_VIDEO_EVERY_SEC,
  minFrames = ATTACHMENT_VIDEO_MIN_FRAMES,
  maxFrames = ATTACHMENT_VIDEO_MAX_FRAMES,
) {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [0];
  const interval = Math.max(0.25, everySec);
  const byInterval = Math.floor(durationSec / interval) + 1;
  const shortCount = Math.max(1, Math.round(durationSec) + 1);
  const count = Math.min(
    maxFrames,
    Math.max(durationSec >= 6 ? minFrames : shortCount, byInterval),
  );
  const start = durationSec * (durationSec > 1 ? 0.05 : 0);
  const end = Math.max(start, durationSec * (durationSec > 1 ? 0.95 : 1));
  if (count <= 1) return [Math.min(start, Math.max(0, durationSec - 0.04))];
  return Array.from({ length: count }, (_, index) => {
    const time = start + ((end - start) * index) / (count - 1);
    return Math.min(Math.max(0, time), Math.max(0, durationSec - 0.04));
  });
}

export function uploadVideoFirstLookCount(
  sampleCount: number,
  firstLook = ATTACHMENT_VIDEO_FIRST_LOOK_FRAMES,
) {
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) return 1;
  return Math.max(1, Math.min(firstLook, Math.floor(sampleCount)));
}
