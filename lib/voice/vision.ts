export type VisionSource = "camera" | "screen";

export const VISION_INTERVAL_MS = 1000;
const MAX_EDGE = 640;
const JPEG_QUALITY = 0.6;

let captureCanvas: HTMLCanvasElement | null = null;
let captureCtx: CanvasRenderingContext2D | null = null;

export function canShareScreen() {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export async function startCameraStream() {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
    },
  });
}

export async function startScreenStream() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: { frameRate: { ideal: 1, max: 5 } },
  });
  // Display / tab audio must never reach the realtime user-speech buffer.
  for (const track of stream.getAudioTracks()) {
    track.stop();
    stream.removeTrack(track);
  }
  return stream;
}

export function stopMediaStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

export const PHOTO_MAX_EDGE = 1280;
const PHOTO_JPEG_QUALITY = 0.72;

export function jpegDataUrlFromImage(
  image: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge = PHOTO_MAX_EDGE,
  quality = PHOTO_JPEG_QUALITY,
) {
  if (!sourceWidth || !sourceHeight) return null;
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  if (!captureCanvas) captureCanvas = document.createElement("canvas");
  if (!captureCtx) {
    captureCtx = captureCanvas.getContext("2d", { alpha: false });
  }
  if (!captureCtx) return null;
  captureCanvas.width = width;
  captureCanvas.height = height;
  captureCtx.drawImage(image, 0, 0, width, height);
  return captureCanvas.toDataURL("image/jpeg", quality);
}

export function captureJpegDataUrl(video: HTMLVideoElement) {
  return jpegDataUrlFromImage(
    video,
    video.videoWidth,
    video.videoHeight,
    MAX_EDGE,
    JPEG_QUALITY,
  );
}

export function startVisionLoop(
  video: HTMLVideoElement,
  onFrame: (dataUrl: string) => void,
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  const tick = () => {
    if (busy || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    busy = true;
    try {
      const dataUrl = captureJpegDataUrl(video);
      if (dataUrl) onFrame(dataUrl);
    } finally {
      busy = false;
    }
  };

  timer = setInterval(tick, VISION_INTERVAL_MS);
  tick();
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}
