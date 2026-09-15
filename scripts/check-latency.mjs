import {
  CAPTURE_CHUNK_MS,
  PLAY_LEAD_SEC,
  PREOPEN_BUFFER_MS,
  PREOPEN_CAP,
  VAD_PREFIX_PADDING_MS,
  VAD_SILENCE_DURATION_MS,
  VAD_THRESHOLD,
  VAD_TYPE,
  buildTurnDetection,
  captureFramesForRate,
  shouldDeferLiveVision,
} from "../lib/voice/realtime-latency.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(VAD_TYPE === "server_vad", "server VAD");
expect(VAD_THRESHOLD === 0.4, "0.4 so quiet / mumbled speech still commits");
expect(VAD_THRESHOLD < 0.5, "below default — 0.5 drops soft speech");
expect(VAD_SILENCE_DURATION_MS === 400, "400ms end-of-speech");
expect(VAD_SILENCE_DURATION_MS >= 400, "do not tighten below a natural pause");
expect(VAD_PREFIX_PADDING_MS === 350, "keep first consonants including mumbled onsets");
expect(VAD_PREFIX_PADDING_MS >= 300, "do not clip word onsets");
expect(CAPTURE_CHUNK_MS === 40, "40ms capture flush");
expect(CAPTURE_CHUNK_MS <= 40, "capture stays at or under 40ms");
expect(PLAY_LEAD_SEC === 0.15, "playback lead stays 150ms to avoid clipped first words");
expect(PREOPEN_BUFFER_MS === 4000, "4s pre-open coverage");
expect(PREOPEN_CAP === 100, "pre-open cap matches 40ms chunks");
expect(captureFramesForRate(48_000) === 1920, "48kHz capture frames");

const vad = buildTurnDetection();
expect(vad.type === "server_vad", "turn detection type");
expect(vad.threshold === 0.4, "turn detection threshold");
expect(vad.silence_duration_ms === 400, "turn detection silence");
expect(vad.prefix_padding_ms === 350, "turn detection prefix");
expect(vad.idle_timeout_ms == null, "no idle check-in — she must not speak unprompted");

expect(shouldDeferLiveVision("thinking", false, ["watch"]) === true, "defer watch frames while thinking");
expect(shouldDeferLiveVision("thinking", true, ["watch"]) === false, "user-asked frames still send");
expect(shouldDeferLiveVision("thinking", false, ["upload"]) === false, "uploaded video is not deferred");
expect(shouldDeferLiveVision("listening", false, ["watch"]) === false, "frames ride along while listening");
expect(shouldDeferLiveVision("speaking", false, ["camera"]) === false, "frames ride along while speaking");

console.log("latency ok");
