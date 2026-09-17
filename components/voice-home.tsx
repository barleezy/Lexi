"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { BuyPacks, type BuyPackCard } from "@/components/buy-packs";
import {
  VoiceSession,
  type GeneratedMediaItem,
  type TranscriptRow,
  type VoicePhase,
} from "@/lib/voice/session";
import {
  clearCallContinuityStore,
  readVoiceSessionStore,
  writeVoiceSessionStore,
} from "@/lib/voice/persist";
import {
  isAdminUserId,
  isGuestUserId,
  readBrowserUserId,
  writeBrowserUserId,
} from "@/lib/memory/user";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_VIDEO_FIRST_LOOK_FRAMES,
  isAttachmentVideoFile,
  processAttachment,
  type ReadyAttachment,
} from "@/lib/voice/attachments";
import {
  captureVideoShot,
  isPageLikeVideoUrl,
  isVideoFile,
  directVideoHref,
  playableVideoSrc,
  mergeVideoSnapshots,
  snapshotFromFrames,
  snapshotFromShareStream,
  snapshotFromVideo,
  startLiveDecipher,
  startVideoFrameLoop,
  titleFromVideoUrl,
  VIDEO_ACCEPT,
  VideoFrameBuffer,
  watchPlaysInHomeTab,
  type VideoSourceKind,
} from "@/lib/voice/video";
import { isAdultPageUrl, isDirectWatchMediaUrl, isWatchHlsUrl, shouldProxyWatchMedia } from "@/lib/voice/watch-adult";
import { watchSizeError } from "@/lib/voice/watch-formats";
import {
  CAMERA_VISION_INTERVAL_MS,
  SCREEN_VISION_INTERVAL_MS,
  canShareScreen,
  nextCameraFacing,
  preferWatchTab,
  startCameraStream,
  startLiveVisionCapture,
  startScreenStream,
  sameVideoDevice,
  stopMediaStream,
  DualLiveVisionMux,
  VisionFrameBatcher,
  type CameraFacing,
  type VisionSource,
} from "@/lib/voice/vision";
import { openWatchChannel, watchTabHref, WATCH_UI_ENABLED } from "@/lib/voice/watch-channel";
import {
  GEO_WATCH_OPTIONS,
  locationFromPosition,
  placeFromCoords,
  readGeoPermission,
  shouldPublishLocation,
  type DeviceLocationState,
} from "@/lib/voice/location";
import {
  authorizeAppleMusic,
  cacheAppleMusicSongs,
  configureMusicKit,
  pauseAppleMusicPlayback,
  playAppleMusicFromGesture,
  playAppleMusicSong,
  resumeAppleMusicPlayback,
  prefetchOurSong,
  readAppleMusicNowPlaying,
  searchAppleMusicCatalog,
  skipAppleMusicFromGesture,
  stopAppleMusicPlayback,
  subscribeAppleMusicPlayback,
  unauthorizeAppleMusic,
} from "@/lib/apple-music/client";
import { OUR_SONG_SEARCH } from "@/lib/apple-music/config";
import { AppleMusicBar } from "@/components/apple-music-bar";
import { BackgroundAudioPlayer } from "@/lib/voice/background-music";
import { setMediaSessionYield } from "@/lib/voice/keepalive";
import { DEFAULT_MUSIC_STATE, type MusicSessionState } from "@/lib/voice/persona";

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

function FlipCameraIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" aria-hidden>
      <path
        d="M7 7h4V4L4 9l7 5V11h6a3 3 0 0 1 3 3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 17h-4v3l7-5-7-5v3H7a3 3 0 0 1-3-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  kind: "image" | "file" | "video";
  previewUrl?: string;
  sent: boolean;
  payload: ReadyAttachment;
};

type VisionSlot = {
  stream: MediaStream | null;
  stopLoop: (() => void) | null;
  busy: boolean;
};

function emptyVisionSlot(): VisionSlot {
  return { stream: null, stopLoop: null, busy: false };
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

function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  const clock = now
    ? now.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";
  const spoken = now
    ? now.toLocaleString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Current time";
  return (
    <time
      dateTime={now ? now.toISOString() : undefined}
      title={now ? spoken : undefined}
      aria-label={spoken}
      className="shrink-0 tabular-nums text-[11px] text-zinc-500"
    >
      {clock}
    </time>
  );
}

export function VoiceHome({
  catalogPacks = [],
  billingReady = false,
}: {
  catalogPacks?: BuyPackCard[];
  billingReady?: boolean;
} = {}) {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [voiceSeconds, setVoiceSeconds] = useState<number | null>(null);
  const [voiceLabel, setVoiceLabel] = useState("");
  const [stripeConfigured, setStripeConfigured] = useState(billingReady);
  const [buyPacks, setBuyPacks] = useState<BuyPackCard[]>(catalogPacks);
  const [buyIntent, setBuyIntent] = useState(false);
  const [rehearsal, setRehearsal] = useState(false);
  const [callCapAtMs, setCallCapAtMs] = useState<number | null>(null);
  const [callLeftover, setCallLeftover] = useState(0);
  const [callTick, setCallTick] = useState(0);
  const [accountDraft, setAccountDraft] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountConfirm, setAccountConfirm] = useState("");
  const [accountResetToken, setAccountResetToken] = useState("");
  const [accountMode, setAccountMode] = useState<"signin" | "signup">("signin");
  const [accountPanel, setAccountPanel] = useState<"auth" | "forgot" | "reset">("auth");
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountPending, setAccountPending] = useState(false);
  const [rows, setRows] = useState<TranscriptRow[]>([]);
  const [caption, setCaption] = useState("");
  const [streamTick, setStreamTick] = useState(0);
  const [draft, setDraft] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<CameraFacing>("user");
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
  const screenFrames = useRef(new VideoFrameBuffer());
  const cameraFrames = useRef(new VideoFrameBuffer());
  const liveMux = useRef(new DualLiveVisionMux());
  const cameraDecipherStop = useRef<(() => void) | null>(null);
  const screenDecipherStop = useRef<(() => void) | null>(null);
  const stopVideoLoop = useRef<(() => void) | null>(null);
  const videoMeta = useRef<{ title: string; source: VideoSourceKind | null }>({
    title: "",
    source: null,
  });
  const [chips, setChips] = useState<AttachmentChip[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachBusy, setAttachBusy] = useState<string | null>(null);
  const [videoDraft, setVideoDraft] = useState("");
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState("");
  const [videoHint, setVideoHint] = useState<string | null>(null);
  const [watchRemote, setWatchRemote] = useState<{ title: string; hasAudio: boolean } | null>(
    null,
  );
  const [phoneWatch, setPhoneWatch] = useState(false);
  const [toyControl, setToyControl] = useState(false);
  const [toyGrantPending, setToyGrantPending] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [windowBlurred, setWindowBlurred] = useState(false);
  const [micResume, setMicResume] = useState(false);
  const [generated, setGenerated] = useState<GeneratedMediaItem[]>([]);
  const [channelNames, setChannelNames] = useState<string[]>([]);
  const [locationOn, setLocationOn] = useState(false);
  const [locationHint, setLocationHint] = useState<string | null>(null);
  const [music, setMusic] = useState<MusicSessionState>(DEFAULT_MUSIC_STATE);
  const [musicQuery, setMusicQuery] = useState("");
  const [appleHint, setAppleHint] = useState<string | null>(null);
  const [appleBusy, setAppleBusy] = useState(false);
  const backgroundAudio = useRef(new BackgroundAudioPlayer());
  const appleDeveloperToken = useRef("");
  const locationWatch = useRef<number | null>(null);
  const lastLocation = useRef<DeviceLocationState | null>(null);
  const lastLocationPublish = useRef(0);
  const videoPolls = useRef(new Set<string>());
  const generatedStills = useRef(new Set<string>());
  const videoSrcRef = useRef<string | null>(null);
  const videoProxyTried = useRef(false);
  const watchTabActiveRef = useRef(false);
  const watchPlayingRef = useRef(false);
  const watchTimeRef = useRef(0);
  const watchDurationRef = useRef(0);
  const visionBatcher = useRef(new VisionFrameBatcher());

  function commitRows(nextRows: TranscriptRow[]) {
    const snapshot = nextRows.map((row) => ({ ...row }));
    const live = [...snapshot].reverse().find((row) => row.text.trim())?.text ?? "";
    setRows(snapshot);
    writeVoiceSessionStore({ caption: live, rows: snapshot });
  }

  function commitCaption(text: string) {
    setCaption(text);
    setStreamTick((tick) => tick + 1);
  }

  function applyApplePlayback(now: { playing: boolean; title: string; artist: string }) {
    const title = [now.title, now.artist].filter(Boolean).join(" — ");
    setMediaSessionYield(now.playing);
    setMusic((current) => ({
      ...current,
      playing: now.playing || (current.source === "url" && current.playing),
      title: now.playing ? title || current.title : current.source === "url" ? current.title : "",
      source: now.playing ? "apple" : current.source === "url" && current.playing ? "url" : "none",
    }));
    if (now.playing) {
      sessionRef.current?.setMusicPlayback(true, title || "Apple Music", "apple");
      return;
    }
    if (sessionRef.current && !backgroundAudio.current.playing) {
      sessionRef.current.setMusicPlayback(false);
    }
  }

  useEffect(() => {
    setBuyIntent(new URLSearchParams(window.location.search).get("next") === "/buy");
  }, []);

  useEffect(() => {
    if (!callCapAtMs) return;
    const timer = window.setInterval(() => setCallTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, [callCapAtMs]);

  useEffect(() => {
    const persisted = readVoiceSessionStore();
    const signedIn = readBrowserUserId();
    if (signedIn && !isGuestUserId(signedIn)) {
      setAccountId(signedIn);
      setAccountDraft(signedIn);
      writeVoiceSessionStore({ userId: signedIn });
    } else if (persisted.userId && !isGuestUserId(persisted.userId)) {
      writeVoiceSessionStore({ userId: "" });
    }
    if (persisted.sessionId) setSessionId(persisted.sessionId);
    if (persisted.rows.length || persisted.caption) {
      setRows(persisted.rows);
      setCaption(persisted.caption);
    }
    void fetch("/api/channels", { headers: { "ngrok-skip-browser-warning": "1" } })
      .then((response) => response.json())
      .then((body: { platforms?: Record<string, boolean> }) => {
        const platforms = body.platforms ?? {};
        setChannelNames(
          (["discord", "telegram", "sms", "email"] as const).filter((name) => platforms[name]),
        );
      })
      .catch(() => {});
    void refreshVoiceBalance();
    void fetch("/api/apple-music", { headers: { "ngrok-skip-browser-warning": "1" } })
      .then((response) => response.json())
      .then(async (body: { configured?: boolean; connected?: boolean; developerToken?: string }) => {
        if (typeof body.developerToken === "string") appleDeveloperToken.current = body.developerToken;
        const connected = Boolean(body.connected);
        setMusic((current) => ({
          ...current,
          appleConfigured: Boolean(body.configured),
          appleConnected: connected,
        }));
        if (connected && body.developerToken) {
          try {
            await configureMusicKit(body.developerToken);
          } catch {
            // Play tap will configure again
          }
          void prefetchOurSong();
          applyApplePlayback(readAppleMusicNowPlaying());
        }
      })
      .catch(() => {});
    const unsubscribeMusic = subscribeAppleMusicPlayback((now) => {
      applyApplePlayback(now);
    });
    setCanShare(canShareScreen() && !preferWatchTab());
    setPhoneWatch(preferWatchTab());
    visionBatcher.current.setFlush((parts) => {
      sessionRef.current?.sendVisionFrames(parts);
    });
    liveMux.current.setFlush((parts) => {
      sessionRef.current?.sendVisionFrames(parts);
    });
    const channel = openWatchChannel((message) => {
      if (message.type === "hello") {
        channel?.postMessage({ type: "ready" });
        return;
      }
      if (message.type === "start") {
        watchTabActiveRef.current = true;
        videoFrames.current.clear();
        videoMeta.current = { title: message.title, source: message.source };
        watchPlayingRef.current = true;
        setWatchRemote({ title: message.title, hasAudio: message.hasAudio });
        setVideoTitle(message.title);
        sessionRef.current?.notifyVideo(true, {
          title: message.title,
          source: message.source,
          remoteTab: true,
        });
        return;
      }
      if (message.type === "frame") {
        if (!watchTabActiveRef.current) {
          watchTabActiveRef.current = true;
          videoMeta.current = { title: message.title || "Video", source: "url" };
          setWatchRemote({ title: message.title || "Video", hasAudio: true });
          sessionRef.current?.notifyVideo(true, {
            title: message.title,
            source: "url",
            remoteTab: true,
          });
        }
        videoFrames.current.push({ dataUrl: message.dataUrl, timeSec: message.timeSec });
        watchPlayingRef.current = message.playing;
        watchTimeRef.current = message.timeSec;
        watchDurationRef.current = message.duration;
        visionBatcher.current.push({
          source: "watch",
          dataUrl: message.dataUrl,
          timeSec: message.timeSec,
        });
        return;
      }
      if (message.type === "audio-state") {
        setWatchRemote((current) =>
          current ? { ...current, hasAudio: message.hasAudio } : current,
        );
        return;
      }
      if (message.type === "stop") {
        const wasRemote = watchTabActiveRef.current;
        watchTabActiveRef.current = false;
        visionBatcher.current.clear("watch");
        setWatchRemote(null);
        if (wasRemote && !videoSrcRef.current) {
          videoFrames.current.clear();
          videoMeta.current = { title: "", source: null };
          setVideoTitle("");
          sessionRef.current?.notifyVideo(false);
        }
      }
    });
    channel?.postMessage({ type: "ready" });
    const syncHidden = () => setTabHidden(document.visibilityState === "hidden");
    const onBlur = () => setWindowBlurred(true);
    const onFocus = () => setWindowBlurred(false);
    document.addEventListener("visibilitychange", syncHidden);
    window.addEventListener("pageshow", syncHidden);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    syncHidden();
    return () => {
      unsubscribeMusic();
      document.removeEventListener("visibilitychange", syncHidden);
      window.removeEventListener("pageshow", syncHidden);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      cameraSlot.current.stopLoop?.();
      screenSlot.current.stopLoop?.();
      cameraDecipherStop.current?.();
      screenDecipherStop.current?.();
      cameraDecipherStop.current = null;
      screenDecipherStop.current = null;
      stopMediaStream(cameraSlot.current.stream);
      stopMediaStream(screenSlot.current.stream);
      cameraSlot.current = emptyVisionSlot();
      screenSlot.current = emptyVisionSlot();
      stopVideoLoop.current?.();
      if (videoObjectUrl.current) URL.revokeObjectURL(videoObjectUrl.current);
      visionBatcher.current.dispose();
      liveMux.current.dispose();
      channel?.close();
      if (locationWatch.current != null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatch.current);
      }
      locationWatch.current = null;
      sessionRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!music.appleConnected) return;
    const term = musicQuery.trim() || OUR_SONG_SEARCH;
    const timer = window.setTimeout(() => {
      void searchAppleMusicCatalog(term)
        .then((songs) => cacheAppleMusicSongs(term, songs))
        .catch(() => {});
    }, 280);
    return () => window.clearTimeout(timer);
  }, [music.appleConnected, musicQuery]);

  useEffect(() => {
    if (!videoSrc) return;
    const video = watchVideoRef.current;
    if (!video) return;
    videoFrames.current.clear();
    stopVideoLoop.current?.();
    stopVideoLoop.current = startVideoFrameLoop(video, videoFrames.current, (shot) => {
      if (watchTabActiveRef.current) return;
      visionBatcher.current.push({
        source: "watch",
        dataUrl: shot.dataUrl,
        timeSec: shot.timeSec,
      });
    });
    return () => {
      stopVideoLoop.current?.();
      stopVideoLoop.current = null;
    };
  }, [videoSrc]);

  function sendCameraFrame(dataUrl: string) {
    cameraFrames.current.push({ dataUrl, timeSec: Date.now() / 1000, label: "Live camera" });
  }

  async function analyzeLiveShot(source: "camera" | "screen", shot: { dataUrl: string; timeSec: number; label?: string }) {
    const label = source === "camera" ? "Live camera" : "Shared tab";
    try {
      const response = await fetch("/api/video/context", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "1",
        },
        body: JSON.stringify({
          frames: [{ dataUrl: shot.dataUrl, timeSec: shot.timeSec, label }],
          question:
            source === "camera"
              ? "Describe the camera view. Name the person, setting, clothing, and any visible text."
              : "Read all visible text on this shared tab. Describe exactly what is on screen: site, people, objects, UI, and action.",
          title: label,
          playing: true,
        }),
      });
      let description = "";
      try {
        const body = (await response.json()) as { description?: unknown };
        if (typeof body.description === "string") description = body.description;
      } catch {
        description = "";
      }
      sessionRef.current?.sendLiveLook(source, shot.dataUrl, description);
    } catch {
      sessionRef.current?.sendLiveLook(source, shot.dataUrl, "");
    }
  }

  function bindCameraTrack(stream: MediaStream) {
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (cameraSlot.current.busy || cameraSlot.current.stream !== stream) return;
      releaseVision("camera");
    });
  }

  useEffect(() => {
    if (!cameraOn) return;
    const video = cameraVideoRef.current;
    const stream = cameraSlot.current.stream;
    if (!video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    cameraSlot.current.stopLoop?.();
    cameraSlot.current.stopLoop = startLiveVisionCapture(video, sendCameraFrame, CAMERA_VISION_INTERVAL_MS);
    cameraDecipherStop.current?.();
    cameraDecipherStop.current = startLiveDecipher(
      video,
      (shot) => {
        shot.label = "Live camera";
        cameraFrames.current.push(shot);
        liveMux.current.push({ source: "camera", dataUrl: shot.dataUrl, timeSec: shot.timeSec });
      },
      (shot) => {
        shot.label = "Live camera";
        void analyzeLiveShot("camera", shot);
      },
    );
    return () => {
      cameraSlot.current.stopLoop?.();
      cameraSlot.current.stopLoop = null;
      cameraDecipherStop.current?.();
      cameraDecipherStop.current = null;
      if (video.srcObject === stream) video.srcObject = null;
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
    screenSlot.current.stopLoop = startLiveVisionCapture(video, (dataUrl) => {
      screenFrames.current.push({ dataUrl, timeSec: Date.now() / 1000, label: "Shared tab" });
    }, SCREEN_VISION_INTERVAL_MS);
    screenDecipherStop.current?.();
    screenDecipherStop.current = startLiveDecipher(
      video,
      (shot) => {
        shot.label = "Shared tab";
        screenFrames.current.push(shot);
        liveMux.current.push({ source: "screen", dataUrl: shot.dataUrl, timeSec: shot.timeSec });
      },
      (shot) => {
        shot.label = "Shared tab";
        void analyzeLiveShot("screen", shot);
      },
    );
    return () => {
      screenSlot.current.stopLoop?.();
      screenSlot.current.stopLoop = null;
      screenDecipherStop.current?.();
      screenDecipherStop.current = null;
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
      visionBatcher.current.clear("camera");
      liveMux.current.setActive("camera", false);
      liveMux.current.clear("camera");
      cameraDecipherStop.current?.();
      cameraDecipherStop.current = null;
      cameraFrames.current.clear();
    }
    if (!source || source === "screen") {
      const wasOn = Boolean(screenSlot.current.stream);
      screenSlot.current.stopLoop?.();
      sessionRef.current?.setSharedTabAudio(null);
      stopMediaStream(screenSlot.current.stream);
      screenSlot.current = emptyVisionSlot();
      setScreenOn(false);
      if (wasOn && notify) sessionRef.current?.notifyVision("screen", false);
      visionBatcher.current.clear("screen");
      liveMux.current.setActive("screen", false);
      liveMux.current.clear("screen");
      screenDecipherStop.current?.();
      screenDecipherStop.current = null;
      screenFrames.current.clear();
    }
  }

  async function startVision(source: VisionSource) {
    setVisionHint(null);
    try {
      const stream =
        source === "camera" ? await startCameraStream(cameraFacing) : await startScreenStream();
      const slot = source === "camera" ? cameraSlot : screenSlot;
      slot.current.stream = stream;
      if (source === "camera") bindCameraTrack(stream);
      else {
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          releaseVision(source);
        });
      }
      if (source === "camera") {
        liveMux.current.setActive("camera", true);
        setCameraOn(true);
      } else {
        liveMux.current.setActive("screen", true);
        setScreenOn(true);
        sessionRef.current?.setSharedTabAudio(stream);
      }
      sessionRef.current?.notifyVision(source, true);
      const other = source === "camera" ? screenSlot.current.stream : cameraSlot.current.stream;
      if (other) sessionRef.current?.notifyDualLiveVision();
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

  async function flipCamera() {
    if (!cameraSlot.current.stream || cameraSlot.current.busy) return;
    const previousFacing = cameraFacing;
    const next = nextCameraFacing(previousFacing);
    const previous = cameraSlot.current.stream;
    cameraSlot.current.busy = true;
    setVisionHint(null);
    try {
      let stream: MediaStream;
      try {
        stream = await startCameraStream(next);
      } catch {
        stopMediaStream(previous);
        if (cameraSlot.current.stream === previous) cameraSlot.current.stream = null;
        stream = await startCameraStream(next);
      }
      if (cameraSlot.current.stream === previous && sameVideoDevice(previous, stream)) {
        stopMediaStream(stream);
        setVisionHint(next === "environment" ? "Rear camera is not available." : "Front camera is not available.");
        return;
      }
      cameraSlot.current.stream = stream;
      bindCameraTrack(stream);
      const video = cameraVideoRef.current;
      if (video) {
        video.srcObject = stream;
        void video.play().catch(() => {});
        cameraSlot.current.stopLoop?.();
        cameraSlot.current.stopLoop = startLiveVisionCapture(
          video,
          sendCameraFrame,
          CAMERA_VISION_INTERVAL_MS,
        );
      }
      if (previous !== stream) stopMediaStream(previous);
      setCameraFacing(next);
    } catch (caught) {
      if (!cameraSlot.current.stream) {
        try {
          const restored = await startCameraStream(previousFacing);
          cameraSlot.current.stream = restored;
          bindCameraTrack(restored);
          const video = cameraVideoRef.current;
          if (video) {
            video.srcObject = restored;
            void video.play().catch(() => {});
            cameraSlot.current.stopLoop?.();
            cameraSlot.current.stopLoop = startLiveVisionCapture(
              video,
              sendCameraFrame,
              CAMERA_VISION_INTERVAL_MS,
            );
          }
        } catch {
          releaseVision("camera", true);
        }
      }
      const message =
        caught instanceof Error && caught.name === "NotAllowedError"
          ? "Camera permission was denied."
          : caught instanceof Error
            ? caught.message
            : "Could not switch cameras.";
      setVisionHint(message);
    } finally {
      cameraSlot.current.busy = false;
    }
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
    const files = Array.from(fileList);
    if (files.some((file) => isAttachmentVideoFile(file))) {
      setAttachBusy("Reading video…");
    }
    try {
      for (const file of files) {
        const chipId = crypto.randomUUID();
        let firstLookSent = false;
        const result = await processAttachment(file, (update) => {
          if (update.attachment.kind !== "video") return;
          const chip: AttachmentChip = {
            id: chipId,
            name: update.attachment.name,
            kind: "video",
            previewUrl: update.attachment.frames[0]?.dataUrl,
            sent: Boolean(sessionRef.current),
            payload: update.attachment,
          };
          setChips((current) => {
            const without = current.filter((item) => item.id !== chipId);
            return [...without, chip];
          });
          if (sessionRef.current && !firstLookSent) {
            firstLookSent = true;
            sendReadyAttachments([update.attachment], true);
          }
        });
        if (!result.ok) {
          errors.push(result.message);
          continue;
        }
        const chip: AttachmentChip = {
          id: chipId,
          name: result.attachment.name,
          kind:
            result.attachment.kind === "image"
              ? "image"
              : result.attachment.kind === "video"
                ? "video"
                : "file",
          previewUrl:
            result.attachment.kind === "image"
              ? result.attachment.dataUrl
              : result.attachment.kind === "video"
                ? result.attachment.frames[0]?.dataUrl
                : undefined,
          sent: firstLookSent,
          payload: result.attachment,
        };
        if (firstLookSent && result.attachment.kind === "video") {
          const rest = result.attachment.frames.slice(ATTACHMENT_VIDEO_FIRST_LOOK_FRAMES);
          if (rest.length && sessionRef.current) {
            sendReadyAttachments(
              [
                {
                  ...result.attachment,
                  frames: rest,
                  analysis: "refine",
                },
              ],
              true,
            );
          }
          chip.sent = true;
        }
        nextChips.push(chip);
      }
    } finally {
      setAttachBusy(null);
    }
    if (nextChips.length) {
      setChips((current) => {
        const ids = new Set(nextChips.map((chip) => chip.id));
        return [...current.filter((chip) => !ids.has(chip.id)), ...nextChips];
      });
      const unsent = nextChips.filter((chip) => !chip.sent);
      if (sessionRef.current && unsent.length) {
        sendReadyAttachments(
          unsent.map((chip) => chip.payload),
          true,
        );
        for (const chip of unsent) chip.sent = true;
      }
    }
    if (errors.length) setAttachError(errors[0] ?? null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function removeChip(id: string) {
    setChips((current) => current.filter((chip) => chip.id !== id));
  }

  function bindVideoProvider(session: VoiceSession) {
    session.setVideoContextProvider(async () => {
      const parts = [];
      if (watchTabActiveRef.current) {
        parts.push(
          snapshotFromFrames(videoFrames.current, {
            title: videoMeta.current.title,
            source: videoMeta.current.source,
            playing: watchPlayingRef.current,
            currentTime: watchTimeRef.current,
            duration: watchDurationRef.current,
          }),
        );
      } else if (videoMeta.current.source) {
        parts.push(snapshotFromVideo(watchVideoRef.current, videoFrames.current, videoMeta.current));
      }
      if (screenSlot.current.stream) {
        parts.push(snapshotFromShareStream(screenVideoRef.current, screenFrames.current, "Shared tab"));
      }
      if (cameraSlot.current.stream) {
        parts.push(snapshotFromShareStream(cameraVideoRef.current, cameraFrames.current, "Live camera"));
      }
      if (parts.length) return mergeVideoSnapshots(parts);
      return snapshotFromVideo(watchVideoRef.current, videoFrames.current, videoMeta.current);
    });
    if (videoMeta.current.source) {
      session.notifyVideo(true, {
        ...videoMeta.current,
        remoteTab: watchTabActiveRef.current,
      });
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
    videoSrcRef.current = null;
    videoProxyTried.current = false;
    setVideoSrc(null);
    setVideoTitle("");
    setVideoHint(null);
    if (hadVideo && notify && !watchTabActiveRef.current) sessionRef.current?.notifyVideo(false);
  }

  function loadVideoSrc(src: string, title: string, source: VideoSourceKind) {
    if (videoObjectUrl.current && videoObjectUrl.current !== src) {
      URL.revokeObjectURL(videoObjectUrl.current);
      videoObjectUrl.current = null;
    }
    videoFrames.current.clear();
    videoMeta.current = { title, source };
    videoSrcRef.current = src;
    setVideoSrc(src);
    setVideoTitle(title);
    setVideoHint(null);
    sessionRef.current?.notifyVideo(true, videoMeta.current);
  }

  function loadVideoUrl(raw: string) {
    const trimmed = raw.trim();
    if (isPageLikeVideoUrl(trimmed)) {
      setVideoHint("YouTube will not play here. Open the watch tab and upload a file, or paste a direct video URL.");
      return;
    }
    if (
      isWatchHlsUrl(trimmed) ||
      (isDirectWatchMediaUrl(trimmed) &&
        (shouldProxyWatchMedia(trimmed) || !watchPlaysInHomeTab({ name: trimmed, type: "" })))
    ) {
      setVideoHint("This stream plays in the watch tab. Open watch tab — paste the same URL there.");
      return;
    }
    if (isAdultPageUrl(trimmed)) {
      setVideoHint("Adult site pages play in the watch tab. Open watch tab, or paste a direct mp4/m3u8/get_file URL there.");
      return;
    }
    const src = directVideoHref(trimmed);
    if (!src) {
      setVideoHint("Paste a direct video URL (mp4, webm) here, or a stream URL in the watch tab.");
      return;
    }
    if (!watchPlaysInHomeTab({ name: trimmed, type: "" })) {
      setVideoHint("This format plays in the watch tab. Open watch tab to play it.");
      return;
    }
    videoProxyTried.current = false;
    loadVideoSrc(src, titleFromVideoUrl(trimmed), "url");
  }

  function loadVideoFile(file: File) {
    if (!isVideoFile(file)) {
      setVideoHint("Use a video file (mp4, webm, mov, mkv, avi, flv, wmv, mpeg, and similar).");
      return false;
    }
    if (!watchPlaysInHomeTab(file)) {
      setVideoHint("This format plays in the watch tab. Open watch tab and upload the file there.");
      return false;
    }
    const tooBig = watchSizeError(file.size);
    if (tooBig) {
      setVideoHint(tooBig);
      return false;
    }
    const url = URL.createObjectURL(file);
    videoObjectUrl.current = url;
    videoProxyTried.current = false;
    loadVideoSrc(url, file.name, "file");
    return true;
  }

  function onVideoFilePicked(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file) loadVideoFile(file);
    if (videoFileInputRef.current) videoFileInputRef.current.value = "";
  }

  function upsertGenerated(item: GeneratedMediaItem) {
    setGenerated((current) => {
      const without = current.filter((row) => row.id !== item.id);
      return [item, ...without].slice(0, 6);
    });
    if (item.kind === "video" && item.status === "pending" && item.requestId) {
      pollGeneratedVideo(item);
    }
  }

  function pollGeneratedVideo(item: GeneratedMediaItem) {
    const requestId = item.requestId;
    if (!requestId || videoPolls.current.has(requestId)) return;
    videoPolls.current.add(requestId);
    void (async () => {
      try {
        for (let attempt = 0; attempt < 90; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2500));
          const response = await fetch(`/api/generate/video/${encodeURIComponent(requestId)}`, {
            headers: { "ngrok-skip-browser-warning": "1" },
          });
          let body: {
            status?: string;
            url?: string;
            error?: string;
            durationSec?: number;
            model?: string;
          } = {};
          try {
            body = (await response.json()) as typeof body;
          } catch {
            body = {};
          }
          if (body.status === "pending") continue;
          const next: GeneratedMediaItem = {
            ...item,
            status: body.status === "done" && body.url ? "done" : "failed",
            url: typeof body.url === "string" ? body.url : undefined,
            error:
              body.status === "done"
                ? undefined
                : typeof body.error === "string"
                  ? body.error
                  : "Video generation failed.",
            durationSec: typeof body.durationSec === "number" ? body.durationSec : item.durationSec,
            model: typeof body.model === "string" ? body.model : item.model,
          };
          setGenerated((current) => {
            const without = current.filter((row) => row.id !== item.id && row.id !== requestId);
            return [next, ...without].slice(0, 6);
          });
          if (next.status === "done" || next.status === "failed") {
            sessionRef.current?.notifyGeneratedReady(next);
          }
          return;
        }
        const timedOut: GeneratedMediaItem = {
          ...item,
          status: "failed",
          error: "Video is still generating. Try asking again in a moment.",
        };
        setGenerated((current) => {
          const without = current.filter((row) => row.id !== item.id);
          return [timedOut, ...without].slice(0, 6);
        });
        sessionRef.current?.notifyGeneratedReady(timedOut);
      } finally {
        videoPolls.current.delete(requestId);
      }
    })();
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
    setRows([]);
    setCaption("");
    setToyControl(false);
    setToyGrantPending(false);
    setMicResume(false);
    setCallCapAtMs(null);
    setCallLeftover(0);
  }

  async function refreshVoiceBalance() {
    try {
      const response = await fetch("/api/billing/balance", {
        credentials: "include",
        headers: { "ngrok-skip-browser-warning": "1" },
      });
      if (response.status === 401) {
        setVoiceSeconds(null);
        setVoiceLabel("");
        setBuyPacks(catalogPacks);
        setRehearsal(false);
        return;
      }
      const body = (await response.json()) as {
        voiceSeconds?: number;
        label?: string;
        stripeConfigured?: boolean;
        buyPacks?: BuyPackCard[];
      };
      if (!response.ok) return;
      const seconds = typeof body.voiceSeconds === "number" ? body.voiceSeconds : 0;
      setVoiceSeconds(seconds);
      setVoiceLabel(typeof body.label === "string" ? body.label : "");
      setStripeConfigured(body.stripeConfigured === true);
      setBuyPacks(Array.isArray(body.buyPacks) && body.buyPacks.length ? body.buyPacks : catalogPacks);
      setRehearsal(seconds <= 0);
    } catch {
      // ignore
    }
  }

  function stopLocationWatch() {
    if (locationWatch.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatch.current);
    }
    locationWatch.current = null;
    setLocationOn(false);
  }

  function publishLocation(next: DeviceLocationState, force = false) {
    if (
      !force &&
      !shouldPublishLocation(lastLocation.current, next, lastLocationPublish.current)
    ) {
      return;
    }
    lastLocation.current = next;
    lastLocationPublish.current = Date.now();
    sessionRef.current?.setDeviceLocation(next);
  }

  async function applyGeoPosition(position: GeolocationPosition, force = false) {
    const place = await placeFromCoords(position.coords.latitude, position.coords.longitude);
    publishLocation(locationFromPosition(position.coords, place), force);
    setLocationOn(true);
    setLocationHint(null);
  }

  function startLocationWatch(forcePrompt: boolean) {
    if (!navigator.geolocation) {
      setLocationHint("Location is not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        void applyGeoPosition(position, true);
        if (locationWatch.current != null) return;
        locationWatch.current = navigator.geolocation.watchPosition(
          (next) => {
            void applyGeoPosition(next);
          },
          (error) => {
            if (error.code === error.PERMISSION_DENIED) {
              stopLocationWatch();
              lastLocation.current = null;
              sessionRef.current?.setDeviceLocation(null);
              setLocationHint("Location is blocked in the browser.");
              return;
            }
            setLocationHint(error.message || "Could not update location.");
          },
          GEO_WATCH_OPTIONS,
        );
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          stopLocationWatch();
          lastLocation.current = null;
          sessionRef.current?.setDeviceLocation(null);
          setLocationHint("Location is blocked in the browser.");
          return;
        }
        if (!forcePrompt) return;
        setLocationHint(error.message || "Could not read location.");
      },
      GEO_WATCH_OPTIONS,
    );
  }

  async function refreshAppleDeveloperToken() {
    const response = await fetch("/api/apple-music", {
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    const body = (await response.json()) as {
      configured?: boolean;
      connected?: boolean;
      developerToken?: string;
      error?: string;
      setup?: string;
    };
    if (typeof body.developerToken === "string") appleDeveloperToken.current = body.developerToken;
    setMusic((current) => ({
      ...current,
      appleConfigured: Boolean(body.configured),
      appleConnected: Boolean(body.connected),
    }));
    return body;
  }

  async function connectAppleMusic() {
    setAppleBusy(true);
    setAppleHint(null);
    try {
      const status = await refreshAppleDeveloperToken();
      if (!status.configured || !status.developerToken) {
        const error = status.error || "Apple Music is not configured.";
        setAppleHint(error);
        return { ok: false, error };
      }
      const userToken = await authorizeAppleMusic(status.developerToken);
      const response = await fetch("/api/apple-music", {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
        body: JSON.stringify({ action: "connect", userToken }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        const error = body.error || "Could not save the Apple Music session.";
        setAppleHint(error);
        return { ok: false, error };
      }
      setMusic((current) => ({ ...current, appleConfigured: true, appleConnected: true }));
      sessionRef.current?.setAppleMusicConnected(true);
      void prefetchOurSong();
      applyApplePlayback(readAppleMusicNowPlaying());
      setAppleHint("Apple Music connected. Tap Play to start a song.");
      return { ok: true, connected: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tap Connect Apple Music and sign in with Apple.";
      setAppleHint(message);
      return { ok: false, error: message };
    } finally {
      setAppleBusy(false);
    }
  }

  async function disconnectAppleMusic() {
    setAppleBusy(true);
    try {
      if (appleDeveloperToken.current) {
        await unauthorizeAppleMusic(appleDeveloperToken.current);
      }
      await fetch("/api/apple-music", {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
        body: JSON.stringify({ action: "disconnect" }),
      });
      backgroundAudio.current.stop();
      if (appleDeveloperToken.current) {
        await stopAppleMusicPlayback(appleDeveloperToken.current);
      }
      setMusic((current) => ({
        ...current,
        appleConnected: false,
        playing: false,
        title: "",
        source: "none",
      }));
      sessionRef.current?.setAppleMusicConnected(false);
      sessionRef.current?.setMusicPlayback(false);
      setMediaSessionYield(false);
      setAppleHint(null);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Could not disconnect." };
    } finally {
      setAppleBusy(false);
    }
  }

  function toggleLocation() {
    if (locationOn) {
      stopLocationWatch();
      lastLocation.current = null;
      sessionRef.current?.setDeviceLocation(null);
      setLocationHint(null);
      return;
    }
    startLocationWatch(true);
  }

  function notifyUserMusic(title: string) {
    setAppleHint(null);
    setMusic((current) => ({
      ...current,
      playing: true,
      title: title || current.title || "Apple Music",
      source: "apple",
    }));
    sessionRef.current?.setMusicPlayback(true, title || "Apple Music", "apple");
    setMediaSessionYield(true);
  }

  function onApplePlayPause() {
    const token = appleDeveloperToken.current;
    if (!token) {
      setAppleHint("Connect Apple Music first.");
      return;
    }
    if (music.playing && music.source === "apple") {
      void pauseAppleMusicPlayback(token)
        .then(() => {
          setMediaSessionYield(false);
          setMusic((current) => ({ ...current, playing: false }));
          sessionRef.current?.setMusicPlayback(false);
        })
        .catch((error) => {
          setAppleHint(error instanceof Error ? error.message : "Could not pause.");
        });
      return;
    }
    backgroundAudio.current.stop();
    setMediaSessionYield(true);
    void playAppleMusicFromGesture(token, musicQuery)
      .then((played) => {
        notifyUserMusic(played.title);
      })
      .catch((error) => {
        setMediaSessionYield(false);
        setAppleHint(error instanceof Error ? error.message : "Could not play on Apple Music.");
      });
  }

  function onAppleNext() {
    const token = appleDeveloperToken.current;
    if (!token) {
      setAppleHint("Connect Apple Music first.");
      return;
    }
    backgroundAudio.current.stop();
    setMediaSessionYield(true);
    void skipAppleMusicFromGesture(token, musicQuery)
      .then((played) => {
        notifyUserMusic(played.title);
      })
      .catch((error) => {
        if (!readAppleMusicNowPlaying().playing) setMediaSessionYield(false);
        setAppleHint(error instanceof Error ? error.message : "Could not skip.");
      });
  }

  function applySignedIn(id: string) {
    writeBrowserUserId(id);
    setAccountId(id);
    setAccountDraft(id);
    setAccountPassword("");
    setAccountConfirm("");
    setAccountEmail("");
    setAccountResetToken("");
    setAccountNotice(null);
    setAccountError(null);
    setAccountPanel("auth");
    writeVoiceSessionStore({ userId: id });
    void refreshVoiceBalance();
    return id;
  }

  function clearAccountSecrets() {
    setAccountPassword("");
    setAccountConfirm("");
    setAccountResetToken("");
  }

  function openAccountAuth(mode: "signin" | "signup") {
    setAccountMode(mode);
    setAccountPanel("auth");
    setAccountNotice(null);
    setAccountError(null);
    setError(null);
  }

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    if (accountPanel === "forgot") {
      await submitForgot();
      return;
    }
    if (accountPanel === "reset") {
      await submitReset();
      return;
    }
    const creating = accountMode === "signup";
    if (!accountDraft.trim()) {
      setAccountError("Enter a username.");
      return;
    }
    if (creating && !accountEmail.trim()) {
      setAccountError("Enter the email for this account.");
      return;
    }
    if (accountPassword.length < 8) {
      setAccountError("Password must be at least 8 characters.");
      return;
    }
    if (creating && accountPassword !== accountConfirm) {
      setAccountError("Passwords do not match.");
      return;
    }
    setError(null);
    setAccountError(null);
    setAccountNotice(null);
    setAccountPending(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: accountMode,
          userId: accountDraft,
          email: accountEmail,
          password: accountPassword,
        }),
      });
      const body = (await response.json()) as { error?: string; userId?: string };
      if (!response.ok || !body.userId) {
        throw new Error(body.error || (creating ? "Could not create account." : "Could not sign in."));
      }
      applySignedIn(body.userId);
      const next = new URLSearchParams(window.location.search).get("next");
      if (next === "/buy" || next === "/subscribe") {
        window.location.href = next;
        return;
      }
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : creating ? "Could not create account." : "Could not sign in.");
    } finally {
      setAccountPending(false);
    }
  }

  async function submitForgot() {
    if (!accountDraft.trim() || !accountEmail.trim()) {
      setAccountError("Enter your username and email.");
      return;
    }
    setError(null);
    setAccountError(null);
    setAccountNotice(null);
    setAccountPending(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "forgot",
          userId: accountDraft,
          email: accountEmail,
        }),
      });
      const body = (await response.json()) as { error?: string; message?: string; sent?: boolean };
      if (!response.ok) {
        throw new Error(body.error || "Could not send a reset email.");
      }
      setAccountDraft("");
      setAccountEmail("");
      setAccountPassword("");
      setAccountConfirm("");
      setAccountResetToken("");
      setAccountMode("signin");
      setAccountPanel("reset");
      setAccountNotice("Check your email and return with the reset code.");
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Could not send a reset email.");
    } finally {
      setAccountPending(false);
    }
  }

  async function submitReset() {
    if (!accountResetToken.trim()) {
      setAccountError("Enter the reset code from your email.");
      return;
    }
    if (accountPassword.length < 8) {
      setAccountError("Password must be at least 8 characters.");
      return;
    }
    if (accountPassword !== accountConfirm) {
      setAccountError("Passwords do not match.");
      return;
    }
    setError(null);
    setAccountError(null);
    setAccountNotice(null);
    setAccountPending(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          token: accountResetToken,
          password: accountPassword,
        }),
      });
      const body = (await response.json()) as { error?: string; reset?: boolean };
      if (!response.ok || !body.reset) {
        throw new Error(body.error || "Could not reset password.");
      }
      clearAccountSecrets();
      setAccountPanel("auth");
      setAccountMode("signin");
      setAccountNotice("Password updated. Sign in with your new password.");
    } catch (err) {
      setAccountError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setAccountPending(false);
    }
  }

  async function signOutAccount() {
    writeBrowserUserId("");
    setAccountId("");
    setAccountDraft("");
    setAccountEmail("");
    setAccountPassword("");
    setAccountConfirm("");
    setAccountResetToken("");
    setAccountNotice(null);
    setAccountPanel("auth");
    writeVoiceSessionStore({ userId: "" });
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch {
      /* cookie already cleared locally */
    }
  }

  async function startSession() {
    if (!accountId || isGuestUserId(accountId)) {
      setError("Sign in first.");
      return null;
    }
    const session = new VoiceSession({
      onPhase: setPhase,
      onTranscripts: commitRows,
      onCaption: commitCaption,
      onSessionId: setSessionId,
      onToyControl: setToyControl,
      onToyControlRequest: setToyGrantPending,
      onGeneratedMedia: upsertGenerated,
      onMusicState: (next) => {
        const now = readAppleMusicNowPlaying();
        if (now.playing) {
          const title = [now.title, now.artist].filter(Boolean).join(" — ") || next.title;
          setMusic({ ...next, playing: true, title, source: "apple" });
          return;
        }
        setMusic(next);
      },
      connectAppleMusic,
      disconnectAppleMusic,
      playBackgroundUrl: async (url, title) => {
        try {
          if (appleDeveloperToken.current) {
            await stopAppleMusicPlayback(appleDeveloperToken.current);
          }
          await backgroundAudio.current.playUrl(url, title);
          return { ok: true, title: backgroundAudio.current.currentTitle };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : "Could not play that URL." };
        }
      },
      playAppleMusicSong: async (songId, title) => {
        try {
          const status = appleDeveloperToken.current
            ? { developerToken: appleDeveloperToken.current, configured: true }
            : await refreshAppleDeveloperToken();
          if (!status.developerToken) {
            return { ok: false, error: "Apple Music is not configured." };
          }
          backgroundAudio.current.stop();
          await playAppleMusicSong(status.developerToken, songId);
          return { ok: true, title: title || "Apple Music" };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : "Could not play on Apple Music.",
          };
        }
      },
      stopBackgroundMusic: async () => {
        backgroundAudio.current.stop();
        if (appleDeveloperToken.current) {
          await stopAppleMusicPlayback(appleDeveloperToken.current);
        }
      },
      onMicNeedsGesture: () => setMicResume(true),
      onMicRecovered: () => setMicResume(false),
      onWallet: ({ voiceSeconds: leftover, capAtMs }) => {
        setCallLeftover(leftover);
        setCallCapAtMs(capAtMs);
      },
      onError: (message) => {
        setError(message);
        if (/^out of minutes\.?$/i.test(message.trim())) setRehearsal(true);
        releaseVision(undefined, false);
        clearSession();
        void refreshVoiceBalance();
      },
    });
    attach(session);
    if (lastLocation.current) session.setDeviceLocation(lastLocation.current);
    if (appleDeveloperToken.current) {
      try {
        await configureMusicKit(appleDeveloperToken.current);
      } catch {
        // Play still works from the user's Play tap
      }
    }
    const alreadyPlaying = readAppleMusicNowPlaying();
    if (alreadyPlaying.playing) {
      applyApplePlayback(alreadyPlaying);
    }
    const urlWasPlaying = backgroundAudio.current.playing;
    await session.start();
    if (sessionRef.current) setRehearsal(false);
    if (urlWasPlaying && !backgroundAudio.current.playing) {
      try {
        await backgroundAudio.current.resume();
      } catch {
        // browser may still require a tap
      }
    }
    if (cameraSlot.current.stream) session.notifyVision("camera", true);
    if (screenSlot.current.stream) {
      session.setSharedTabAudio(screenSlot.current.stream);
      session.notifyVision("screen", true);
      if (cameraSlot.current.stream) session.notifyDualLiveVision();
      const shot = screenVideoRef.current ? captureVideoShot(screenVideoRef.current) : null;
      if (shot) {
        screenFrames.current.push(shot);
        session.sendVisionFrame("screen", shot.dataUrl);
      }
    }
    if (alreadyPlaying.playing && appleDeveloperToken.current) {
      const now = readAppleMusicNowPlaying();
      if (!now.playing) {
        try {
          await resumeAppleMusicPlayback(appleDeveloperToken.current);
        } catch {
          // MusicKit may need another Play tap after an OS pause
        }
      }
      applyApplePlayback(readAppleMusicNowPlaying());
    } else {
      const nowPlaying = readAppleMusicNowPlaying();
      if (nowPlaying.playing) applyApplePlayback(nowPlaying);
    }
    const permission = await readGeoPermission();
    if (locationOn || lastLocation.current || permission === "granted") {
      startLocationWatch(false);
    } else if (permission !== "denied") {
      startLocationWatch(true);
    }
    return session;
  }

  // Voice start/stop must never pause or unload a watch-together video.

  async function stopSession() {
    const persisted = readVoiceSessionStore();
    releaseVision(undefined, true);
    stopLocationWatch();
    backgroundAudio.current.stop();
    sessionRef.current?.stop();
    clearSession();
    // Hang up: drop previousSessionId + transcript. Keep userId for recalled facts.
    clearCallContinuityStore();
    void refreshVoiceBalance();
    if (persisted.sessionId && (persisted.userId || accountId)) {
      void fetch("/api/memory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-lexi-user-id": persisted.userId || accountId,
          "ngrok-skip-browser-warning": "1",
        },
        body: JSON.stringify({
          userId: persisted.userId || accountId,
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
      if (!session) return;
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
  const callNow = callTick ? Date.now() : Date.now();
  const callLeftSeconds =
    live && callCapAtMs
      ? Math.max(0, Math.floor((callCapAtMs - callNow) / 1000) + callLeftover)
      : null;
  const callLeftLabel =
    callLeftSeconds == null
      ? ""
      : callLeftSeconds >= 60
        ? `${Math.floor(callLeftSeconds / 60)}m ${callLeftSeconds % 60}s left`
        : `${callLeftSeconds}s left`;
  const gameHasFocus = tabHidden || windowBlurred;
  const hasUnsent = chips.some((chip) => !chip.sent);
  const hasText = draft.trim().length > 0 || hasUnsent;
  const latestText =
    caption ||
    (phase === "speaking"
      ? ""
      : [...rows].reverse().find((row) => row.text.trim())?.text) ||
    "";
  const placeholder = live ? HINTS[phase] : HINTS.idle;
  const status = error
    ? error
    : live
      ? `${gameHasFocus ? "Still live while Fortnite or another app is up. " : ""}${
          sessionId ? `${HINTS[phase]} · session ${sessionId}` : HINTS[phase]
        }`
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
      <header className="relative z-10 flex items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <p className="text-sm font-medium uppercase tracking-[0.22em]">Lexi</p>
        {accountId ? (
          <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-zinc-600 dark:text-zinc-300">
            <span>
              Signed in as <strong className="font-medium text-foreground">{accountId}</strong>
              {isAdminUserId(accountId) ? " · admin" : ""}
              {live && callLeftLabel
                ? ` · ${callLeftLabel}`
                : voiceSeconds != null
                  ? ` · ${voiceLabel || `${voiceSeconds}s`}`
                  : ""}
            </span>
            <a
              href="/buy"
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Buy minutes
            </a>
            <a
              href="/subscribe"
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Subscribe
            </a>
            <a
              href="/refund"
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Refunds
            </a>
            <a
              href="/privacy"
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Privacy
            </a>
            <a
              href="/terms"
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Terms
            </a>
            <button
              type="button"
              onClick={signOutAccount}
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Sign out
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <a
              href="/buy"
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Buy minutes
            </a>
            <a
              href="/subscribe"
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Subscribe
            </a>
            <a
              href="/refund"
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Refunds
            </a>
            <a
              href="/privacy"
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Privacy
            </a>
            <a
              href="/terms"
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200"
            >
              Terms
            </a>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">Sign in below</p>
          </div>
        )}
      </header>
      <main className={`relative z-10 flex flex-1 flex-col items-center px-6 ${WATCH_UI_ENABLED && (videoSrc || watchRemote) ? "justify-end pb-2" : "justify-center"}`}>
        <p className="mb-4 font-mono text-xs uppercase tracking-[0.28em] text-zinc-500">
          /ˈlek.si/
        </p>
        <h1 className="text-6xl font-semibold tracking-tight sm:text-7xl">Lexi</h1>
        {channelNames.length ? (
          <p className="mt-3 text-[11px] uppercase tracking-[0.16em] text-zinc-500">
            Also on {channelNames.join(" · ")}
          </p>
        ) : null}
        <p
          data-stream-tick={streamTick}
          className="mt-6 min-h-8 max-w-md text-center text-lg leading-8 text-zinc-600 dark:text-zinc-400"
        >
          {error
            ? error
            : rehearsal && accountId && !live
              ? "Rehearsal is free practice. Buy minutes for a live Call."
              : buyIntent && !accountId
                ? "Sign in to buy Whisper, Murmur, or Echo."
                : latestText || (accountId ? "A voice-first companion." : "Sign in to talk.")}
        </p>
        {(rehearsal && accountId && !live) || (buyIntent && !live) ? (
          <section className="mt-6 flex w-full max-w-4xl flex-col items-center" aria-label="Rehearsal">
            <p className="text-xs font-medium uppercase tracking-[0.22em] text-zinc-500">
              {rehearsal && accountId ? "Rehearsal" : "Minutes"}
            </p>
            <Link
              href="/buy"
              className="mt-4 rounded-full bg-pink-400 px-6 py-3 text-sm font-semibold text-zinc-950"
            >
              Buy
            </Link>
            {!stripeConfigured ? (
              <p className="mt-4 max-w-md text-center text-sm text-zinc-500">
                Checkout is not configured yet. Whisper, Murmur, and Echo are listed below.
              </p>
            ) : null}
            {buyPacks.length ? (
              <BuyPacks packs={buyPacks} signedIn={Boolean(accountId)} className="mt-8 w-full" />
            ) : null}
          </section>
        ) : null}
        {!accountId ? (
          <form
            noValidate
            onSubmit={submitAccount}
            className="mt-6 w-full max-w-md rounded-3xl border-2 border-zinc-900 bg-background/95 p-5 shadow-xl dark:border-white dark:bg-zinc-950/95"
          >
            <p className="text-lg font-semibold tracking-tight">
              {accountPanel === "forgot"
                ? "Forgot password"
                : accountPanel === "reset"
                  ? "Set a new password"
                  : accountMode === "signup"
                    ? "Create an account"
                    : "Sign in to talk"}
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {accountPanel === "forgot"
                ? "We send a one-time reset link to the email on the account. The current password cannot be emailed."
                : accountPanel === "reset"
                  ? "Check your email and return with the reset code, then choose a new password."
                  : accountMode === "signup"
                    ? "Username, email, and a password of at least 8 characters."
                    : "Username and password. Email is optional on sign-in."}
            </p>
            <div className="mt-4 grid grid-cols-2 rounded-full bg-zinc-100 p-1 text-sm font-medium dark:bg-zinc-800">
              <button
                type="button"
                onClick={() => openAccountAuth("signin")}
                className={`rounded-full px-3 py-2 ${
                  accountPanel === "auth" && accountMode === "signin"
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "text-zinc-600 dark:text-zinc-300"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => openAccountAuth("signup")}
                className={`rounded-full px-3 py-2 ${
                  accountPanel === "auth" && accountMode === "signup"
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "text-zinc-600 dark:text-zinc-300"
                }`}
              >
                Create account
              </button>
            </div>
            {accountPanel !== "reset" ? (
              <label className="mt-4 flex flex-col gap-1.5 text-sm font-medium">
                Username
                <input
                  value={accountDraft}
                  onChange={(event) => setAccountDraft(event.target.value)}
                  placeholder="username"
                  autoComplete="username"
                  className="rounded-2xl border border-zinc-400 bg-transparent px-4 py-3 text-base font-normal outline-none focus:border-zinc-900 dark:border-zinc-500 dark:focus:border-white"
                />
              </label>
            ) : null}
            {accountPanel !== "reset" ? (
              <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium">
                Email{accountMode === "signin" && accountPanel === "auth" ? " (optional)" : ""}
                <input
                  type="text"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={accountEmail}
                  onChange={(event) => setAccountEmail(event.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="rounded-2xl border border-zinc-400 bg-transparent px-4 py-3 text-base font-normal outline-none focus:border-zinc-900 dark:border-zinc-500 dark:focus:border-white"
                />
              </label>
            ) : null}
            {accountPanel === "reset" ? (
              <label className="mt-4 flex flex-col gap-1.5 text-sm font-medium">
                Reset code
                <input
                  value={accountResetToken}
                  onChange={(event) => setAccountResetToken(event.target.value.toUpperCase())}
                  placeholder="Reset code from your email"
                  autoComplete="one-time-code"
                  className="rounded-2xl border border-zinc-400 bg-transparent px-4 py-3 text-base font-normal tracking-[0.12em] outline-none focus:border-zinc-900 dark:border-zinc-500 dark:focus:border-white"
                />
              </label>
            ) : null}
            {accountPanel !== "forgot" ? (
              <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium">
                {accountPanel === "reset" ? "New password" : "Password"}
                <input
                  type="password"
                  value={accountPassword}
                  onChange={(event) => setAccountPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete={
                    accountMode === "signup" || accountPanel === "reset" ? "new-password" : "current-password"
                  }
                  className="rounded-2xl border border-zinc-400 bg-transparent px-4 py-3 text-base font-normal outline-none focus:border-zinc-900 dark:border-zinc-500 dark:focus:border-white"
                />
              </label>
            ) : null}
            {accountPanel === "reset" || (accountPanel === "auth" && accountMode === "signup") ? (
              <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium">
                Confirm password
                <input
                  type="password"
                  value={accountConfirm}
                  onChange={(event) => setAccountConfirm(event.target.value)}
                  placeholder="Type it again"
                  autoComplete="new-password"
                  className="rounded-2xl border border-zinc-400 bg-transparent px-4 py-3 text-base font-normal outline-none focus:border-zinc-900 dark:border-zinc-500 dark:focus:border-white"
                />
              </label>
            ) : null}
            {accountNotice ? (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-300">{accountNotice}</p>
            ) : null}
            {accountError ? <p className="mt-3 text-sm text-red-500">{accountError}</p> : null}
            <button
              type="submit"
              disabled={accountPending}
              className="mt-5 w-full rounded-full bg-zinc-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
            >
              {accountPending
                ? accountPanel === "forgot"
                  ? "Sending reset email…"
                  : accountPanel === "reset"
                    ? "Updating password…"
                    : accountMode === "signup"
                      ? "Creating account…"
                      : "Signing in…"
                : accountPanel === "forgot"
                  ? "Send reset email"
                  : accountPanel === "reset"
                    ? "Set new password"
                    : accountMode === "signup"
                      ? "Create account"
                      : "Sign in"}
            </button>
            {accountPanel === "auth" && accountMode === "signin" ? (
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setAccountError(null);
                    setAccountNotice(null);
                    setAccountPanel("forgot");
                  }}
                  className="w-full text-center text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
                >
                  Forgot password?
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setAccountError(null);
                    setAccountPanel("reset");
                  }}
                  className="w-full text-center text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
                >
                  I have a reset code
                </button>
              </div>
            ) : null}
            {accountPanel === "forgot" ? (
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setAccountError(null);
                  setAccountPanel("reset");
                }}
                className="mt-3 w-full text-center text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
              >
                I already have a reset code
              </button>
            ) : null}
            {accountPanel !== "auth" ? (
              <button
                type="button"
                onClick={() => openAccountAuth("signin")}
                className="mt-2 w-full text-center text-sm font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-300"
              >
                Back to sign in
              </button>
            ) : null}
          </form>
        ) : null}
      </main>
      <div className="relative z-10 w-full px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))] sm:px-6">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
          {WATCH_UI_ENABLED && watchRemote ? (
            <div className="rounded-2xl border border-zinc-400 bg-background px-3 py-2 shadow-md dark:border-zinc-500">
              <p className="truncate text-xs font-medium text-foreground">
                Watching from other tab
                {watchRemote.title ? ` · ${watchRemote.title}` : ""}
              </p>
              <p className="text-[11px] text-zinc-500">
                Keep both tabs. Lexi sees stills from that player
                {watchRemote.hasAudio
                  ? "; soundtrack stays in the watch tab, not your mic."
                  : "; soundtrack may be absent."}
              </p>
            </div>
          ) : null}
          {WATCH_UI_ENABLED && videoSrc ? (
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
                  if (shot) {
                    videoFrames.current.push(shot);
                    if (!watchTabActiveRef.current) {
                      visionBatcher.current.push({
                        source: "watch",
                        dataUrl: shot.dataUrl,
                        timeSec: shot.timeSec,
                      });
                    }
                  }
                }}
                onError={() => {
                  const raw = videoDraft.trim();
                  const proxy = playableVideoSrc(raw);
                  if (
                    videoMeta.current.source === "url" &&
                    !videoProxyTried.current &&
                    proxy &&
                    proxy !== videoSrcRef.current
                  ) {
                    videoProxyTried.current = true;
                    loadVideoSrc(proxy, titleFromVideoUrl(raw), "url");
                    return;
                  }
                  setVideoHint(
                    "Could not play that video here. Open the watch tab for avi/flv/wmv/mpeg, or use a direct mp4/webm URL.",
                  );
                }}
              />
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">
                    {videoTitle || "Watch together"}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    Headphones recommended — Lexi hears your mic only, not the video.
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
          ) : WATCH_UI_ENABLED ? (
            <>
              <a
                href={watchTabHref(videoDraft)}
                target="lexi-watch"
                rel="noreferrer"
                className={`flex w-full items-center justify-center rounded-full border border-zinc-400 bg-background text-sm font-medium text-foreground shadow-md dark:border-zinc-500 ${phoneWatch ? "h-12" : "h-10"}`}
              >
                Open watch tab
              </a>
              <p className="px-1 text-[11px] text-zinc-500">
                Phone: keep this tab talking. Play the video in the other tab — tap play there if it
                does not start. She sees stills; soundtrack stays in the watch tab.
              </p>
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
                  aria-label="Upload a video"
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
                  placeholder="Direct mp4/webm — streams in watch tab"
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
            </>
          ) : null}
          {WATCH_UI_ENABLED && videoHint ? (
            <p className="px-1 text-xs text-zinc-500">{videoHint}</p>
          ) : null}
          <div className="flex items-end justify-between gap-3">
            {cameraOn || screenOn ? (
              <div className="flex items-end gap-2">
                {screenOn ? (
                  <video
                    ref={screenVideoRef}
                    muted
                    playsInline
                    autoPlay
                    className="h-[4.5rem] w-32 rounded-xl border border-zinc-400 bg-black object-cover shadow-md dark:border-zinc-500"
                    aria-label="Shared tab or screen"
                  />
                ) : null}
                {cameraOn ? (
                  <div className="relative h-[4.5rem] w-24 shrink-0">
                    <video
                      ref={cameraVideoRef}
                      muted
                      playsInline
                      autoPlay
                      className={`h-[4.5rem] w-24 rounded-xl border border-zinc-400 object-cover shadow-md dark:border-zinc-500 ${cameraFacing === "user" ? "-scale-x-100" : ""}`}
                      aria-label={
                        cameraFacing === "user" ? "Front camera viewfinder" : "Rear camera viewfinder"
                      }
                    />
                    <button
                      type="button"
                      aria-label={
                        cameraFacing === "user" ? "Switch to rear camera" : "Switch to front camera"
                      }
                      title={cameraFacing === "user" ? "Rear camera" : "Front camera"}
                      onClick={() => void flipCamera()}
                      className="absolute right-1 bottom-1 flex h-7 w-7 items-center justify-center rounded-full border border-zinc-400 bg-background/90 text-foreground dark:border-zinc-500"
                    >
                      <FlipCameraIcon />
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {screenOn || (cameraOn && phase !== "idle") ? (
                <span className="rounded-full border border-zinc-400 px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] text-zinc-600 dark:border-zinc-500 dark:text-zinc-300">
                  Sharing
                </span>
              ) : null}
              {canShare ? (
                <button
                  type="button"
                  aria-pressed={screenOn}
                  aria-label={screenOn ? "Stop sharing tab" : "Share a tab or screen"}
                  title={screenOn ? "Stop sharing" : "Share a tab or screen"}
                  onClick={() => toggleVision("screen")}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-400 bg-background text-foreground transition-colors hover:bg-zinc-100 dark:border-zinc-500 dark:hover:bg-zinc-800 ${screenOn ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
                >
                  <ScreenShareIcon />
                </button>
              ) : null}
              <button
                type="button"
                aria-pressed={cameraOn}
                aria-label={cameraOn ? "Stop sharing camera" : "Share camera"}
                title={cameraOn ? "Stop sharing camera" : "Share camera"}
                onClick={() => toggleVision("camera")}
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-zinc-400 bg-background text-foreground transition-colors hover:bg-zinc-100 dark:border-zinc-500 dark:hover:bg-zinc-800 ${cameraOn ? "bg-zinc-100 dark:bg-zinc-800" : ""}`}
              >
                <CameraIcon />
              </button>
            </div>
          </div>
          {visionHint ? (
            <p className="text-right text-xs text-zinc-500">{visionHint}</p>
          ) : cameraOn && phase === "idle" ? (
            <p className="text-right text-xs text-zinc-500">Connect so Lexi can see this camera.</p>
          ) : null}
          {screenOn ? (
            <p className="text-right text-xs text-zinc-500">
              Lexi is watching this live share. Check Share tab audio in Chrome so she can hear it too.
            </p>
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
                      {chip.kind === "video" ? "vid" : "file"}
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
          {attachBusy ? (
            <p className="px-1 text-xs text-zinc-500">{attachBusy}</p>
          ) : null}
          {attachError ? (
            <p className="px-1 text-xs text-red-600 dark:text-red-400">{attachError}</p>
          ) : null}
          {generated.length ? (
            <ul className="flex flex-col gap-2">
              {generated.map((item) => (
                <li
                  key={item.id}
                  className="overflow-hidden rounded-2xl border border-zinc-400 bg-background shadow-md dark:border-zinc-500"
                >
                  {item.kind === "image" && (item.dataUrl || item.url) ? (
                    <img
                      src={item.dataUrl || item.url}
                      alt={item.prompt.slice(0, 120)}
                      className="max-h-80 w-full object-contain bg-black"
                    />
                  ) : null}
                  {item.kind === "video" && item.status === "done" && item.url ? (
                    <video
                      src={item.url}
                      controls
                      playsInline
                      preload="metadata"
                      className="aspect-video w-full bg-black"
                      aria-label={item.prompt.slice(0, 120)}
                      onLoadedData={(event) => {
                        if (generatedStills.current.has(item.id)) return;
                        const video = event.currentTarget;
                        if (!video.videoWidth) return;
                        const shot = captureVideoShot(video);
                        if (!shot?.dataUrl) return;
                        generatedStills.current.add(item.id);
                        sessionRef.current?.sendGeneratedStill(
                          shot.dataUrl,
                          "You generated this video. This is a still from the first frame. Look at it.",
                        );
                      }}
                    />
                  ) : null}
                  <div className="px-3 py-2">
                    <p className="truncate text-xs text-foreground">{item.prompt}</p>
                    <p className="text-[11px] text-zinc-500">
                      {item.status === "pending"
                        ? `Making a ${item.kind}…`
                        : item.status === "failed"
                          ? item.error || `${item.kind} failed.`
                          : item.kind === "video"
                            ? "Generated video"
                            : "Generated photo"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex min-w-0 items-center gap-2">
              <LiveClock />
              {live ? (
                micResume ? (
                  <button
                    type="button"
                    onClick={() => void sessionRef.current?.reclaim()}
                    className="rounded-full px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-foreground dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Tap to resume mic
                  </button>
                ) : (
                  <p className="truncate text-[11px] text-zinc-500">
                    {gameHasFocus
                      ? "Still live — talk while Fortnite is up."
                      : WATCH_UI_ENABLED
                        ? "Stays live if you switch to Fortnite, change tabs, or open the watch tab."
                        : "Stays live if you switch to Fortnite or change tabs."}
                  </p>
                )
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={toggleLocation}
                className="rounded-full px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-foreground dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {locationOn ? "Location on" : "Share location"}
              </button>
              <button
                type="button"
                disabled={appleBusy}
                onClick={() => {
                  if (music.appleConnected) {
                    void disconnectAppleMusic();
                    return;
                  }
                  void connectAppleMusic();
                }}
                className="rounded-full px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-foreground disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {music.appleConnected ? "Disconnect Apple Music" : "Connect Apple Music"}
              </button>
              {live && toyGrantPending && !toyControl ? (
                <button
                  type="button"
                  onClick={() => {
                    sessionRef.current?.setUserToyControl(true);
                  }}
                  className="rounded-full px-2 py-1 text-[11px] text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-foreground dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Give Lexi toy control
                </button>
              ) : null}
            </div>
          </div>
          {locationHint ? (
            <p className="px-1 text-[11px] text-zinc-500">{locationHint}</p>
          ) : null}
          {music.appleConnected ? (
            <AppleMusicBar
              connected={music.appleConnected}
              playing={music.playing && music.source !== "url"}
              title={music.source === "apple" ? music.title : ""}
              query={musicQuery}
              busy={appleBusy}
              hint={appleHint}
              onQueryChange={setMusicQuery}
              onPlayPause={onApplePlayPause}
              onNext={onAppleNext}
            />
          ) : null}
          {appleHint && !music.appleConnected ? (
            <p className="px-1 text-[11px] text-zinc-500">{appleHint}</p>
          ) : null}
          {music.playing && !music.appleConnected ? (
            <p className="px-1 text-[11px] text-zinc-500">Playing: {music.title || "music"}</p>
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
            aria-label="Add photo, video, or file"
            title="Add photo or video"
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
