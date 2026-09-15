import {
  buildCarMicRoute,
  carMicFallbackMessage,
  carMicScore,
  carMicStatusLine,
  classifyAudioInputLabel,
  describeOpenedTrack,
  listedHasCarInput,
  listedHasExplicitCarplay,
  pickPreferredAudioInput,
  readAudioInputs,
  shouldDeferCarMicSwitch,
  shouldPreferCarMic,
  shouldReplaceMicForCar,
} from "../lib/voice/car-mic.ts";
import { LISTEN_SAMPLE_RATE, MIC_AUDIO_CONSTRAINTS } from "../lib/voice/listen.ts";
import { isInCarStyleRoute } from "../lib/voice/carplay.ts";
import { shouldDeferMicReacquire, shouldForceMicReacquire } from "../lib/voice/mic-recovery.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

function expectEqual(actual, expected, label) {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`${label}: ${left} !== ${right}`);
}

expect(LISTEN_SAMPLE_RATE === 48_000, "car mic path keeps 48 kHz");
expect(MIC_AUDIO_CONSTRAINTS.echoCancellation === true, "HFP still uses AEC");
expect(MIC_AUDIO_CONSTRAINTS.autoGainControl === true, "HFP still uses AGC");
expect(!("facingMode" in MIC_AUDIO_CONSTRAINTS), "facingMode is camera-only");
expect(!("deviceId" in MIC_AUDIO_CONSTRAINTS), "default constraints do not pin a device");

expectEqual(classifyAudioInputLabel("CarPlay"), "car", "CarPlay label");
expectEqual(classifyAudioInputLabel("BMW CarPlay Audio"), "car", "head-unit CarPlay");
expectEqual(classifyAudioInputLabel("Hands-Free"), "hfp", "HFP without brand");
expectEqual(classifyAudioInputLabel("Bluetooth HFP"), "hfp", "Bluetooth HFP");
expectEqual(classifyAudioInputLabel("iPhone Microphone"), "phone", "built-in phone");
expectEqual(classifyAudioInputLabel("AirPods Pro"), "earbuds", "AirPods");
expectEqual(classifyAudioInputLabel("Beats Fit Pro"), "earbuds", "Beats");
expectEqual(classifyAudioInputLabel("USB Audio Device"), "wired", "USB / wired CarPlay dongle");
expectEqual(classifyAudioInputLabel(""), "unknown", "empty label before permission");

const car = { deviceId: "car-1", label: "CarPlay", kind: "car" };
const phone = { deviceId: "phone-1", label: "iPhone Microphone", kind: "phone" };
const airpods = { deviceId: "pods-1", label: "AirPods Pro", kind: "earbuds" };
const hfp = { deviceId: "hfp-1", label: "Hands-Free", kind: "hfp" };

expect(carMicScore(car, false) >= 90, "explicit CarPlay scores high even before prefer");
expect(carMicScore(hfp, false) === 0, "generic HFP is not car unless we are seeking car");
expect(carMicScore(hfp, true) === 70, "generic HFP is a car candidate in-car");
expect(carMicScore(airpods, true) === 0, "AirPods never score as car");

const mixed = readAudioInputs([
  { deviceId: "phone-1", kind: "audioinput", label: "iPhone Microphone" },
  { deviceId: "car-1", kind: "audioinput", label: "CarPlay" },
  { deviceId: "pods-1", kind: "audioinput", label: "AirPods Pro" },
  { deviceId: "cam", kind: "videoinput", label: "Front Camera" },
]);
expect(mixed.length === 3, "only audioinputs");
expect(listedHasExplicitCarplay(mixed) === true, "CarPlay listed");
expect(listedHasCarInput(mixed) === true, "car candidate listed");

expect(shouldPreferCarMic({}) === false, "do not prefer car on a phone/AirPods session");
expect(shouldPreferCarMic({ ios: true }) === false, "visible iOS without a car device stays default");
expect(shouldPreferCarMic({ ios: true, carInputPresent: true }) === true, "iOS + listed car input");
expect(shouldPreferCarMic({ voiceOnly: true, ios: true }) === true, "hidden iOS / CarPlay heuristic");
expect(shouldPreferCarMic({ voiceOnly: true, ios: false }) === false, "desktop hidden tab is not a car");
expect(shouldPreferCarMic({ voiceOnly: true, ios: false, carInputPresent: true }) === true, "desktop sim with a labeled car device");
expect(shouldPreferCarMic({ explicitCarplayLabel: true }) === true, "explicit CarPlay label always wins");

expectEqual(pickPreferredAudioInput([phone, airpods], { preferCar: false }).reason, "os-default", "AirPods path does not pin deviceId");
expectEqual(pickPreferredAudioInput([phone, airpods], { preferCar: true }).reason, "car-not-listed", "no car listed");
expectEqual(pickPreferredAudioInput([phone, car, airpods], { preferCar: true }).chosen?.deviceId, "car-1", "pick CarPlay over AirPods");
expectEqual(pickPreferredAudioInput([phone, hfp, airpods], { preferCar: true }).chosen?.deviceId, "hfp-1", "pick HFP over phone/AirPods when in-car");
expectEqual(pickPreferredAudioInput([phone, hfp, airpods], { preferCar: false }).chosen, null, "do not steal AirPods when not in-car");
expectEqual(
  pickPreferredAudioInput([{ deviceId: "only", label: "iPhone Microphone", kind: "phone" }], { preferCar: true }).reason,
  "single-system-route",
  "iOS single-input fallback",
);
expect(pickPreferredAudioInput([{ deviceId: "default", label: "CarPlay", kind: "car" }], { preferCar: true }).chosen === null, "skip deviceId=default");

expect(
  shouldReplaceMicForCar({ preferCar: true, currentKind: "phone", currentDeviceId: "phone-1", carInput: car }) === true,
  "replace phone with listed car",
);
expect(
  shouldReplaceMicForCar({ preferCar: true, currentKind: "earbuds", currentDeviceId: "pods-1", carInput: car }) === true,
  "replace AirPods with car when CarPlay is listed",
);
expect(
  shouldReplaceMicForCar({ preferCar: true, currentKind: "car", currentDeviceId: "car-1", carInput: car }) === false,
  "keep an already-car track",
);
expect(
  shouldReplaceMicForCar({ preferCar: false, currentKind: "phone", carInput: car }) === false,
  "do not replace when not seeking car",
);
expect(
  shouldReplaceMicForCar({ preferCar: true, currentKind: "phone", carInput: null }) === false,
  "do not replace when car is not listed",
);

expect(
  shouldDeferCarMicSwitch({ pageHidden: true, preferCar: true, currentKind: "phone" }) === true,
  "cannot getUserMedia while hidden",
);
expect(
  shouldDeferCarMicSwitch({ pageHidden: true, preferCar: true, currentKind: "car" }) === false,
  "already on car while hidden — keep live track",
);
expect(
  shouldDeferCarMicSwitch({ pageHidden: false, preferCar: true, currentKind: "phone", hasCarDevice: true }) === false,
  "foreground may switch",
);

expect(carMicFallbackMessage("os-default") === null, "no fallback banner on default path");
expect(carMicFallbackMessage("label-match") === null, "no fallback when car was chosen");
expect(String(carMicFallbackMessage("car-not-listed", { ios: true })).includes("iOS web limit"), "iOS limit is named");
expect(String(carMicFallbackMessage("hidden-cannot-switch")).includes("hidden"), "hidden switch is explained");
expect(String(carMicFallbackMessage("overconstrained")).includes("deviceId"), "exact constraint failure is explained");
expect(
  carMicFallbackMessage("single-system-route", { ios: true, currentKind: "hfp" }) === null,
  "single HFP system route is success, not a fallback",
);

const carRoute = buildCarMicRoute({
  preferCar: true,
  current: car,
  pickReason: "label-match",
  ios: true,
  listed: 3,
});
expectEqual(carMicStatusLine(carRoute), "Car mic", "status says Car mic");

const phoneFallback = buildCarMicRoute({
  preferCar: true,
  current: phone,
  pickReason: "car-not-listed",
  ios: true,
  listed: 1,
});
expect(carMicStatusLine(phoneFallback)?.includes("not listed"), "status names the miss");

const airpodsDefault = buildCarMicRoute({
  preferCar: false,
  current: airpods,
  pickReason: "os-default",
  ios: true,
  listed: 2,
});
expect(carMicStatusLine(airpodsDefault) === null, "AirPods / phone sessions stay quiet");

expectEqual(
  describeOpenedTrack({ label: "CarPlay", getSettings: () => ({ deviceId: "car-1" }) }, mixed).kind,
  "car",
  "opened track classified from label",
);

expect(isInCarStyleRoute({ pageHidden: true, ios: true }) === true, "PR #4 hidden iOS still means in-car");
expect(
  shouldPreferCarMic({ voiceOnly: isInCarStyleRoute({ pageHidden: true, ios: true }), ios: true }) === true,
  "PR #4 heuristic drives car-mic prefer",
);
expect(shouldDeferMicReacquire({ pageHidden: true, reason: "devicechange" }) === true, "PR #5 hidden devicechange still defers getUserMedia");
expect(
  shouldForceMicReacquire({
    reason: "foreground",
    trackNeedsReplace: false,
    ios: true,
  }) === false,
  "CarPlay glance back still does not replace a live HFP track",
);
expect(
  shouldForceMicReacquire({
    reason: "devicechange",
    trackNeedsReplace: false,
  }) === true,
  "visible AirPods/CarPlay route change still reacquires",
);

console.log("car-mic ok");
