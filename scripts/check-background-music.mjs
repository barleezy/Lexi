import { readFileSync } from "node:fs";
import { OUR_SONG_VALUE, PINNED_AFFECT, isPinnedKey } from "../lib/memory/extract.ts";
import { isBlockedVideoHost } from "../lib/voice/video-proxy.ts";
import { PLAYBACK_DUCK_GAIN } from "../lib/voice/keepalive.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(isBlockedVideoHost("127.0.0.1") === true, "loopback blocked for media urls");
expect(isBlockedVideoHost("example.com") === false, "public host allowed");
expect(new URL("https://example.com/track.mp3").protocol === "https:", "https audio urls parse");
expect(PLAYBACK_DUCK_GAIN === 0.42, "voice ducks to 42% with other audio");
expect(isPinnedKey("our_song") === true, "our_song is pinned");
expect(OUR_SONG_VALUE === "Down Low by Astrid S", "couple song value");
expect(PINNED_AFFECT === 10, "pinned affect is 10");

const vision = readFileSync(new URL("../lib/voice/vision.ts", import.meta.url), "utf8");
expect(vision.includes("suppressLocalAudioPlayback: false"), "tab share keeps local soundtrack");

const keepaliveSrc = readFileSync(new URL("../lib/voice/keepalive.ts", import.meta.url), "utf8");
expect(keepaliveSrc.includes("MIXABLE_AUDIO_SESSION_TYPES"), "safari session mixes instead of play-and-record lock");
expect(keepaliveSrc.includes("Never steal lock-screen"), "media session is not claimed");

const iosAudio = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Voice/VoiceAudioEngine.swift", import.meta.url),
  "utf8",
);
expect(iosAudio.includes(".mixWithOthers"), "ios default mixes with apple music");
expect(iosAudio.includes("allowBluetoothA2DP"), "ios default keeps a2dp music");
expect(
  /if partyChat \{[\s\S]*allowBluetoothHFP/.test(iosAudio),
  "ios hfp only on party-chat path",
);
expect(iosAudio.includes("setVoiceProcessingEnabled(enabled)"), "ios voice processing is gated");

const iosCamera = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Vision/CameraController.swift", import.meta.url),
  "utf8",
);
expect(
  iosCamera.includes("automaticallyConfiguresApplicationAudioSession = false"),
  "camera does not reset the audio session",
);

const bgPlayer = readFileSync(new URL("../lib/voice/background-music.ts", import.meta.url), "utf8");
expect(bgPlayer.includes("async resume()"), "url music can resume after voice start");

const persona = readFileSync(new URL("../lib/voice/persona.ts", import.meta.url), "utf8");
expect(persona.includes("Down Low"), "couple song in persona");
expect(persona.includes("Astrid S"), "Astrid S in persona");
expect(/lyrics/i.test(persona), "lyrics-first in persona");
expect(persona.includes("affect 10, stays 10"), "affect 10 stays 10 in persona");
expect(persona.includes("apple_music_connect"), "connect tool in persona");
expect(persona.includes("play_music"), "play_music in persona");
expect(persona.includes("homepage"), "user can play from the homepage");
expect(persona.includes("watch tab"), "tells her not to open a watch tab");

console.log("background music + couple song ok");
