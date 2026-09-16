import {
  AUDIO_SESSION_INTERRUPT_EVENTS,
  BACKGROUND_KEEP_EVENTS,
  EXCLUSIVE_MIC_ERROR_NAMES,
  GAME_FOREGROUND_EVENTS,
  IOS_KEEPALIVE_AMP,
  IOS_KEEPALIVE_HZ,
  IOS_KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_INTERVAL_MS,
  KEEPALIVE_SILENCE_MS,
  MEDIA_SESSION_TITLE,
  PLAY_AND_RECORD_TYPES,
  PLAYBACK_DUCK_GAIN,
  PLAYBACK_FULL_GAIN,
  buildKeepAliveWavDataUrl,
  isAudioContextInterrupted,
  isAudioSessionInterrupted,
  isExclusiveMicError,
  isGameLikeForeground,
  isIOSChrome,
  isIOSWebKit,
  isVoiceAudioInterrupted,
  playbackGainForCoexist,
  shouldDisconnectForLifecycle,
  shouldDuckPlaybackForCoexist,
  shouldPauseKeepAliveOnHide,
  setCarAudioRoute,
  setMediaSessionYield,
  shouldClaimMediaSession,
  shouldReclaimAfterExclusiveRelease,
  shouldReclaimForLifecycle,
  shouldReclaimMicForRouteChange,
  shouldUseHtmlKeepAlive,
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
expect(isAudioContextInterrupted("interrupted") === true, "AudioContext interrupted");
expect(isAudioContextInterrupted("running") === false, "running is not interrupted");
expect(isVoiceAudioInterrupted({ audioContextState: "interrupted" }) === true, "voice interrupted by ctx");
expect(isVoiceAudioInterrupted({ audioSessionState: "interrupted" }) === true, "voice interrupted by session");
expect(isVoiceAudioInterrupted({ audioContextState: "running" }) === false, "running voice is not interrupted");

expect(GAME_FOREGROUND_EVENTS.includes("blur"), "game foreground includes blur");
expect(GAME_FOREGROUND_EVENTS.includes("audiocontextinterrupted"), "game foreground includes ctx interrupt");
expect(isGameLikeForeground({ type: "blur" }) === true, "blur is game-like");
expect(isGameLikeForeground({ pageHidden: true }) === true, "hidden tab is game-like");
expect(isGameLikeForeground({ blurred: true }) === true, "blurred window is game-like");
expect(isGameLikeForeground({ audioContextState: "interrupted" }) === true, "stolen ctx is game-like");
expect(isGameLikeForeground({ type: "visibilitychange", visibilityState: "hidden" }) === true, "hidden visibility is game-like");
expect(isGameLikeForeground({ type: "visibilitychange", visibilityState: "visible" }) === false, "visible is not game-like");
expect(shouldDisconnectForLifecycle({ type: "blur" }) === false, "game blur must not hang up");
expect(shouldDuckPlaybackForCoexist({ pageHidden: true }) === true, "duck when hidden");
expect(shouldDuckPlaybackForCoexist({ blurred: true }) === true, "duck when blurred");
expect(shouldDuckPlaybackForCoexist({}) === false, "full volume in foreground");
expect(shouldClaimMediaSession(false) === true, "claim media session when music is not playing");
expect(shouldClaimMediaSession(true) === false, "yield media session while MusicKit plays");
setMediaSessionYield(true);
expect(shouldUseHtmlKeepAlive() === false, "pause html keep-alive while MusicKit plays");
expect(
  isVoiceAudioInterrupted({ audioSessionState: "interrupted", yieldToMedia: true }) === false,
  "MusicKit interrupt is not a mic hang-up",
);
setMediaSessionYield(false);
setCarAudioRoute(true);
expect(shouldClaimMediaSession(false) === false, "do not claim media session on car HFP");
expect(shouldUseHtmlKeepAlive({ carAudio: true }) === false, "no html media keep-alive on car HFP");
setCarAudioRoute(false);
expect(shouldUseHtmlKeepAlive() === true, "html keep-alive when not yielding and not car");
expect(shouldReclaimMicForRouteChange({ type: "devicechange" }) === true, "devicechange reclaims mic");
expect(shouldReclaimMicForRouteChange({ type: "pagehide" }) === true, "pagehide retries mic");
expect(
  shouldReclaimMicForRouteChange({ type: "visibilitychange", visibilityState: "hidden" }) === true,
  "hide still retries mic for AirPods app switch",
);
expect(shouldDuckPlaybackForCoexist({ musicPlaying: true }) === true, "duck when background music plays");
expect(playbackGainForCoexist(true) === PLAYBACK_DUCK_GAIN, "duck gain");
expect(playbackGainForCoexist(false) === PLAYBACK_FULL_GAIN, "full gain");
expect(PLAYBACK_DUCK_GAIN > 0 && PLAYBACK_DUCK_GAIN < 1, "duck never mutes");
expect(EXCLUSIVE_MIC_ERROR_NAMES.includes("NotReadableError"), "exclusive mic NotReadableError");
expect(isExclusiveMicError({ name: "NotReadableError" }) === true, "NotReadableError is exclusive");
expect(isExclusiveMicError(Object.assign(new Error("mic"), { name: "NotReadableError" })) === true, "Error NotReadableError");
expect(isExclusiveMicError(Object.assign(new Error("mic"), { name: "NotAllowedError" })) === true, "NotAllowedError still resume");
expect(isExclusiveMicError(Object.assign(new Error("mic"), { name: "TypeError" })) === false, "TypeError is not exclusive");
expect(shouldReclaimAfterExclusiveRelease({ type: "devicechange" }) === true, "devicechange reclaims after exclusive");
expect(shouldReclaimAfterExclusiveRelease({ type: "focus" }) === true, "alt-tab back reclaims");
expect(shouldReclaimAfterExclusiveRelease({ type: "statechange", audioContextState: "running" }) === true, "ctx running reclaims");
expect(shouldReclaimAfterExclusiveRelease({ type: "visibilitychange", visibilityState: "hidden" }) === false, "hidden does not reclaim");

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
