import {
  AUDIO_SESSION_INTERRUPT_EVENTS,
  BACKGROUND_KEEP_EVENTS,
  IOS_KEEPALIVE_AMP,
  IOS_KEEPALIVE_HZ,
  IOS_KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_SILENCE_MS,
  MEDIA_SESSION_TITLE,
  PLAY_AND_RECORD_TYPES,
  buildKeepAliveWavDataUrl,
  isAudioSessionInterrupted,
  isIOSChrome,
  isIOSWebKit,
  shouldDisconnectForLifecycle,
  shouldPauseKeepAliveOnHide,
  shouldReclaimForLifecycle,
} from "../lib/voice/keepalive.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(MEDIA_SESSION_TITLE === "Lexi", "media session title");
expect(KEEPALIVE_INTERVAL_MS === 4000, "desktop heartbeat interval");
expect(IOS_KEEPALIVE_INTERVAL_MS === 2000, "ios heartbeat is faster");
expect(KEEPALIVE_SILENCE_MS === 20, "silence ping is 20ms");
expect(IOS_KEEPALIVE_HZ === 48, "ios keep-alive is 48Hz, not a beep");
expect(IOS_KEEPALIVE_AMP === 180, "ios wav amp is still very low");
expect(PLAY_AND_RECORD_TYPES.includes("play-and-record"), "kebab play-and-record");
expect(PLAY_AND_RECORD_TYPES.includes("playAndRecord"), "camelCase alias");
expect(AUDIO_SESSION_INTERRUPT_EVENTS.includes("statechange"), "statechange");
expect(AUDIO_SESSION_INTERRUPT_EVENTS.includes("interruptionbegin"), "interruptionbegin");
expect(AUDIO_SESSION_INTERRUPT_EVENTS.includes("interruptionend"), "interruptionend");

expect(isIOSWebKit("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1"), "CriOS is iOS WebKit");
expect(isIOSChrome("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1"), "detect CriOS");
expect(isIOSWebKit("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "iOS Safari same APIs");
expect(!isIOSChrome("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"), "Safari is not CriOS");
expect(!isIOSWebKit("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"), "desktop Chrome is not iOS");
expect(isIOSWebKit("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", { platform: "MacIntel", maxTouchPoints: 5 }), "iPadOS desktop UA");

for (const type of BACKGROUND_KEEP_EVENTS) {
  expect(
    shouldDisconnectForLifecycle({ type }) === false,
    `${type} must not disconnect`,
  );
}

expect(shouldDisconnectForLifecycle({ type: "webkitvisibilitychange" }) === false, "webkit hide");
expect(shouldDisconnectForLifecycle({ type: "pagehide", persisted: true }) === false, "bfcache pagehide");
expect(shouldDisconnectForLifecycle({ type: "pagehide", persisted: false }) === false, "ios pagehide");
expect(shouldDisconnectForLifecycle({ type: "beforeunload" }) === true, "beforeunload may disconnect");
expect(shouldPauseKeepAliveOnHide() === false, "never pause keep-alive on hide");

expect(shouldReclaimForLifecycle({ type: "pageshow" }) === true, "pageshow reclaims");
expect(shouldReclaimForLifecycle({ type: "resume" }) === true, "resume reclaims");
expect(shouldReclaimForLifecycle({ type: "focus" }) === true, "focus reclaims");
expect(shouldReclaimForLifecycle({ type: "visibilitychange", visibilityState: "visible" }) === true, "visible reclaims");
expect(shouldReclaimForLifecycle({ type: "visibilitychange", visibilityState: "hidden" }) === false, "hidden does not reclaim");
expect(shouldReclaimForLifecycle({ type: "webkitvisibilitychange", visibilityState: "visible" }) === true, "webkit visible reclaims");
expect(shouldReclaimForLifecycle({ type: "interruptionbegin" }) === false, "interrupt begin holds");
expect(shouldReclaimForLifecycle({ type: "begininterruption" }) === false, "begininterruption holds");
expect(shouldReclaimForLifecycle({ type: "interruptionend" }) === true, "interrupt end reclaims");
expect(shouldReclaimForLifecycle({ type: "endinterruption" }) === true, "endinterruption reclaims");
expect(shouldReclaimForLifecycle({ type: "statechange", audioSessionState: "interrupted" }) === false, "interrupted holds WS");
expect(shouldReclaimForLifecycle({ type: "statechange", audioSessionState: "active" }) === true, "active reclaims");
expect(isAudioSessionInterrupted("interrupted") === true, "interrupted state");
expect(isAudioSessionInterrupted("active") === false, "active is not interrupted");

const wav = buildKeepAliveWavDataUrl(1, 8000);
expect(wav.startsWith("data:audio/wav;base64,"), "wav data url");
const binary = Buffer.from(wav.slice("data:audio/wav;base64,".length), "base64");
expect(binary.subarray(0, 4).toString() === "RIFF", "riff");
expect(binary.subarray(8, 12).toString() === "WAVE", "wave");
expect(binary.byteLength > 44, "has pcm");

let energy = 0;
for (let i = 44; i + 1 < binary.byteLength; i += 2) {
  energy += Math.abs(binary.readInt16LE(i));
}
expect(energy > 0, "keep-alive is near-silent, not digital zero");

const iosWav = buildKeepAliveWavDataUrl(1, 8000, { hz: IOS_KEEPALIVE_HZ, amp: IOS_KEEPALIVE_AMP });
const iosBinary = Buffer.from(iosWav.slice("data:audio/wav;base64,".length), "base64");
let iosEnergy = 0;
let iosPeak = 0;
for (let i = 44; i + 1 < iosBinary.byteLength; i += 2) {
  const sample = Math.abs(iosBinary.readInt16LE(i));
  iosEnergy += sample;
  iosPeak = Math.max(iosPeak, sample);
}
expect(iosEnergy > energy, "ios hold is stronger than desktop silence");
expect(iosPeak <= IOS_KEEPALIVE_AMP + 1, "ios peak stays at the low amp");
expect(iosPeak < 1000, "ios hold is not a beep");

console.log("keepalive check ok");
