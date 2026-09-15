/**
 * Reacquire the user mic after iOS Safari / AirPods route changes
 * without tearing down the Grok realtime socket.
 *
 * AirPods + app switch typically: track `ended` or `muted`, `devicechange`,
 * and AudioContext `interrupted`. getUserMedia while `document.hidden` fails
 * (often NotAllowedError) — defer until foreground. Do not applyConstraints
 * on a live HFP/CarPlay track (PR #4).
 */

export const MIC_REACQUIRE_DEBOUNCE_MS = 800;
export const MIC_MUTE_SETTLE_MS = 400;

export type MicRecoveryReason =
  | "ended"
  | "mute"
  | "devicechange"
  | "foreground"
  | "focus"
  | "tick"
  | "manual";

export type MicTrackSnapshot = {
  readyState?: string;
  enabled?: boolean;
  muted?: boolean;
};

export type MicErrorKind = "denied" | "exclusive" | "transient" | "unknown";

export function micTrackNeedsReplace(track?: MicTrackSnapshot | null) {
  return !track || track.readyState !== "live" || track.enabled === false || track.muted === true;
}

/** Hidden-tab getUserMedia fails on iOS; CarPlay/HFP must keep the live track. */
export function shouldDeferMicReacquire(opts: {
  pageHidden?: boolean;
  reason: MicRecoveryReason;
}) {
  if (!opts.pageHidden) return false;
  return opts.reason !== "manual";
}

export function shouldForceMicReacquire(opts: {
  reason: MicRecoveryReason;
  trackNeedsReplace: boolean;
  routeChanged?: boolean;
  audioWasInterrupted?: boolean;
  ios?: boolean;
}) {
  if (opts.trackNeedsReplace) return true;
  if (opts.reason === "ended" || opts.reason === "devicechange") return true;
  if (opts.reason === "manual") return true;
  if (opts.reason === "mute" && (opts.ios || opts.trackNeedsReplace)) return true;
  if (
    (opts.reason === "foreground" || opts.reason === "focus") &&
    (opts.routeChanged || opts.audioWasInterrupted)
  ) {
    return true;
  }
  return false;
}

export function shouldAttemptMicOpen(opts: {
  inFlight: boolean;
  lastAttemptMs: number;
  now: number;
  debounceMs?: number;
  permissionDenied?: boolean;
}) {
  if (opts.inFlight) return false;
  if (opts.permissionDenied) return false;
  const gap = opts.debounceMs ?? MIC_REACQUIRE_DEBOUNCE_MS;
  if (opts.lastAttemptMs > 0 && opts.now - opts.lastAttemptMs < gap) return false;
  return true;
}

/**
 * Interrupted AudioContext used to skip reclaim entirely — that left AirPods
 * dead after an app switch. Resume first, then reclaim while visible.
 */
export function shouldBlockReclaimForInterrupt(opts: {
  interrupted?: boolean;
  resumed?: boolean;
  pageHidden?: boolean;
}) {
  if (opts.pageHidden) return true;
  if (opts.resumed) return false;
  return Boolean(opts.interrupted);
}

export function classifyMicError(
  error: unknown,
  opts?: { pageHidden?: boolean; documentHasFocus?: boolean },
): MicErrorKind {
  const name =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "name" in error && typeof error.name === "string"
        ? error.name
        : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (opts?.pageHidden || opts?.documentHasFocus === false) return "transient";
    return "denied";
  }
  if (name === "NotReadableError" || name === "AbortError" || name === "OverconstrainedError") {
    return "exclusive";
  }
  return "unknown";
}

export function shouldPromptMicGesture(kind: MicErrorKind) {
  return kind === "denied" || kind === "exclusive";
}

export function shouldStopRetryingMic(kind: MicErrorKind) {
  return kind === "denied";
}

/** Mic loss must not hang up the realtime socket. */
export function shouldKillSessionForMicError(_kind: MicErrorKind) {
  return false;
}
