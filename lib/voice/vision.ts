export type VisionSource = "camera" | "screen" | "watch";

export type VisionFramePart = {
  source: VisionSource | "upload";
  dataUrl: string;
  timeSec?: number;
};

export type SendVisionFramesOptions = {
  respond?: boolean;
  prompt?: string;
};

/** Grok realtime has no video-track item — live camera/tab use high-cadence `input_image`. */
export const VISION_INTERVAL_MS = 200;
export const CAMERA_VISION_INTERVAL_MS = 250;
export const SCREEN_VISION_INTERVAL_MS = 200;
export const VISION_BATCH_SIZE = 4;
export const VISION_BATCH_GAP_MS = 600;
export const VISION_BATCH_FLUSH_MS = 800;
const MAX_EDGE = 640;
const JPEG_QUALITY = 0.6;

let captureCanvas: HTMLCanvasElement | null = null;
let captureCtx: CanvasRenderingContext2D | null = null;

export function canShareScreen() {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

export function preferWatchTab() {
  if (typeof navigator === "undefined") return false;
  if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) return true;
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

export type CameraFacing = "user" | "environment";

export function nextCameraFacing(current: CameraFacing): CameraFacing {
  return current === "user" ? "environment" : "user";
}

async function cameraDeviceIdForFacing(facing: CameraFacing) {
  if (!navigator.mediaDevices?.enumerateDevices) return null;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const videos = devices.filter((device) => device.kind === "videoinput");
  if (videos.length < 2) return null;
  const match = videos.find((device) => {
    const label = device.label.toLowerCase();
    return facing === "environment"
      ? /back|rear|environment|world/.test(label)
      : /front|user|face/.test(label);
  });
  if (match?.deviceId) return match.deviceId;
  return facing === "user" ? videos[0]?.deviceId ?? null : videos[videos.length - 1]?.deviceId ?? null;
}

export async function startCameraStream(facing: CameraFacing = "user") {
  const video: MediaTrackConstraints = {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 24, max: 30 },
  };
  const deviceId = await cameraDeviceIdForFacing(facing);
  const attempts: MediaStreamConstraints[] = deviceId
    ? [
        { audio: false, video: { ...video, deviceId: { exact: deviceId } } },
        { audio: false, video: { ...video, facingMode: { ideal: facing } } },
      ]
    : [
        { audio: false, video: { ...video, facingMode: { exact: facing } } },
        { audio: false, video: { ...video, facingMode: { ideal: facing } } },
        { audio: false, video: { ...video, facingMode: facing } },
      ];
  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not start the camera.");
}

export async function startScreenStream() {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: {
      frameRate: { ideal: 24, max: 30 },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      displaySurface: "browser",
    },
    preferCurrentTab: false,
    selfBrowserSurface: "include",
    surfaceSwitching: "include",
    systemAudio: "exclude",
    monitorTypeSurfaces: "include",
  } as DisplayMediaStreamOptions);
  const videoTrack = stream.getVideoTracks()[0];
  if (videoTrack && "contentHint" in videoTrack) {
    videoTrack.contentHint = "motion";
  }
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

export function sameVideoDevice(a: MediaStream, b: MediaStream) {
  const left = a.getVideoTracks()[0]?.getSettings().deviceId;
  const right = b.getVideoTracks()[0]?.getSettings().deviceId;
  return Boolean(left && right && left === right);
}

export const PHOTO_MAX_EDGE = 1152;
const PHOTO_JPEG_QUALITY = 0.7;

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

export class VisionFrameBatcher {
  private watch: VisionFramePart[] = [];
  private extras = new Map<Exclude<VisionFramePart["source"], "watch">, VisionFramePart>();
  private lastWatchAt = 0;
  private lastWatchUrl = "";
  private watchFlushedOnce = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushFn: ((parts: VisionFramePart[]) => void) | null = null;

  setFlush(fn: ((parts: VisionFramePart[]) => void) | null) {
    this.flushFn = fn;
  }

  push(part: VisionFramePart) {
    if (part.source !== "watch") {
      this.extras.set(part.source, part);
      if (this.watch.length) {
        this.schedule();
        return;
      }
      this.flushFn?.([part]);
      return;
    }

    const now = Date.now();
    if (part.dataUrl === this.lastWatchUrl) return;
    if (this.watch.length && now - this.lastWatchAt < VISION_BATCH_GAP_MS) return;
    this.lastWatchAt = now;
    this.lastWatchUrl = part.dataUrl;
    this.watch.push(part);
    if (this.watch.length > VISION_BATCH_SIZE) this.watch.shift();
    if (!this.watchFlushedOnce) {
      this.watchFlushedOnce = true;
      this.flush();
      return;
    }
    if (this.watch.length >= VISION_BATCH_SIZE) {
      this.flush();
      return;
    }
    this.schedule();
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const watch = this.watch.splice(0);
    const extras = [...this.extras.values()];
    if (!watch.length && !extras.length) return;
    this.flushFn?.([...watch, ...extras]);
  }

  clear(source?: VisionSource) {
    if (!source || source === "watch") {
      this.watch = [];
      this.lastWatchUrl = "";
      this.lastWatchAt = 0;
      this.watchFlushedOnce = false;
    }
    if (!source) this.extras.clear();
    else if (source !== "watch") this.extras.delete(source);
    if (!this.watch.length && !this.extras.size && this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  dispose() {
    this.clear();
    this.flushFn = null;
  }

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), VISION_BATCH_FLUSH_MS);
  }
}

function jpegFromVideoFrame(frame: VideoFrame) {
  const width = frame.displayWidth || frame.codedWidth;
  const height = frame.displayHeight || frame.codedHeight;
  return jpegDataUrlFromImage(frame, width, height, MAX_EDGE, JPEG_QUALITY);
}

type TrackProcessorCtor = new (init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<VideoFrame>;
};

function startTrackFramePump(
  track: MediaStreamTrack,
  onFrame: (dataUrl: string) => void,
  intervalMs: number,
) {
  const Ctor = (globalThis as unknown as { MediaStreamTrackProcessor?: TrackProcessorCtor })
    .MediaStreamTrackProcessor;
  if (!Ctor) return null;
  const processor = new Ctor({ track });
  const reader = processor.readable.getReader();
  let stopped = false;
  let last = 0;
  void (async () => {
    try {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const now = Date.now();
        if (now - last >= intervalMs) {
          try {
            const dataUrl = jpegFromVideoFrame(value);
            if (dataUrl) {
              last = now;
              onFrame(dataUrl);
            }
          } finally {
            value.close();
          }
        } else {
          value.close();
        }
      }
    } catch {
      // Track ended or the browser closed the processor.
    }
  })();
  return () => {
    stopped = true;
    void reader.cancel().catch(() => {});
  };
}

export function startVisionLoop(
  video: HTMLVideoElement,
  onFrame: (dataUrl: string) => void,
  intervalMs = VISION_INTERVAL_MS,
) {
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;
  let stopped = false;
  let lastUrl = "";
  let rvfcHandle = 0;
  const canRvfc = typeof video.requestVideoFrameCallback === "function";

  const emit = (dataUrl: string | null) => {
    if (!dataUrl || dataUrl === lastUrl) return;
    lastUrl = dataUrl;
    onFrame(dataUrl);
  };

  const tick = () => {
    if (stopped || busy || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (!video.videoWidth || !video.videoHeight) return;
    busy = true;
    try {
      emit(captureJpegDataUrl(video));
    } finally {
      busy = false;
    }
  };

  const onVideoFrame = () => {
    tick();
    if (!stopped && canRvfc) {
      rvfcHandle = video.requestVideoFrameCallback(onVideoFrame);
    }
  };

  void video.play().catch(() => {});
  if (canRvfc) rvfcHandle = video.requestVideoFrameCallback(onVideoFrame);
  timer = setInterval(tick, intervalMs);
  tick();
  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    if (canRvfc && rvfcHandle) {
      video.cancelVideoFrameCallback?.(rvfcHandle);
    }
  };
}

/** Live tab/screen capture: pull from the MediaStream track, not a hidden 1px sink. */
export function startLiveVisionCapture(
  video: HTMLVideoElement,
  onFrame: (dataUrl: string) => void,
  intervalMs = SCREEN_VISION_INTERVAL_MS,
) {
  const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
  const sourceTrack = stream?.getVideoTracks()[0];
  const processTrack = sourceTrack?.clone() ?? null;
  if (processTrack && "contentHint" in processTrack) {
    processTrack.contentHint = sourceTrack?.contentHint || "motion";
  }
  let lastUrl = "";
  const emit = (dataUrl: string) => {
    if (!dataUrl || dataUrl === lastUrl) return;
    lastUrl = dataUrl;
    onFrame(dataUrl);
  };
  const stopPump = processTrack ? startTrackFramePump(processTrack, emit, intervalMs) : null;
  const stopLoop = startVisionLoop(video, emit, intervalMs);
  void video.play().catch(() => {});
  return () => {
    stopPump?.();
    processTrack?.stop();
    stopLoop();
  };
}
