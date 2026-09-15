"use client";

import Image from "next/image";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  VoiceSession,
  type TranscriptRow,
  type VoicePhase,
} from "@/lib/voice/session";
import {
  readVoiceSessionStore,
  writeVoiceSessionStore,
} from "@/lib/voice/persist";
import { DEFAULT_USER_ID } from "@/lib/memory/user";
import {
  ATTACHMENT_ACCEPT,
  processAttachment,
  type ReadyAttachment,
} from "@/lib/voice/attachments";
import {
  captureVideoShot,
  isVideoFile,
  playableVideoSrc,
  snapshotFromVideo,
  startVideoFrameLoop,
  titleFromVideoUrl,
  VIDEO_ACCEPT,
  VideoFrameBuffer,
  type VideoSourceKind,
} from "@/lib/voice/video";
import {
  canShareScreen,
  startCameraStream,
  startScreenStream,
  startVisionLoop,
  stopMediaStream,
  type VisionSource,
} from "@/lib/voice/vision";

const HINTS: Record<VoicePhase, string> = {
  idle: "Talk to Lexi",
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

function StrokedWaveformIcon() {
  return (
    <svg
      viewBox="0 0 256 256"
      className="h-4 w-4"
      fill="none"
      aria-hidden
    >
      <path
        d="M48 96v64M88 32v192M128 64v128M168 96v64M208 80v96"
        stroke="currentColor"
        strokeWidth="24"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M4 8.5h3l1.4-2.2h7.2L17 8.5h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="14" r="3.1" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function ScreenShareIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <rect
        x="3"
        y="4"
        width="18"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 20h8M12 16v4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FilmIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M8 5v14M16 5v14M3 9h5M3 15h5M16 9h5M16 15h5"
        stroke="currentColor"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" aria-hidden>
      <path
        d="M21.44 11.05l-8.49 8.49a5.25 5.25 0 0 1-7.42-7.42l8.48-8.49a3.5 3.5 0 0 1 4.95 4.95l-8.48 8.49a1.75 1.75 0 0 1-2.48-2.48l7.78-7.78"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type AttachmentChip = {
  id: string;
  name: string;
  kind: "image" | "file";
  previewUrl?: string;
  sent: boolean;
  payload: ReadyAttachment;
};

type VisionSlot = {
  stream: MediaStream | null;
  stopLoop: (() => void) | null;
};

function emptyVisionSlot(): VisionSlot {
  return { stream: null, stopLoop: null };
}

function LiveWaveform({ phase }: { phase: VoicePhase }) {
  const tempo =
    phase === "speaking" ? "0.28s" : phase === "listening" ? "0.9s" : "1.4s";
  const dimmed = phase === "connecting" || phase === "thinking";

  return (
    <span
      className="inline-flex h-4 items-end gap-0.5"
      style={{ opacity: dimmed ? 0.8 : 1 }}
      aria-hidden
    >
      {[0, 1, 2, 3].map((index) => (
        <span
          key={index}
          className="w-[3px] origin-bottom rounded-full bg-current motion-reduce:animate-none"
          style={{
            height: 16,
            animation: `lexi-wave ${tempo} ease-in-out ${index * 0.12}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

function ComposerButton({
  live,
  hasText,
  phase,
}: {
  live: boolean;
  hasText: boolean;
  phase: VoicePhase;
}) {
  if (hasText) return <SendArrowIcon />;
  if (live) return <LiveWaveform phase={phase} />;
  return <StrokedWaveformIcon />;
}

export function VoiceHome() {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<TranscriptRow[]>([]);
  const [caption, setCaption] = useState("");
  const [streamTick, setStreamTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [visionHint, setVisionHint] = useState<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const cameraSlot = useRef<VisionSlot>(emptyVisionSlot());
  const screenSlot = useRef<VisionSlot>(emptyVisionSlot());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const watchVideoRef = useRef<HTMLVideoElement>(null);
  const videoObjectUrl = useRef<string | null>(null);
  const videoFrames = useRef(new VideoFrameBuffer());
  const stopVideoLoop = useRef<(() => void) | null>(null);
  const videoMeta = useRef<{ title: string; source: VideoSourceKind | null }>({
    title: "",
    source: null,
  });
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [videoDraft, setVideoDraft] = useState("");
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoHint, setVideoHint] = useState<string | null>(null);

  function commitRows(nextRows: TranscriptRow[]) {
    const snapshot = nextRows.map((row) => ({ ...row }));
    const live = [...snapshot].reverse().find((row) => row.text.trim())?.text ?? "";
    setRows(snapshot);
    setCaption(live);
    setStreamTick((tick) => tick + 1);
    writeVoiceSessionStore({ caption: live, rows: snapshot });
  }

  useEffect(() => {
    const persisted = readVoiceSessionStore();
    if (persisted.sessionId) setSessionId(persisted.sessionId);
    if (persisted.rows.length || persisted.caption) {
      setRows(persisted.rows);
      setCaption(persisted.caption);
    }
    setCanShare(canShareScreen());
    return () => {
      cameraSlot.current.stopLoop?.();
      screenSlot.current.stopLoop?.();
      stopMediaStream(cameraSlot.current.stream);
      stopMediaStream(screenSlot.current.stream);
      cameraSlot.current = emptyVisionSlot();
      screenSlot.current = emptyVisionSlot();
      stopVideoLoop.current?.();
      if (videoObjectUrl.current) URL.revokeObjectURL(videoObjectUrl.current);
      sessionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!videoSrc) return;
    const video = watchVideoRef.current;
    if (!video) return;
    videoFrames.current.clear();
    stopVideoLoop.current?.();
    stopVideoLoop.current = startVideoFrameLoop(video, videoFrames.current);
    return () => {
      stopVideoLoop.current?.();
      stopVideoLoop.current = null;
    };
  }, [videoSrc]);

  useEffect(() => {
    if (!cameraOn) return;
    const video = cameraVideoRef.current;
    const stream = cameraSlot.current.stream;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    cameraSlot.current.stopLoop?.();
    cameraSlot.current.stopLoop = startVisionLoop(video, (dataUrl) => {
      sessionRef.current?.sendVisionFrame("camera", dataUrl);
    });
    return () => {
      cameraSlot.current.stopLoop?.();
      cameraSlot.current.stopLoop = null;
      video.srcObject = null;
    };
  }, [cameraOn]);

  useEffect(() => {
    if (!screenOn) return;
    const video = screenVideoRef.current;
    const stream = screenSlot.current.stream;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    screenSlot.current.stopLoop?.();
    screenSlot.current.stopLoop = startVisionLoop(video, (dataUrl) => {
      sessionRef.current?.sendVisionFrame("screen", dataUrl);
    });
    return () => {
      screenSlot.current.stopLoop?.();
      screenSlot.current.stopLoop = null;
      video.srcObject = null;
    };
  }, [screenOn]);

  function releaseVision(source?: VisionSource, notify = true) {
    if (!source || source === "camera") {
      const wasOn = Boolean(cameraSlot.current.stream);
      cameraSlot.current.stopLoop?.();
      stopMediaStream(cameraSlot.current.stream);
      cameraSlot.current = emptyVisionSlot();
      setCameraOn(false);
      if (wasOn && notify) sessionRef.current?.notifyVision("camera", false);
    }
    if (!source || source === "screen") {
      const wasOn = Boolean(screenSlot.current.stream);
      screenSlot.current.stopLoop?.();
      stopMediaStream(screenSlot.current.stream);
      screenSlot.current = emptyVisionSlot();
      setScreenOn(false);
      if (wasOn && notify) sessionRef.current?.notifyVision("screen", false);
    }
  }

  async function startVision(source: VisionSource) {
    setVisionHint(null);
    try {
      const stream = source === "camera" ? await startCameraStream() : await startScreenStream();
      const slot = source === "camera" ? cameraSlot : screenSlot;
      slot.current.stream = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        releaseVision(source);
      });
      if (source === "camera") setCameraOn(true);
      else setScreenOn(true);
      sessionRef.current?.notifyVision(source, true);
    } catch (caught) {
      releaseVision(source, false);
      const message =
        caught instanceof Error && caught.name === "NotAllowedError"
          ? source === "camera"
            ? "Camera permission was denied."
            : "Screen share was cancelled or denied."
          : caught instanceof Error
            ? caught.message
            : source === "camera"
              ? "Could not start the camera."
              : "Could not share the screen.";
      setVisionHint(message);
    }
  }

  function toggleVision(source: VisionSource) {
    const slot = source === "camera" ? cameraSlot : screenSlot;
    if (slot.current.stream) {
      releaseVision(source);
      return;
    }
    void startVision(source);
  }

  function sendReadyAttachments(items: ReadyAttachment[], respond: boolean) {
    if (!items.length) return;
    sessionRef.current?.sendAttachments(items, respond);
  }

  async function onFilesPicked(fileList: FileList | null) {
    if (!fileList?.length) return;
    setAttachError(null);
    const nextChips: AttachmentChip[] = [];
    const errors: string[] = [];
    for (const file of Array.from(fileList)) {
      if (isVideoFile(file)) {
        loadVideoFile(file);
        continue;
      }
      const result = await processAttachment(file);
      if (!result.ok) {
        errors.push(result.message);
        continue;
      }
      nextChips.push({
        id: crypto.randomUUID(),
        name: result.attachment.name,
        kind: result.attachment.kind === "image" ? "image" : "file",
        previewUrl: result.attachment.kind === "image" ? result.attachment.dataUrl : undefined,
        sent: Boolean(sessionRef.current),
        payload: result.attachment,
      });
    }
    if (nextChips.length) {
      setChips((current) => [...current, ...nextChips]);
      if (sessionRef.current) {
        sendReadyAttachments(
          nextChips.map((chip) => chip.payload),
          true,
        );
      }
    }
    if (errors.length) setAttachError(errors[0] ?? null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeChip(id: string) {
    setChips((current) => current.filter((chip) => chip.id !== id));
  }

  function bindVideoProvider(session: VoiceSession) {
    session.setVideoContextProvider(async () =>
      snapshotFromVideo(watchVideoRef.current, videoFrames.current, videoMeta.current),
    );
    if (videoMeta.current.source) {
      session.notifyVideo(true, videoMeta.current);
    }
  }

  function clearVideo(notify = true) {
    stopVideoLoop.current?.();
    stopVideoLoop.current = null;
    videoFrames.current.clear();
    if (videoObjectUrl.current) {
      URL.revokeObjectURL(videoObjectUrl.current);
      videoObjectUrl.current = null;
    }
    const hadVideo = Boolean(videoMeta.current.source);
    videoMeta.current = { title: "", source: null };
    setVideoSrc(null);
    setVideoTitle("");
    setVideoHint(null);
    if (hadVideo && notify) sessionRef.current?.notifyVideo(false);
  }

  function loadVideoSrc(src: string, title: string, source: VideoSourceKind) {
    if (videoObjectUrl.current && videoObjectUrl.current !== src) {
      URL.revokeObjectURL(videoObjectUrl.current);
      videoObjectUrl.current = null;
    }
    videoFrames.current.clear();
    videoMeta.current = { title, source };
    setVideoSrc(src);
    setVideoTitle(title);
    setVideoHint(null);
    sessionRef.current?.notifyVideo(true, videoMeta.current);
  }

  function loadVideoUrl(raw: string) {
    const trimmed = raw.trim();
    const src = playableVideoSrc(trimmed);
    if (!src) {
      setVideoHint("Paste a direct mp4 or webm URL.");
      return;
    }
    loadVideoSrc(src, titleFromVideoUrl(trimmed), "url");
  }

  function loadVideoFile(file: File) {
    if (!isVideoFile(file)) {
      setVideoHint("Use an mp4 or webm file.");
      return false;
    }
    const url = URL.createObjectURL(file);
    videoObjectUrl.current = url;
    loadVideoSrc(url, file.name, "file");
    return true;
  }

  function onVideoFilePicked(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file) loadVideoFile(file);
    if (videoFileInputRef.current) videoFileInputRef.current.value = "";
  }

  function attach(session: VoiceSession) {
    sessionRef.current = session;
    setError(null);
    bindVideoProvider(session);
  }

  function clearSession() {
    sessionRef.current = null;
    setPhase("idle");
    setSessionId(null);
  }

  async function startSession() {
    const session = new VoiceSession({
      onPhase: setPhase,
      onTranscripts: commitRows,
      onSessionId: setSessionId,
      onError: (message) => {
        setError(message);
        releaseVision(undefined, false);
        clearSession();
      },
    });
    attach(session);
    await session.start();
    return session;
  }

  // Voice start/stop must never pause or unload a watch-together video.

  async function stopSession() {
    const persisted = readVoiceSessionStore();
    releaseVision(undefined, true);
    sessionRef.current?.stop();
    clearSession();
    writeVoiceSessionStore({ sessionId: null, started: false });
    if (persisted.sessionId) {
      void fetch("/api/memory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-lexi-user-id": persisted.userId || DEFAULT_USER_ID,
          "ngrok-skip-browser-warning": "1",
        },
        body: JSON.stringify({
          userId: persisted.userId || DEFAULT_USER_ID,
          sessionId: persisted.sessionId,
          endSession: true,
        }),
      });
    }
  }

  async function onComposerSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    const unsent = chips.filter((chip) => !chip.sent);

    if (text || unsent.length) {
      setDraft("");
      setError(null);
      setAttachError(null);
      let session = sessionRef.current;
      if (!session) {
        session = await startSession();
      }
      if (unsent.length) {
        sendReadyAttachments(
          unsent.map((chip) => chip.payload),
          !text,
        );
        setChips((current) => current.map((chip) => ({ ...chip, sent: true })));
      }
      if (text) session.sendText(text);
      return;
    }

    if (sessionRef.current) {
      await stopSession();
      return;
    }

    await startSession();
  }

  const live = phase !== "idle";
  const hasUnsent = chips.some((chip) => !chip.sent);
  const hasText = draft.trim().length > 0 || hasUnsent;
  const latestText =
    caption || [...rows].reverse().find((row) => row.text.trim())?.text || "";
  const placeholder = live ? HINTS[phase] : HINTS.idle;
  const status = error
    ? error
    : live
      ? sessionId
        ? `${HINTS[phase]} · session ${sessionId}`
        : HINTS[phase]
      : HINTS.idle;
  const buttonLabel = hasText
    ? live
      ? "Send to Lexi"
      : "Send and start talking"
    : live
      ? "Stop talking"
      : "Start talking";

  return (
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-background font-sans text-foreground">
      <style>{`
        @keyframes lexi-wave {
          0%, 100% { transform: scaleY(0.4); }
          50% { transform: scaleY(1); }
        }
      `}</style>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      >
        <Image
          src="/lexi.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_12%] opacity-[0.28] sm:object-[84%_16%] sm:opacity-[0.42] dark:opacity-[0.34] dark:sm:opacity-[0.5] [mask-image:linear-gradient(180deg,rgba(0,0,0,0.9)_0%,rgba(0,0,0,0.4)_40%,transparent_70%)] sm:[mask-image:linear-gradient(270deg,rgba(0,0,0,0.95)_0%,rgba(0,0,0,0.55)_46%,transparent_82%)]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/30 to-background sm:bg-gradient-to-r sm:from-background sm:via-background/40 sm:to-transparent" />
      </div>
      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <p className="text-sm font-medium uppercase tracking-[0.22em]">Lexi</p>
      </header>
      <main className={`relative z-10 flex flex-1 flex-col items-center px-6 ${videoSrc ? "justify-end pb-2" : "justify-center"}`}>
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-zinc-500">
          /ˈlek.si/
        </p>
        <h1 className="text-6xl font-semibold tracking-tight sm:text-7xl">Lexi</h1>
        <p
          data-stream-tick={streamTick}
          className="mt-6 min-h-8 max-w-md text-center text-lg leading-8 text-zinc-600 dark:text-zinc-400"
        >
          {error ?? (latestText || "A voice-first companion.")}
        </p>
      </main>
      <div className="relative z-10 w-full px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:px-6">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
          {videoSrc ? (
            <div className="overflow-hidden rounded-2xl border border-zinc-400 bg-background shadow-md dark:border-zinc-500">
              <video
                ref={watchVideoRef}
                src={videoSrc}
                controls
                playsInline
                preload="metadata"
                className="aspect-video w-full bg-black"
                aria-label={videoTitle ? `Watch together: ${videoTitle}` : "Watch together video"}
                onLoadedData={() => {
                  const video = watchVideoRef.current;
                  if (!video) return;
                  const shot = captureVideoShot(video);
                  if (shot) videoFrames.current.push(shot);
                }}
                onError={() => {
                  setVideoHint(
                    "Could not play that video. Use a direct mp4 or webm URL, or upload a file.",
                  );
                }}
              />
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    {videoTitle || "Watch together"}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Headphones recommended — video audio and Lexi mix.
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="Close video"
                  onClick={() => clearVideo(true)}
                  className="flex h-8 shrink-0 items-center rounded-full px-3 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-foreground dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form
              className="flex items-center gap-2 rounded-full border border-zinc-400 bg-background px-2 py-1.5 dark:border-zinc-500"
              onSubmit={(event) => {
                event.preventDefault();
                loadVideoUrl(videoDraft);
              }}
            >
              <input
                ref={videoFileInputRef}
                id="lexi-video-file"
                type="file"
                accept={VIDEO_ACCEPT}
                className="sr-only"
                onChange={(event) => onVideoFilePicked(event.target.files)}
              />
              <button
                type="button"
                aria-label="Upload mp4 or webm"
                title="Upload a video"
                onClick={() => videoFileInputRef.current?.click()}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <FilmIcon />
              </button>
              <label className="sr-only" htmlFor="lexi-video-url">
                Video URL
              </label>
              <input
                id="lexi-video-url"
                type="url"
                value={videoDraft}
                onChange={(event) => setVideoDraft(event.target.value)}
                placeholder="Watch together — mp4/webm URL"
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-zinc-500"
              />
              <button
                type="submit"
                className="flex h-8 shrink-0 items-center rounded-full px-3 text-xs text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-foreground dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                Load
              </button>
            </form>
          )}
          {videoHint ? (
            <p className="px-1 text-xs text-zinc-500">{videoHint}</p>
          ) : null}
          <div className="flex items-end justify-between gap-3">
            {cameraOn ? (
              <video
                ref={cameraVideoRef}
                muted
                playsInline
                autoPlay
                className="h-[4.5rem] w-24 shrink-0 rounded-xl border border-zinc-400 object-cover shadow-md -scale-x-100 dark:border-zinc-500"
                aria-label="Camera viewfinder"
              />
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {screenOn ? (
                <span className="rounded-full border border-zinc-400 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-600 dark:border-zinc-500 dark:text-zinc-300">
                  Sharing
                </span>
              ) : null}
              {canShare ? (
                <button
                  type="button"
                  aria-pressed={screenOn}
                  aria-label={screenOn ? "Stop sharing screen" : "Share screen"}
                  onClick={() => toggleVision("screen")}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-400 bg-background text-foreground transition-colors hover:bg-zinc-100 dark:border-zinc-500 dark:hover:bg-zinc-800 ${screenOn ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
                >
                  <ScreenShareIcon />
                </button>
              ) : null}
              <button
                type="button"
                aria-pressed={cameraOn}
                aria-label={cameraOn ? "Stop camera" : "Camera"}
                onClick={() => toggleVision("camera")}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-400 bg-background text-foreground transition-colors hover:bg-zinc-100 dark:border-zinc-500 dark:hover:bg-zinc-800 ${cameraOn ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
              >
                <CameraIcon />
              </button>
            </div>
          </div>
          {visionHint ? (
            <p className="text-right text-xs text-zinc-500">{visionHint}</p>
          ) : null}
          {screenOn ? (
            <video
              ref={screenVideoRef}
              muted
              playsInline
              autoPlay
              className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0"
              aria-hidden
            />
          ) : null}
          {chips.length ? (
            <ul className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <li
                  key={chip.id}
                  className="flex max-w-full items-center gap-2 rounded-full border border-zinc-400 bg-background py-1 pr-1 pl-1 dark:border-zinc-500"
                >
                  {chip.previewUrl ? (
                    <img
                      src={chip.previewUrl}
                      alt=""
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[10px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                      file
                    </span>
                  )}
                  <span className="max-w-[9rem] truncate text-xs text-foreground">
                    {chip.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${chip.name}`}
                    onClick={() => removeChip(chip.id)}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-foreground dark:hover:bg-zinc-800"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {attachError ? (
            <p className="px-1 text-xs text-red-600 dark:text-red-400">{attachError}</p>
          ) : null}
        <form
          onSubmit={(event) => void onComposerSubmit(event)}
          className="flex min-h-14 w-full items-center gap-2 rounded-full border border-zinc-400 bg-background px-3 py-2 shadow-md sm:px-4 dark:border-zinc-500"
        >
          <input
            ref={fileInputRef}
            id="lexi-attach"
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            className="sr-only"
            onChange={(event) => void onFilesPicked(event.target.files)}
          />
          <button
            type="button"
            aria-label="Add photo or file"
            title="Add photo"
            onClick={() => fileInputRef.current?.click()}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <PaperclipIcon />
          </button>
          <label className="sr-only" htmlFor="lexi-composer">
            Message Lexi
          </label>
          <input
            id="lexi-composer"
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            className="min-h-11 min-w-0 flex-1 bg-transparent px-1 text-base text-foreground outline-none sm:px-2 placeholder:text-zinc-600 dark:placeholder:text-zinc-300"
          />
          <p className="sr-only" role="status">
            {status}
          </p>
          <button
            type="submit"
            aria-pressed={live && !hasText}
            aria-label={buttonLabel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <ComposerButton live={live} hasText={hasText} phase={phase} />
          </button>
        </form>
        </div>
      </div>
    </div>
  );
}
