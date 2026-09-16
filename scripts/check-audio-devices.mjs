import {
  CAR_MIC_MUTE_RECLAIM_MS,
  HANDS_FREE_INPUT_RE,
  MIC_MUTE_RECLAIM_MS,
  PHONE_BUILTIN_INPUT_RE,
  isCarLikeAudioInput,
  isPhoneBuiltinAudioInput,
  micNeedsReroute,
  muteReclaimDelayMs,
  pickPreferredAudioInput,
  scoreAudioInputLabel,
} from "../lib/voice/audio-devices.ts";
import {
  CAMERA_VISION_FPS,
  CAMERA_VISION_INTERVAL_MS,
  DETAIL_JPEG_QUALITY,
  DETAIL_MAX_EDGE,
  DualLiveVisionMux,
  mergeLiveVisionParts,
  nextCameraFacing,
  SCREEN_VISION_FPS,
  SCREEN_VISION_INTERVAL_MS,
  VISION_INTERVAL_MS,
} from "../lib/voice/vision.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(HANDS_FREE_INPUT_RE.test("CarPlay"), "CarPlay label");
expect(HANDS_FREE_INPUT_RE.test("iPhone Hands-Free"), "iPhone Hands-Free label");
expect(HANDS_FREE_INPUT_RE.test("Bluetooth HFP"), "Bluetooth HFP label");
expect(HANDS_FREE_INPUT_RE.test("Car Audio"), "Car Audio label");
expect(!HANDS_FREE_INPUT_RE.test("iPhone Microphone"), "phone mic is not car");
expect(!HANDS_FREE_INPUT_RE.test("AirPods Pro"), "AirPods are not car HFP");
expect(PHONE_BUILTIN_INPUT_RE.test("iPhone Microphone"), "built-in phone mic");
expect(isCarLikeAudioInput("CarPlay") === true, "car-like CarPlay");
expect(isPhoneBuiltinAudioInput("iPhone Microphone") === true, "builtin helper");
expect(scoreAudioInputLabel("CarPlay") > scoreAudioInputLabel("AirPods Pro"), "car beats AirPods");
expect(scoreAudioInputLabel("Bluetooth HFP") > scoreAudioInputLabel("iPhone Microphone"), "HFP beats phone");
expect(scoreAudioInputLabel("AirPods") > scoreAudioInputLabel("iPhone Microphone"), "AirPods beat phone");

const picked = pickPreferredAudioInput([
  { deviceId: "phone", kind: "audioinput", label: "iPhone Microphone" },
  { deviceId: "car", kind: "audioinput", label: "CarPlay" },
  { deviceId: "pods", kind: "audioinput", label: "AirPods Pro" },
]);
expect(picked?.deviceId === "car", "prefer CarPlay over phone and AirPods");

const afterCarGone = pickPreferredAudioInput([
  { deviceId: "phone", kind: "audioinput", label: "iPhone Microphone" },
  { deviceId: "pods", kind: "audioinput", label: "AirPods Pro" },
]);
expect(afterCarGone?.deviceId === "pods", "fall back to AirPods when car disconnects");

const phoneOnly = pickPreferredAudioInput([
  { deviceId: "phone", kind: "audioinput", label: "iPhone Microphone" },
]);
expect(phoneOnly?.deviceId === "phone", "phone mic if that is all that is left");

expect(
  micNeedsReroute(
    { getSettings: () => ({ deviceId: "phone" }) },
    "car",
  ) === true,
  "reroute when preferred device changed",
);
expect(
  micNeedsReroute({ getSettings: () => ({ deviceId: "car" }) }, "car") === false,
  "no reroute when already on preferred",
);

expect(muteReclaimDelayMs(true) === CAR_MIC_MUTE_RECLAIM_MS, "car mute retry is faster");
expect(muteReclaimDelayMs(false) === MIC_MUTE_RECLAIM_MS, "default mute retry");
expect(CAR_MIC_MUTE_RECLAIM_MS < MIC_MUTE_RECLAIM_MS, "car does not sit on the 400ms mute");

expect(nextCameraFacing("user") === "environment", "front to rear");
expect(nextCameraFacing("environment") === "user", "rear to front");
expect(CAMERA_VISION_FPS === 30, "camera capture is 30 fps");
expect(CAMERA_VISION_INTERVAL_MS === Math.round(1000 / 30), "camera samples at 30 fps");
expect(SCREEN_VISION_FPS === 30, "shared tab capture is 30 fps");
expect(SCREEN_VISION_INTERVAL_MS === CAMERA_VISION_INTERVAL_MS, "camera matches shared-tab cadence");
expect(DETAIL_MAX_EDGE >= 1152, "analysis stills are high-detail");
expect(DETAIL_JPEG_QUALITY >= 0.8, "analysis jpeg is sharp enough to read text");
expect(VISION_INTERVAL_MS <= 250, "default vision cadence is live");

const merged = mergeLiveVisionParts(
  [{ source: "camera", dataUrl: "old-cam" }],
  [
    { source: "camera", dataUrl: "new-cam" },
    { source: "screen", dataUrl: "tab" },
  ],
);
expect(merged.length === 2, "pending live frames keep one of each stream");
expect(merged.find((part) => part.source === "camera")?.dataUrl === "new-cam", "newer camera wins");
expect(merged.find((part) => part.source === "screen")?.dataUrl === "tab", "screen is kept");

const paired = [];
const mux = new DualLiveVisionMux();
mux.setActive("camera", true);
mux.setActive("screen", true);
mux.setFlush((parts) => paired.push(parts.map((part) => part.source).sort().join("+")));
mux.push({ source: "camera", dataUrl: "c" });
mux.push({ source: "screen", dataUrl: "s" });
await new Promise((resolve) => setTimeout(resolve, 30));
expect(paired.includes("camera+screen"), "mux pairs camera and shared tab");
mux.dispose();

console.log("audio-devices ok");
