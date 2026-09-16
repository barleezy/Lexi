export const APPLE_MUSIC_API = "https://api.music.apple.com/v1";
export const MUSICKIT_SCRIPT = "https://js-cdn.music.apple.com/musickit/v3/musickit.js";
export const APPLE_MUSIC_USER_COOKIE = "lexi_apple_music_user";
export const APPLE_MUSIC_USER_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;
export const OUR_SONG_SEARCH = "Down Low Astrid S";
export const APPLE_MUSIC_SETUP =
  "Set APPLE_MUSIC_TEAM_ID, APPLE_MUSIC_KEY_ID, and APPLE_MUSIC_PRIVATE_KEY (the .p8 MusicKit key) in .env.local. Create a MusicKit identifier in Apple Developer. The signed-in user then taps Connect Apple Music and signs in. Never commit the key.";

export const APPLE_MUSIC_ACTIONS = [
  "connect",
  "disconnect",
  "status",
  "love",
  "library",
  "playlist",
  "search",
] as const;
export type AppleMusicAction = (typeof APPLE_MUSIC_ACTIONS)[number];

export function readEnv(name: string, env: NodeJS.ProcessEnv = process.env) {
  return env[name]?.trim() ?? "";
}

export function appleMusicTeamId(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("APPLE_MUSIC_TEAM_ID", env);
}

export function appleMusicKeyId(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("APPLE_MUSIC_KEY_ID", env);
}

export function appleMusicPrivateKey(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("APPLE_MUSIC_PRIVATE_KEY", env);
}

export function appleMusicStorefront(env: NodeJS.ProcessEnv = process.env) {
  return readEnv("APPLE_MUSIC_STOREFRONT", env) || "us";
}

export function isAppleMusicConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(appleMusicTeamId(env) && appleMusicKeyId(env) && appleMusicPrivateKey(env));
}

export function parseAppleMusicAction(raw: unknown): AppleMusicAction | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  return (APPLE_MUSIC_ACTIONS as readonly string[]).includes(value)
    ? (value as AppleMusicAction)
    : null;
}

export function parseAppleMusicQuery(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 120);
}

export function parseAppleMusicSongId(raw: unknown) {
  if (typeof raw !== "string" && typeof raw !== "number") return "";
  const value = String(raw).trim();
  if (!/^\d{1,18}$/.test(value)) return "";
  return value;
}

/** Catalog id from a typed id, or an official music.apple.com / itunes.apple.com song link. */
export function parseAppleMusicSongIdFromInput(raw: unknown) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return "";
  const direct = parseAppleMusicSongId(text);
  if (direct) return direct;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase();
    if (host !== "music.apple.com" && host !== "itunes.apple.com" && !host.endsWith(".music.apple.com")) {
      return "";
    }
    const songMatch = url.pathname.match(/\/song\/[^/]+\/(\d{1,18})/i);
    if (songMatch?.[1] && parseAppleMusicSongId(songMatch[1])) return songMatch[1];
    const albumSong = url.searchParams.get("i");
    if (albumSong && parseAppleMusicSongId(albumSong)) return albumSong;
  } catch {
    // not a URL
  }
  return "";
}
