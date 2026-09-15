/**
 * CarPlay / in-car / lock-screen voice routing.
 *
 * There is no CarPlay JavaScript API in this project — do not invent one.
 * Safari (or CriOS) is typically `document.hidden` while audio plays through
 * the car (wired or wireless CarPlay) or the lock screen. Desktop hidden +
 * no camera/screen/watch UI is the same voice-only path for local testing.
 *
 * 48 kHz PCM stays. CarPlay/HFP resamples in the OS; dropping the wire rate
 * would not cut duplex latency and would lose consonants on the phone path.
 */

export type LiveVisionActivity = {
  camera?: boolean;
  screen?: boolean;
  watch?: boolean;
};

export function hasLiveVisionUi(activity: LiveVisionActivity = {}) {
  return Boolean(activity.camera || activity.screen || activity.watch);
}

/**
 * True when Lexi is on a voice-only audio route: CarPlay, lock screen,
 * Control Center, or a hidden tab with no viewfinder / watch surface.
 */
export function isInCarStyleRoute(opts: {
  pageHidden?: boolean;
  ios?: boolean;
  cameraActive?: boolean;
  screenActive?: boolean;
  watchActive?: boolean;
} = {}) {
  if (!opts.pageHidden) return false;
  // iOS background audio ≈ CarPlay / lock screen even if a camera track was
  // left armed — there is no viewfinder in the car.
  if (opts.ios) return true;
  return !hasLiveVisionUi({
    camera: opts.cameraActive,
    screen: opts.screenActive,
    watch: opts.watchActive,
  });
}

/**
 * Live stills have nowhere to go in CarPlay (no camera/screen UI). Uploads
 * and user-asked `respond` frames still send.
 */
export function shouldSendLiveVisionFrames(opts: {
  pageHidden?: boolean;
  source?: "camera" | "screen" | "watch" | "upload";
  respond?: boolean;
  sources?: Array<"camera" | "screen" | "watch" | "upload">;
} = {}) {
  if (opts.respond) return true;
  const sources = opts.sources?.length
    ? opts.sources
    : opts.source
      ? [opts.source]
      : [];
  if (sources.some((source) => source === "upload")) return true;
  if (opts.pageHidden) return false;
  return true;
}

/** Pause JPEG capture when the page is hidden — no viewfinder in the car. */
export function shouldRunVisionCaptureLoop(opts: { pageHidden?: boolean } = {}) {
  return !opts.pageHidden;
}

/**
 * Client RMS→silence was for Fortnite/TV bleed. HFP / CarPlay mics are
 * quieter; eating onset as "silence" delays server VAD by a full chunk+.
 */
export function shouldClientGateMicToSilence(voiceOnly: boolean) {
  return !voiceOnly;
}
