import {
  MIC_MUTE_SETTLE_MS,
  MIC_REACQUIRE_DEBOUNCE_MS,
  classifyMicError,
  micTrackNeedsReplace,
  shouldAttemptMicOpen,
  shouldBlockReclaimForInterrupt,
  shouldDeferMicReacquire,
  shouldForceMicReacquire,
  shouldKillSessionForMicError,
  shouldPromptMicGesture,
  shouldStopRetryingMic,
} from "../lib/voice/mic-recovery.ts";
import {
  shouldReclaimMicOnDeviceChange,
  shouldRunMicReclaimAfterLifecycle,
} from "../lib/voice/keepalive.ts";
import { LISTEN_SAMPLE_RATE } from "../lib/voice/listen.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(LISTEN_SAMPLE_RATE === 48_000, "recovery does not drop 48 kHz");
expect(MIC_REACQUIRE_DEBOUNCE_MS === 800, "debounce getUserMedia at 800ms");
expect(MIC_MUTE_SETTLE_MS === 400, "mute settle matches prior iOS delay");

expect(micTrackNeedsReplace(null) === true, "missing track");
expect(micTrackNeedsReplace({ readyState: "ended", enabled: true, muted: false }) === true, "ended track");
expect(micTrackNeedsReplace({ readyState: "live", enabled: false, muted: false }) === true, "disabled track");
expect(micTrackNeedsReplace({ readyState: "live", enabled: true, muted: true }) === true, "muted AirPods track");
expect(micTrackNeedsReplace({ readyState: "live", enabled: true, muted: false }) === false, "live unmuted track");

expect(shouldDeferMicReacquire({ pageHidden: true, reason: "ended" }) === true, "defer ended while hidden");
expect(shouldDeferMicReacquire({ pageHidden: true, reason: "devicechange" }) === true, "defer devicechange while hidden");
expect(shouldDeferMicReacquire({ pageHidden: true, reason: "tick" }) === true, "no keepalive getUserMedia while hidden");
expect(shouldDeferMicReacquire({ pageHidden: true, reason: "mute" }) === true, "defer mute while hidden");
expect(shouldDeferMicReacquire({ pageHidden: true, reason: "foreground" }) === true, "hidden is not foreground");
expect(shouldDeferMicReacquire({ pageHidden: true, reason: "manual" }) === false, "Tap to resume may open mic");
expect(shouldDeferMicReacquire({ pageHidden: false, reason: "ended" }) === false, "visible ended reacquires");

expect(
  shouldForceMicReacquire({ reason: "tick", trackNeedsReplace: false }) === false,
  "usable tick does not spam getUserMedia",
);
expect(
  shouldForceMicReacquire({ reason: "tick", trackNeedsReplace: true }) === true,
  "dead track on tick reacquires",
);
expect(
  shouldForceMicReacquire({ reason: "ended", trackNeedsReplace: false }) === true,
  "ended always replaces",
);
expect(
  shouldForceMicReacquire({ reason: "devicechange", trackNeedsReplace: false }) === true,
  "AirPods route change replaces even if track looks live",
);
expect(
  shouldForceMicReacquire({
    reason: "foreground",
    trackNeedsReplace: false,
    audioWasInterrupted: true,
    ios: true,
  }) === true,
  "iOS foreground after interrupt reacquires (AirPods app switch)",
);
expect(
  shouldForceMicReacquire({
    reason: "foreground",
    trackNeedsReplace: false,
    routeChanged: true,
  }) === true,
  "foreground after devicechange reacquires",
);
expect(
  shouldForceMicReacquire({
    reason: "foreground",
    trackNeedsReplace: false,
    ios: true,
  }) === false,
  "CarPlay glance back does not replace a live HFP track",
);
expect(
  shouldForceMicReacquire({ reason: "mute", trackNeedsReplace: true, ios: true }) === true,
  "iOS mute of a dead track reacquires",
);

expect(
  shouldAttemptMicOpen({ inFlight: true, lastAttemptMs: 0, now: 10_000 }) === false,
  "serialize in-flight getUserMedia",
);
expect(
  shouldAttemptMicOpen({ inFlight: false, lastAttemptMs: 9_500, now: 10_000 }) === false,
  "debounce 800ms",
);
expect(
  shouldAttemptMicOpen({ inFlight: false, lastAttemptMs: 9_000, now: 10_000 }) === true,
  "after debounce",
);
expect(
  shouldAttemptMicOpen({
    inFlight: false,
    lastAttemptMs: 0,
    now: 10_000,
    permissionDenied: true,
  }) === false,
  "stop retrying after denial",
);

expect(
  shouldRunMicReclaimAfterLifecycle({ reclaiming: false, pageHidden: false }) === true,
  "visible reclaim",
);
expect(
  shouldRunMicReclaimAfterLifecycle({ reclaiming: false, pageHidden: true }) === false,
  "hidden hold — CarPlay / lock screen",
);
expect(
  shouldRunMicReclaimAfterLifecycle({ reclaiming: true, pageHidden: false }) === false,
  "no overlapping reclaim",
);

expect(
  shouldBlockReclaimForInterrupt({ interrupted: true, pageHidden: false, resumed: false }) === true,
  "do not reclaim mid-interrupt before resume",
);
expect(
  shouldBlockReclaimForInterrupt({ interrupted: true, pageHidden: false, resumed: true }) === false,
  "after resume, interrupt must not skip AirPods recovery",
);
expect(
  shouldBlockReclaimForInterrupt({ interrupted: true, pageHidden: true, resumed: true }) === true,
  "still hold while hidden",
);

expect(shouldReclaimMicOnDeviceChange({ pageHidden: false }) === true, "devicechange reclaims when visible");
expect(shouldReclaimMicOnDeviceChange({ pageHidden: true }) === false, "devicechange while hidden waits");

expect(classifyMicError({ name: "NotAllowedError" }) === "denied", "focused denial");
expect(
  classifyMicError({ name: "NotAllowedError" }, { pageHidden: true }) === "transient",
  "hidden NotAllowedError is not a real denial",
);
expect(
  classifyMicError({ name: "NotAllowedError" }, { documentHasFocus: false }) === "transient",
  "unfocused NotAllowedError is transient",
);
expect(classifyMicError({ name: "NotReadableError" }) === "exclusive", "Fortnite exclusive");
expect(classifyMicError({ name: "AbortError" }) === "exclusive", "AbortError exclusive");
expect(classifyMicError({ name: "TypeError" }) === "unknown", "unknown stays unknown");
expect(shouldPromptMicGesture("denied") === true, "denial shows Tap to resume");
expect(shouldPromptMicGesture("exclusive") === true, "exclusive shows Tap to resume");
expect(shouldPromptMicGesture("transient") === false, "transient does not nag");
expect(shouldStopRetryingMic("denied") === true, "denied stops auto-retry");
expect(shouldStopRetryingMic("exclusive") === false, "exclusive may recover on devicechange");
expect(shouldKillSessionForMicError("denied") === false, "denial does not hang up");
expect(shouldKillSessionForMicError("exclusive") === false, "Fortnite exclusive does not hang up");
expect(shouldKillSessionForMicError("unknown") === false, "unknown mic error does not hang up");

console.log("mic-recovery ok");
