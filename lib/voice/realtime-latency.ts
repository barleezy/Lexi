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
 * 0.4 still commits soft speech without stealing the turn (silence stays 300ms).
 */
export const VAD_THRESHOLD = 0.4;
/**
 * End-of-speech silence before she takes the turn.
 * 300ms is a finished-sentence pause, not a mid-clause breath (~200–250ms).
 * Tighter would clip Ian mid-thought. We do not go below this.
 */
export const VAD_SILENCE_DURATION_MS = 300;
/** Keep first consonants, including mumbled onsets. Do not lower. */
export const VAD_PREFIX_PADDING_MS = 350;

/** Worklet flush. 20ms is one render quantum at 48 kHz and stays WS-safe. */
export const CAPTURE_CHUNK_MS = 20;
/** Same ~4s pre-open coverage as before, now in 20ms chunks. */
export const PREOPEN_BUFFER_MS = 4000;
export const PREOPEN_CAP = Math.round(PREOPEN_BUFFER_MS / CAPTURE_CHUNK_MS);
/**
 * Foreground / desktop playback lead. Do not cut this on Wi-Fi speakers —
 * first-word underruns clip speech. First audio still plays on the delta.
 */
export const PLAY_LEAD_SEC = 0.15;
/**
 * CarPlay / lock-screen / voice-only lead. The car already buffers 150–300ms
 * (A2DP/HFP). Stacking another 150ms makes the first word feel late.
 * 60ms still covers a jittery delta without a full hardware-buffer wait.
 */
export const PLAY_LEAD_VOICE_ONLY_SEC = 0.06;

export function playLeadSec(voiceOnly: boolean) {
  return voiceOnly ? PLAY_LEAD_VOICE_ONLY_SEC : PLAY_LEAD_SEC;
}

export function captureFramesForRate(sampleRate: number) {
  return Math.round(sampleRate * (CAPTURE_CHUNK_MS / 1000));
}

export function buildTurnDetection() {
  return {
    type: VAD_TYPE,
    threshold: VAD_THRESHOLD,
    silence_duration_ms: VAD_SILENCE_DURATION_MS,
    prefix_padding_ms: VAD_PREFIX_PADDING_MS,
    // Do not send idle_timeout_ms at all. A set value (and some servers
    // treating JSON null as 0) makes xAI commit a silent user turn and speak
    // without Ian prompting.
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
