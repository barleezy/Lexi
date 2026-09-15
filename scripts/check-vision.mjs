import {
  VISION_INTERVAL_MS,
  VISION_INTERVAL_VOICE_ONLY_MS,
  cameraMediaConstraints,
  cameraSwitchErrorMessage,
  otherCameraFacing,
} from "../lib/voice/vision.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(otherCameraFacing("user") === "environment", "front flips to rear");
expect(otherCameraFacing("environment") === "user", "rear flips to front");

const frontIdeal = cameraMediaConstraints("user", "ideal");
expect(frontIdeal.audio === false, "camera stream is video-only");
expect(frontIdeal.video.facingMode.ideal === "user", "front ideal facing");

const rearExact = cameraMediaConstraints("environment", "exact");
expect(rearExact.video.facingMode.exact === "environment", "rear exact facing");
expect(rearExact.video.width.ideal === 640, "same capture width");
expect(rearExact.video.height.ideal === 480, "same capture height");

expect(
  cameraSwitchErrorMessage("environment") === "No rear camera on this device.",
  "desktop / no-rear message",
);
expect(
  cameraSwitchErrorMessage("user") === "Could not switch to the front camera.",
  "front restore message",
);

expect(VISION_INTERVAL_MS === 1000, "visible vision still 1Hz");
expect(VISION_INTERVAL_VOICE_ONLY_MS === 4000, "voice-only fallback is 4s");

console.log("vision checks ok");
