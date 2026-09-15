/**
 * Pipeline latency only. Same persona, memory, tools, and reply quality.
 *
 * xAI `session.turn_detection` (docs.x.ai speech-to-speech):
 *   type, threshold, silence_duration_ms, prefix_padding_ms, idle_timeout_ms
 *
 * Do not lower temperature, strip instructions, or shrink answers for speed.
 */

export const VAD_TYPE = "server_vad" as const;
/**
 * Speech-probability gate. 0.5 (xAI default) drops quiet / mumbled words.
 * 0.4 still commits soft speech without stealing the turn (silence stays 400ms).
 */
export const VAD_THRESHOLD = 0.4;
/**
 * End-of-speech silence before she takes the turn.
 * 400ms is a finished-sentence pause, not a mid-clause breath (~200–350ms).
 * Tighter (200–280) would clip Ian mid-thought. We do not go below this.
 */
export const VAD_SILENCE_DURATION_MS = 400;
/** Keep first consonants, including mumbled onsets. Do not lower. */
export const VAD_PREFIX_PADDING_MS = 350;

/** Worklet flush. 100ms was extra hold before the socket; 40ms stays WS-safe. */
export const CAPTURE_CHUNK_MS = 40;
/** Same ~4s pre-open coverage as 40 × 100ms chunks. */
export const PREOPEN_BUFFER_MS = 4000;
export const PREOPEN_CAP = Math.round(PREOPEN_BUFFER_MS / CAPTURE_CHUNK_MS);
/**
 * Playback scheduler lead. Do not cut this — first-word underruns clip speech.
 * First audio still plays on the delta; we do not wait for response.done.
 */
export const PLAY_LEAD_SEC = 0.15;

export function captureFramesForRate(sampleRate: number) {
  return Math.round(sampleRate * (CAPTURE_CHUNK_MS / 1000));
}

export function buildTurnDetection() {
  return {
    type: VAD_TYPE,
    threshold: VAD_THRESHOLD,
    silence_duration_ms: VAD_SILENCE_DURATION_MS,
    prefix_padding_ms: VAD_PREFIX_PADDING_MS,
  };
}

/** Background camera/watch stills wait out thinking so they do not block first audio. */
export function shouldDeferLiveVision(
  phase: "idle" | "connecting" | "listening" | "thinking" | "speaking",
  respond = false,
  sources: Array<"camera" | "screen" | "watch" | "upload"> = [],
) {
  if (respond || phase !== "thinking") return false;
  if (sources.some((source) => source === "upload")) return false;
  return true;
}
