import {
  APPLE_MUSIC_ACTIONS,
  APPLE_MUSIC_API,
  APPLE_MUSIC_USER_COOKIE,
  MUSICKIT_SCRIPT,
  OUR_SONG_SEARCH,
  appleMusicStorefront,
  isAppleMusicConfigured,
  parseAppleMusicAction,
  parseAppleMusicQuery,
  parseAppleMusicSongId,
  parseAppleMusicSongIdFromInput,
} from "../lib/apple-music/config.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(APPLE_MUSIC_API === "https://api.music.apple.com/v1", "official Apple Music API host");
expect(MUSICKIT_SCRIPT.startsWith("https://js-cdn.music.apple.com/musickit/"), "official MusicKit JS");
expect(APPLE_MUSIC_USER_COOKIE === "lexi_apple_music_user", "user token cookie name");
expect(appleMusicStorefront({}) === "us", "default storefront");
expect(appleMusicStorefront({ APPLE_MUSIC_STOREFRONT: "gb" }) === "gb", "storefront override");
expect(isAppleMusicConfigured({}) === false, "missing keys is not configured");
expect(
  isAppleMusicConfigured({
    APPLE_MUSIC_TEAM_ID: "ABCDE12345",
    APPLE_MUSIC_KEY_ID: "KEYID12345",
    APPLE_MUSIC_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nMII\\n-----END PRIVATE KEY-----",
  }) === true,
  "three env vars configure MusicKit",
);
expect(parseAppleMusicAction("love") === "love", "love action");
expect(parseAppleMusicAction("hack") === null, "reject unknown action");
expect(APPLE_MUSIC_ACTIONS.includes("connect"), "connect is an action");
expect(parseAppleMusicQuery("  Down Low  ") === "Down Low", "trim query");
expect(parseAppleMusicSongId("1666123568") === "1666123568", "catalog id");
expect(parseAppleMusicSongId("not-an-id") === "", "reject non-id");
expect(OUR_SONG_SEARCH.includes("Down Low"), "our song search");
expect(OUR_SONG_SEARCH.includes("Astrid"), "our song artist");
expect(
  parseAppleMusicSongIdFromInput("https://music.apple.com/us/song/down-low/1578475848") ===
    "1578475848",
  "song url id",
);
expect(
  parseAppleMusicSongIdFromInput("https://music.apple.com/us/album/down-low/1578475847?i=1578475848") ===
    "1578475848",
  "album url song id",
);
expect(parseAppleMusicSongIdFromInput("1578475848") === "1578475848", "plain catalog id");

console.log("apple music config ok");
