import {
  hasLiveVisionUi,
  isInCarStyleRoute,
  shouldClientGateMicToSilence,
  shouldRunVisionCaptureLoop,
  shouldSendLiveVisionFrames,
} from "../lib/voice/carplay.ts";
import {
  CAPTURE_CHUNK_MS,
  PLAY_LEAD_SEC,
  PLAY_LEAD_VOICE_ONLY_SEC,
  playLeadSec,
} from "../lib/voice/realtime-latency.ts";
import { VISION_INTERVAL_MS, VISION_INTERVAL_VOICE_ONLY_MS } from "../lib/voice/vision.ts";
import { LISTEN_SAMPLE_RATE } from "../lib/voice/listen.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(LISTEN_SAMPLE_RATE === 48_000, "keep 48 kHz on CarPlay — OS resamples HFP/A2DP");
expect(PLAY_LEAD_VOICE_ONLY_SEC === 0.06, "voice-only lead is 60ms");
expect(PLAY_LEAD_VOICE_ONLY_SEC < PLAY_LEAD_SEC, "CarPlay lead is tighter than desktop");
expect(playLeadSec(true) === PLAY_LEAD_VOICE_ONLY_SEC, "voice-only helper");
expect(playLeadSec(false) === PLAY_LEAD_SEC, "foreground helper stays 150ms");
expect(CAPTURE_CHUNK_MS === 20, "20ms capture flush");
expect(VISION_INTERVAL_VOICE_ONLY_MS === 4000, "voice-only vision fallback is 4s");
expect(VISION_INTERVAL_VOICE_ONLY_MS > VISION_INTERVAL_MS, "voice-only vision is slower");

expect(hasLiveVisionUi({}) === false, "no vision UI by default");
expect(hasLiveVisionUi({ camera: true }) === true, "camera is vision UI");
expect(hasLiveVisionUi({ watch: true }) === true, "watch is vision UI");

expect(isInCarStyleRoute({}) === false, "visible page is not in-car");
expect(isInCarStyleRoute({ pageHidden: true, ios: true }) === true, "iOS hidden is CarPlay/lock-screen");
expect(
  isInCarStyleRoute({ pageHidden: true, ios: true, cameraActive: true }) === true,
  "iOS hidden skips leftover camera",
);
expect(
  isInCarStyleRoute({ pageHidden: true, ios: false, cameraActive: false, screenActive: false, watchActive: false }) ===
    true,
  "desktop hidden + no vision is the CarPlay sim path",
);
expect(
  isInCarStyleRoute({ pageHidden: true, ios: false, cameraActive: true }) === false,
  "desktop hidden with camera still on is not voice-only",
);

expect(shouldRunVisionCaptureLoop({ pageHidden: true }) === false, "no JPEG loop when hidden");
expect(shouldRunVisionCaptureLoop({ pageHidden: false }) === true, "JPEG loop when visible");
expect(shouldSendLiveVisionFrames({ pageHidden: true, source: "camera" }) === false, "skip camera frames when hidden");
expect(shouldSendLiveVisionFrames({ pageHidden: true, source: "watch" }) === false, "skip watch frames when hidden");
expect(
  shouldSendLiveVisionFrames({ pageHidden: true, source: "upload" }) === true,
  "uploads still send when hidden",
);
expect(
  shouldSendLiveVisionFrames({ pageHidden: true, source: "camera", respond: true }) === true,
  "user-asked frames still send",
);
expect(shouldSendLiveVisionFrames({ pageHidden: false, source: "camera" }) === true, "visible camera still sends");
expect(shouldClientGateMicToSilence(true) === false, "do not RMS-gate HFP/CarPlay");
expect(shouldClientGateMicToSilence(false) === true, "gate TV/game bleed when not voice-only");

console.log("carplay ok");
