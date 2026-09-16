import { MUSICKIT_SCRIPT, OUR_SONG_SEARCH, parseAppleMusicSongIdFromInput } from "./config";

export { MUSICKIT_SCRIPT };

export type AppleMusicNowPlaying = {
  playing: boolean;
  title: string;
  artist: string;
  songId: string;
};

export type AppleMusicCatalogHit = {
  id: string;
  title: string;
  artist: string;
};

type MusicKitInstance = {
  authorize: () => Promise<string>;
  unauthorize: () => Promise<void> | void;
  setQueue: (opts: { song?: string; songs?: string[] }) => Promise<unknown>;
  play: () => Promise<void>;
  stop: () => Promise<void> | void;
  pause?: () => Promise<void> | void;
  skipToNextItem?: () => Promise<void>;
  skipToPreviousItem?: () => Promise<void>;
  isAuthorized?: boolean;
  isPlaying?: boolean;
  volume?: number;
  playbackState?: number;
  nowPlayingItem?: {
    id?: string;
    title?: string;
    artistName?: string;
    attributes?: { name?: string; artistName?: string };
  };
  queue?: { items?: unknown[]; position?: number };
  addEventListener?: (name: string, fn: () => void) => void;
  removeEventListener?: (name: string, fn: () => void) => void;
};

type MusicKitGlobal = {
  configure: (opts: {
    developerToken: string;
    app: { name: string; build: string };
  }) => Promise<MusicKitInstance> | MusicKitInstance | void;
  getInstance: () => MusicKitInstance;
};

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

const PLAYING_STATE = 2;
const searchCache = new Map<string, AppleMusicCatalogHit[]>();
const playbackListeners = new Set<(state: AppleMusicNowPlaying) => void>();

let configuredToken = "";
let listenersAttached = false;

export function getMusicKitInstance(): MusicKitInstance | null {
  if (typeof window === "undefined") return null;
  try {
    return window.MusicKit?.getInstance() ?? null;
  } catch {
    return null;
  }
}

export async function loadMusicKitScript() {
  if (typeof window === "undefined") {
    throw new Error("MusicKit only runs in the browser.");
  }
  if (window.MusicKit) return;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      if (window.MusicKit) resolve();
    };
    document.addEventListener("musickitloaded", finish, { once: true });
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${MUSICKIT_SCRIPT}"]`);
    if (existing) {
      if (window.MusicKit) {
        resolve();
        return;
      }
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load MusicKit JS.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = MUSICKIT_SCRIPT;
    script.async = true;
    script.dataset.token = "configured";
    script.onload = finish;
    script.onerror = () => reject(new Error("Could not load MusicKit JS from Apple."));
    document.head.appendChild(script);
  });
}

export async function configureMusicKit(developerToken: string) {
  await loadMusicKitScript();
  const kit = window.MusicKit;
  if (!kit) throw new Error("MusicKit JS did not load.");
  if (configuredToken !== developerToken) {
    await kit.configure({
      developerToken,
      app: { name: "Lexi", build: "1" },
    });
    configuredToken = developerToken;
    listenersAttached = false;
  }
  const music = kit.getInstance();
  attachPlaybackListeners(music);
  return music;
}

export function readAppleMusicNowPlaying(): AppleMusicNowPlaying {
  const music = getMusicKitInstance();
  if (!music) return { playing: false, title: "", artist: "", songId: "" };
  const item = music.nowPlayingItem;
  const title = item?.title || item?.attributes?.name || "";
  const artist = item?.artistName || item?.attributes?.artistName || "";
  const songId = typeof item?.id === "string" ? item.id : "";
  const playing = Boolean(music.isPlaying) || music.playbackState === PLAYING_STATE;
  return { playing, title, artist, songId };
}

export function subscribeAppleMusicPlayback(listener: (state: AppleMusicNowPlaying) => void) {
  playbackListeners.add(listener);
  return () => {
    playbackListeners.delete(listener);
  };
}

function emitPlayback() {
  const state = readAppleMusicNowPlaying();
  for (const listener of playbackListeners) listener(state);
}

function attachPlaybackListeners(music: MusicKitInstance) {
  if (listenersAttached || !music.addEventListener) return;
  listenersAttached = true;
  music.addEventListener("playbackStateDidChange", emitPlayback);
  music.addEventListener("nowPlayingItemDidChange", emitPlayback);
}

function titleFromHit(hit: AppleMusicCatalogHit) {
  return [hit.title, hit.artist].filter(Boolean).join(" — ");
}

export function cacheAppleMusicSongs(query: string, songs: AppleMusicCatalogHit[]) {
  const key = query.trim().toLowerCase();
  if (!key || !songs.length) return;
  searchCache.set(key, songs);
}

export function cachedAppleMusicSongs(query: string) {
  return searchCache.get(query.trim().toLowerCase()) ?? [];
}

export async function searchAppleMusicCatalog(query: string): Promise<AppleMusicCatalogHit[]> {
  const term = query.trim();
  if (!term) return [];
  const cached = cachedAppleMusicSongs(term);
  if (cached.length) return cached;
  const response = await fetch("/api/apple-music", {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" },
    body: JSON.stringify({ action: "search", query: term }),
  });
  const body = (await response.json()) as {
    ok?: boolean;
    songs?: AppleMusicCatalogHit[];
    song?: AppleMusicCatalogHit;
    error?: string;
  };
  const songs = body.songs?.length
    ? body.songs
    : body.song
      ? [body.song]
      : [];
  if (!response.ok || !songs.length) {
    throw new Error(body.error || "No Apple Music match.");
  }
  cacheAppleMusicSongs(term, songs);
  return songs;
}

export async function prefetchOurSong() {
  try {
    return await searchAppleMusicCatalog(OUR_SONG_SEARCH);
  } catch {
    return [];
  }
}

function songIdsForInput(input = "") {
  const pasted = parseAppleMusicSongIdFromInput(input);
  if (pasted) return [pasted];
  const query = input.trim() || OUR_SONG_SEARCH;
  return cachedAppleMusicSongs(query).map((song) => song.id);
}

function hasQueue(music: MusicKitInstance) {
  const items = music.queue?.items;
  return Boolean(items && items.length) || Boolean(music.nowPlayingItem);
}

async function ensureAuthorized(music: MusicKitInstance) {
  if (music.isAuthorized) return;
  const userToken = await music.authorize();
  if (!userToken || typeof userToken !== "string") {
    throw new Error("Connect Apple Music first — tap Connect Apple Music and sign in.");
  }
}

/**
 * Start or resume MusicKit from a user click. `play()` must stay in this
 * gesture — do not fetch/search before calling it.
 */
export function appleMusicCanPlayFromGesture(input = "") {
  if (parseAppleMusicSongIdFromInput(input)) return true;
  if (!input.trim()) {
    const music = getMusicKitInstance();
    if (music && hasQueue(music)) return true;
  }
  return songIdsForInput(input).length > 0;
}

async function musicForGesture(developerToken: string) {
  if (configuredToken === developerToken) {
    const ready = getMusicKitInstance();
    if (ready) return ready;
  }
  return configureMusicKit(developerToken);
}

export async function playAppleMusicFromGesture(developerToken: string, input = "") {
  const music = await musicForGesture(developerToken);
  await ensureAuthorized(music);
  const ids = songIdsForInput(input);
  if (!input.trim() && hasQueue(music)) {
    await music.play();
    emitPlayback();
    const now = readAppleMusicNowPlaying();
    return { ok: true as const, title: [now.title, now.artist].filter(Boolean).join(" — ") || "Apple Music" };
  }
  if (!ids.length) {
    try {
      await music.play();
    } catch {
      // unlock only — queue is not ready yet
    }
    emitPlayback();
    throw new Error("Search is still loading. Tap Play again in a moment.");
  }
  await music.setQueue(ids.length > 1 ? { songs: ids } : { song: ids[0] });
  await music.play();
  emitPlayback();
  const cached = cachedAppleMusicSongs(input.trim() || OUR_SONG_SEARCH)[0];
  const now = readAppleMusicNowPlaying();
  return {
    ok: true as const,
    title:
      [now.title, now.artist].filter(Boolean).join(" — ") ||
      (cached ? titleFromHit(cached) : "Apple Music"),
  };
}

export async function pauseAppleMusicPlayback(developerToken: string) {
  const music = await configureMusicKit(developerToken);
  if (music.pause) await music.pause();
  else await music.stop();
  emitPlayback();
}

/** Resume MusicKit if opening the mic / AudioContext paused it. Does not reset the queue. */
export async function resumeAppleMusicPlayback(developerToken: string) {
  const music = await musicForGesture(developerToken);
  const now = readAppleMusicNowPlaying();
  if (now.playing) {
    return {
      ok: true as const,
      title: [now.title, now.artist].filter(Boolean).join(" — ") || "Apple Music",
    };
  }
  if (!hasQueue(music)) {
    throw new Error("Nothing is queued on Apple Music.");
  }
  await music.play();
  emitPlayback();
  const resumed = readAppleMusicNowPlaying();
  return {
    ok: true as const,
    title: [resumed.title, resumed.artist].filter(Boolean).join(" — ") || "Apple Music",
  };
}

export async function skipAppleMusicFromGesture(developerToken: string, input = "") {
  const music = await musicForGesture(developerToken);
  await ensureAuthorized(music);
  try {
    if (music.skipToNextItem) {
      await music.skipToNextItem();
      if (music.isPlaying || music.playbackState === PLAYING_STATE) {
        emitPlayback();
        const now = readAppleMusicNowPlaying();
        return {
          ok: true as const,
          title: [now.title, now.artist].filter(Boolean).join(" — ") || "Apple Music",
        };
      }
    }
  } catch {
    // empty queue — fall through to a cached next track
  }
  const ids = songIdsForInput(input);
  const current = readAppleMusicNowPlaying().songId;
  const next = ids.find((id) => id !== current) || ids[1] || ids[0];
  if (!next) throw new Error("Nothing else is queued. Search a song, then tap Next.");
  await music.setQueue({ song: next });
  await music.play();
  emitPlayback();
  const now = readAppleMusicNowPlaying();
  return { ok: true as const, title: [now.title, now.artist].filter(Boolean).join(" — ") || "Apple Music" };
}

export async function authorizeAppleMusic(developerToken: string) {
  const music = await configureMusicKit(developerToken);
  const userToken = await music.authorize();
  if (!userToken || typeof userToken !== "string") {
    throw new Error("Apple Music sign-in was cancelled.");
  }
  return userToken;
}

export async function unauthorizeAppleMusic(developerToken: string) {
  try {
    const music = await configureMusicKit(developerToken);
    await music.unauthorize();
  } catch {
    // already signed out
  }
}

export async function playAppleMusicSong(developerToken: string, songId: string) {
  const music = await configureMusicKit(developerToken);
  if (!music.isAuthorized) {
    throw new Error("Connect Apple Music first — tap Connect Apple Music and sign in.");
  }
  await music.setQueue({ song: songId });
  await music.play();
  emitPlayback();
}

export async function stopAppleMusicPlayback(developerToken: string) {
  try {
    const music = await configureMusicKit(developerToken);
    await music.stop();
    emitPlayback();
  } catch {
    // nothing playing
  }
}
