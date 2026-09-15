/**
 * Keep the same Grok realtime voice session usable in the background.
 *
 * Desktop Chrome: resume AudioContext, keep getUserMedia, near-silent media
 * session, ping the socket, reconnect in-place.
 *
 * iOS Chrome (CriOS) is WebKit/WKWebView, not Chromium — same APIs as iOS
 * Safari. A looping keep-alive the OS still counts as playing is the hold.
 * Leaving Chrome, locking the phone, or letting Music/YouTube/phone take
 * audio often still kills the mic while fully backgrounded. On foreground
 * or interruption end, reclaim AudioContext + mic + socket automatically.
 *
 * Keep-alive audio is destination / HTMLMediaElement only. It must never be
 * mixed into the mic MediaStream or input_audio_buffer.
 *
 * Game coexistence (Fortnite in the foreground on the same machine): treat
 * hide/blur/AudioContext interrupted like an iOS audio-session interrupt —
 * keep the WebSocket, keep play-and-record, do not hang up. Desktop Chrome
 * uses shared-mode Web Audio (never exclusive WASAPI). If the game takes the
 * mic exclusively, show Tap to resume and auto-reclaim on focus / devicechange.
 */

export const MEDIA_SESSION_TITLE = "Lexi";
export const KEEPALIVE_INTERVAL_MS = 4000;
export const IOS_KEEPALIVE_INTERVAL_MS = 2000;
export const KEEPALIVE_SILENCE_MS = 20;
export const IOS_KEEPALIVE_HZ = 48;
export const IOS_KEEPALIVE_AMP = 180;
export const PLAY_AND_RECORD_TYPES = ["play-and-record", "playAndRecord"] as const;
export const AUDIO_SESSION_INTERRUPT_EVENTS = [
  "statechange",
  "interruptionbegin",
  "interruptionend",
  "begininterruption",
  "endinterruption",
] as const;
export const BACKGROUND_KEEP_EVENTS = [
  "visibilitychange",
  "webkitvisibilitychange",
  "blur",
  "focus",
  "freeze",
  "resume",
  "pageshow",
  "pagehide",
] as const;
export const GAME_FOREGROUND_EVENTS = [
  "visibilitychange",
  "webkitvisibilitychange",
  "blur",
  "audiocontextinterrupted",
  "devicechange",
] as const;
export const EXCLUSIVE_MIC_ERROR_NAMES = [
  "NotReadableError",
  "AbortError",
  "NotAllowedError",
  "SecurityError",
  "OverconstrainedError",
] as const;
/** Duck Lexi under game audio — never mute unless the OS forces it. */
export const PLAYBACK_DUCK_GAIN = 0.42;
export const PLAYBACK_FULL_GAIN = 1;

export function isIOSWebKit(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent,
  extras?: { maxTouchPoints?: number; platform?: string },
) {
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  const platform =
    extras?.platform ?? (typeof navigator === "undefined" ? "" : navigator.platform);
  const points =
    extras?.maxTouchPoints ?? (typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints);
  return platform === "MacIntel" && points > 1;
}

export function isIOSChrome(ua = typeof navigator === "undefined" ? "" : navigator.userAgent) {
  return isIOSWebKit(ua) && /CriOS/i.test(ua);
}

export function shouldDisconnectForLifecycle(event: {
  type: string;
  persisted?: boolean;
}) {
  const type = event.type;
  if (
    type === "visibilitychange" ||
    type === "webkitvisibilitychange" ||
    type === "blur" ||
    type === "focus" ||
    type === "freeze" ||
    type === "resume" ||
    type === "pageshow" ||
    type === "pagehide"
  ) {
    return false;
  }
  return type === "beforeunload";
}

export function shouldReclaimForLifecycle(event: {
  type: string;
  visibilityState?: string;
  audioSessionState?: string;
}) {
  const type = event.type.toLowerCase();
  if (type === "interruptionbegin" || type === "begininterruption") return false;
  if (type === "interruptionend" || type === "endinterruption") return true;
  if (type === "statechange") return event.audioSessionState !== "interrupted";
  if (type === "pageshow" || type === "resume" || type === "focus" || type === "online") {
    return true;
  }
  if (type === "visibilitychange" || type === "webkitvisibilitychange") {
    return event.visibilityState !== "hidden";
  }
  return false;
}

export function shouldPauseKeepAliveOnHide() {
  return false;
}

export function buildKeepAliveWavDataUrl(
  seconds = 1.5,
  sampleRate = 8000,
  opts?: { hz?: number; amp?: number },
) {
  const hz = opts?.hz ?? 19;
  const amp = opts?.amp ?? 40;
  const samples = Math.max(1, Math.floor(seconds * sampleRate));
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  // Non-zero tone so WebKit/Chromium do not treat the buffer as digital silence.
  for (let i = 0; i < samples; i += 1) {
    const sample = Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * amp);
    view.setInt16(44 + i * 2, sample, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}

export type WebAudioSession = {
  type: string;
  state: string;
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
};

export function readAudioSession(): WebAudioSession | null {
  try {
    const session = (navigator as Navigator & { audioSession?: WebAudioSession }).audioSession;
    return session ?? null;
  } catch {
    return null;
  }
}

export function isAudioSessionInterrupted(state?: string) {
  const current = state ?? readAudioSession()?.state;
  return current === "interrupted";
}

export function isAudioContextInterrupted(state?: string) {
  return state === "interrupted";
}

/** iOS audioSession or desktop AudioContext stolen by another app (a game). */
export function isVoiceAudioInterrupted(opts?: {
  audioSessionState?: string;
  audioContextState?: string;
}) {
  if (isAudioSessionInterrupted(opts?.audioSessionState)) return true;
  return isAudioContextInterrupted(opts?.audioContextState);
}

export function isExclusiveMicError(error: unknown) {
  if (typeof error === "string") {
    return (EXCLUSIVE_MIC_ERROR_NAMES as readonly string[]).includes(error);
  }
  const name =
    error && typeof error === "object" && "name" in error && typeof error.name === "string"
      ? error.name
      : "";
  return (EXCLUSIVE_MIC_ERROR_NAMES as readonly string[]).includes(name);
}

/**
 * Fortnite (or another game) has OS focus / stole the audio session.
 * Hold the socket. Do not treat this as hang-up.
 */
export function isGameLikeForeground(event: {
  type?: string;
  visibilityState?: string;
  audioContextState?: string;
  audioSessionState?: string;
  pageHidden?: boolean;
  blurred?: boolean;
}) {
  if (event.audioSessionState === "interrupted") return true;
  if (event.audioContextState === "interrupted") return true;
  if (event.pageHidden || event.blurred) return true;
  const type = (event.type ?? "").toLowerCase();
  if (type === "blur" || type === "audiocontextinterrupted") return true;
  if (type === "visibilitychange" || type === "webkitvisibilitychange") {
    return event.visibilityState === "hidden";
  }
  if (type === "interruptionbegin" || type === "begininterruption") return true;
  return false;
}

export function shouldDuckPlaybackForCoexist(opts: {
  pageHidden?: boolean;
  blurred?: boolean;
  audioContextState?: string;
  audioSessionState?: string;
  musicPlaying?: boolean;
  /** iOS hidden/blur is CarPlay or lock screen — Lexi is the speaker, not Fortnite. */
  ios?: boolean;
}) {
  if (opts.musicPlaying) return true;
  if (opts.audioSessionState === "interrupted") return true;
  if (opts.audioContextState === "interrupted") return true;
  // Ducking on hide was for a desktop game stealing the tab. On iPhone,
  // hidden + play-and-record is CarPlay / lock screen: keep full volume so
  // iOS does not mix a ducked Web Audio graph on top of the car path.
  if (opts.ios && (opts.pageHidden || opts.blurred)) return false;
  return Boolean(opts.pageHidden || opts.blurred);
}

export function playbackGainForCoexist(ducked: boolean) {
  return ducked ? PLAYBACK_DUCK_GAIN : PLAYBACK_FULL_GAIN;
}

export function shouldReclaimAfterExclusiveRelease(event: {
  type: string;
  visibilityState?: string;
  audioSessionState?: string;
  audioContextState?: string;
}) {
  const type = event.type.toLowerCase();
  if (type === "devicechange") return true;
  if (
    event.audioContextState === "running" &&
    (type === "statechange" || type === "audiocontextstatechange")
  ) {
    return true;
  }
  return shouldReclaimForLifecycle(event);
}

export function applyPlayAndRecordSession() {
  const session = readAudioSession();
  if (!session) return false;
  for (const type of PLAY_AND_RECORD_TYPES) {
    try {
      session.type = type;
      if (session.type === "play-and-record" || session.type === type) return true;
    } catch {
      // try the camelCase alias used by some WebKit builds
    }
  }
  return false;
}

let yieldMediaSession = false;

/** When MusicKit (or the user) is playing music, do not steal lock-screen controls. */
export function setMediaSessionYield(yieldToOther: boolean) {
  yieldMediaSession = yieldToOther;
}

export function shouldClaimMediaSession(yieldToOther = yieldMediaSession) {
  return !yieldToOther;
}

export function claimMediaSession() {
  if (!shouldClaimMediaSession()) return;
  const media = navigator.mediaSession;
  if (!media) return;
  try {
    media.metadata = new MediaMetadata({
      title: MEDIA_SESSION_TITLE,
      artist: "Lexi",
      album: "Voice",
    });
    media.playbackState = "playing";
    media.setActionHandler("pause", () => {
      media.playbackState = "playing";
    });
    media.setActionHandler("play", () => {
      media.playbackState = "playing";
    });
    media.setActionHandler("stop", () => {
      media.playbackState = "playing";
    });
  } catch {
    // Media Session is best-effort.
  }
}

export function releaseMediaSession() {
  const media = navigator.mediaSession;
  if (!media) return;
  try {
    media.playbackState = "none";
    media.metadata = null;
    media.setActionHandler("pause", null);
    media.setActionHandler("play", null);
    media.setActionHandler("stop", null);
  } catch {
    // ignore
  }
}

let previousTitle: string | null = null;

export function setLiveTabTitle(live: boolean) {
  if (typeof document === "undefined") return;
  if (live) {
    if (previousTitle === null) previousTitle = document.title;
    document.title = "Lexi · live";
    return;
  }
  if (previousTitle !== null) {
    document.title = previousTitle;
    previousTitle = null;
  }
}

export function pageIsHidden() {
  if (typeof document === "undefined") return false;
  const doc = document as Document & { webkitHidden?: boolean };
  return document.visibilityState === "hidden" || doc.webkitHidden === true;
}

export type VoiceCoexistState = {
  hidden: boolean;
  blurred: boolean;
  interrupted: boolean;
  ducked: boolean;
};

export type VoiceKeepAliveHandlers = {
  resumeAudio: () => Promise<void> | void;
  ensureMic: () => Promise<void> | void;
  ping: () => void;
  reclaim?: () => Promise<void> | void;
  onUnload?: () => void;
  onCoexist?: (state: VoiceCoexistState) => void;
  audioContextState?: () => string | undefined;
};

export function installVoiceKeepAlive(handlers: VoiceKeepAliveHandlers) {
  applyPlayAndRecordSession();
  const ios = isIOSWebKit();
  const media = startHtmlKeepAlive(ios);
  claimMediaSession();
  setLiveTabTitle(true);
  let wake: WakeLockSentinel | null = null;
  let reclaiming = false;
  let blurred = false;

  const voiceInterrupted = () =>
    isVoiceAudioInterrupted({
      audioContextState: handlers.audioContextState?.(),
    });

  const publishCoexist = () => {
    const hidden = pageIsHidden();
    const audioContextState = handlers.audioContextState?.();
    const interrupted = isVoiceAudioInterrupted({ audioContextState });
    handlers.onCoexist?.({
      hidden,
      blurred,
      interrupted,
      ducked: shouldDuckPlaybackForCoexist({
        pageHidden: hidden,
        blurred,
        audioContextState,
        ios,
      }),
    });
  };

  const hold = () => {
    applyPlayAndRecordSession();
    void handlers.resumeAudio();
    media.ensurePlaying();
    claimMediaSession();
    handlers.ping();
  };

  const tick = () => {
    hold();
    if (!voiceInterrupted()) void handlers.ensureMic();
    void requestLock();
    publishCoexist();
  };

  const reclaim = () => {
    if (reclaiming || voiceInterrupted()) {
      hold();
      publishCoexist();
      return;
    }
    reclaiming = true;
    const run = handlers.reclaim ?? tick;
    void Promise.resolve(run()).finally(() => {
      reclaiming = false;
      publishCoexist();
    });
  };

  async function requestLock() {
    try {
      if (!navigator.wakeLock || pageIsHidden()) return;
      if (wake && !wake.released) return;
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => {
        wake = null;
        if (!pageIsHidden()) void requestLock();
      });
    } catch {
      // Unsupported, battery saver, or denied.
    }
  }

  const onForeground = () => {
    blurred = false;
    reclaim();
  };

  const onBackground = () => {
    // Never pause the keep-alive element — iOS suspends JS if it thinks media stopped.
    // Game in the foreground is the same hold: keep the socket, keep trying play-and-record.
    blurred = true;
    hold();
    publishCoexist();
  };

  const onVisibility = () => {
    if (pageIsHidden()) onBackground();
    else onForeground();
  };

  const onAudioSession = (event: Event) => {
    applyPlayAndRecordSession();
    const type = event.type.toLowerCase();
    const interrupted =
      type === "interruptionbegin" ||
      type === "begininterruption" ||
      voiceInterrupted();
    if (interrupted) {
      hold();
      publishCoexist();
      return;
    }
    reclaim();
  };

  const onUnload = () => {
    handlers.onUnload?.();
  };

  const onDeviceChange = () => {
    if (!voiceInterrupted()) void handlers.ensureMic();
  };

  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("webkitvisibilitychange", onVisibility);
  window.addEventListener("pageshow", onForeground);
  window.addEventListener("focus", onForeground);
  window.addEventListener("online", onForeground);
  window.addEventListener("blur", onBackground);
  window.addEventListener("pagehide", onBackground);
  window.addEventListener("freeze", onBackground);
  window.addEventListener("resume", onForeground);
  window.addEventListener("beforeunload", onUnload);
  navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);

  const audioSession = readAudioSession();
  if (audioSession) {
    for (const name of AUDIO_SESSION_INTERRUPT_EVENTS) {
      audioSession.addEventListener(name, onAudioSession);
    }
  }

  const interval = window.setInterval(tick, ios ? IOS_KEEPALIVE_INTERVAL_MS : KEEPALIVE_INTERVAL_MS);
  void requestLock();
  tick();

  return () => {
    window.clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
    document.removeEventListener("webkitvisibilitychange", onVisibility);
    window.removeEventListener("pageshow", onForeground);
    window.removeEventListener("focus", onForeground);
    window.removeEventListener("online", onForeground);
    window.removeEventListener("blur", onBackground);
    window.removeEventListener("pagehide", onBackground);
    window.removeEventListener("freeze", onBackground);
    window.removeEventListener("resume", onForeground);
    window.removeEventListener("beforeunload", onUnload);
    navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
    if (audioSession) {
      for (const name of AUDIO_SESSION_INTERRUPT_EVENTS) {
        audioSession.removeEventListener(name, onAudioSession);
      }
    }
    try {
      void wake?.release();
    } catch {
      // ignore
    }
    wake = null;
    media.stop();
    releaseMediaSession();
    setLiveTabTitle(false);
  };
}

function startHtmlKeepAlive(ios: boolean) {
  const audio = new Audio(
    buildKeepAliveWavDataUrl(ios ? 2 : 1.5, 8000, {
      hz: ios ? IOS_KEEPALIVE_HZ : 19,
      amp: ios ? IOS_KEEPALIVE_AMP : 40,
    }),
  );
  audio.loop = true;
  audio.preload = "auto";
  audio.setAttribute("playsinline", "");
  audio.setAttribute("webkit-playsinline", "");
  audio.setAttribute("aria-hidden", "true");
  // iOS often ignores element.volume — encode level in the WAV instead.
  // Must not be muted or display:none; either can drop the playing session.
  audio.volume = ios ? 1 : 0.001;
  audio.style.cssText =
    "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0";
  try {
    document.body.appendChild(audio);
  } catch {
    // body may be missing during early start
  }

  let stopped = false;
  const ensurePlaying = () => {
    if (stopped) return;
    applyPlayAndRecordSession();
    if (audio.paused || audio.ended) void audio.play().catch(() => {});
  };
  const onPause = () => {
    if (!stopped) void audio.play().catch(() => {});
  };
  audio.addEventListener("pause", onPause);
  audio.addEventListener("ended", onPause);
  ensurePlaying();
  return {
    ensurePlaying,
    stop: () => {
      stopped = true;
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onPause);
      audio.pause();
      audio.removeAttribute("src");
      try {
        audio.load();
      } catch {
        // ignore
      }
      audio.remove();
    },
  };
}

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}
