import {
  APPLE_MUSIC_API,
  APPLE_MUSIC_SETUP,
  appleMusicStorefront,
  isAppleMusicConfigured,
  parseAppleMusicPlaylistId,
  parseAppleMusicPlaylistIdFromInput,
  parseAppleMusicQuery,
  parseAppleMusicSongId,
} from "./config";
import { mintAppleMusicDeveloperToken } from "./developer-token";

export type CatalogSong = {
  id: string;
  title: string;
  artist: string;
};

export type CatalogPlaylist = {
  id: string;
  title: string;
  curator: string;
};

async function appleFetch(
  path: string,
  init: RequestInit & { developerToken: string; userToken?: string },
) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${init.developerToken}`);
  headers.set("Accept", "application/json");
  if (init.userToken) headers.set("Music-User-Token", init.userToken);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const rest = { method: init.method, body: init.body };
  return fetch(`${APPLE_MUSIC_API}${path}`, { ...rest, headers });
}

function songFromData(row: {
  id?: string;
  attributes?: { name?: string; artistName?: string };
}): CatalogSong | null {
  if (!row.id) return null;
  return {
    id: row.id,
    title: row.attributes?.name?.trim() || "Unknown song",
    artist: row.attributes?.artistName?.trim() || "Unknown artist",
  };
}

function playlistFromData(row: {
  id?: string;
  attributes?: { name?: string; curatorName?: string };
}): CatalogPlaylist | null {
  if (!row.id) return null;
  return {
    id: row.id,
    title: row.attributes?.name?.trim() || "Untitled playlist",
    curator: row.attributes?.curatorName?.trim() || "",
  };
}

export async function searchCatalog(input: {
  query: string;
  developerToken: string;
  storefront?: string;
  limit?: number;
}) {
  const term = parseAppleMusicQuery(input.query);
  if (!term) return { ok: false as const, error: "A song, playlist, or artist is required." };
  const storefront = (input.storefront || appleMusicStorefront()).toLowerCase();
  const limit = Math.min(8, Math.max(1, input.limit ?? 5));
  const url = `/catalog/${encodeURIComponent(storefront)}/search?term=${encodeURIComponent(term)}&types=songs,playlists&limit=${limit}`;
  const response = await appleFetch(url, { method: "GET", developerToken: input.developerToken });
  if (!response.ok) {
    return {
      ok: false as const,
      error: `Apple Music search failed (${response.status}).`,
      status: response.status,
    };
  }
  const body = (await response.json()) as {
    results?: {
      songs?: { data?: Array<{ id?: string; attributes?: { name?: string; artistName?: string } }> };
      playlists?: { data?: Array<{ id?: string; attributes?: { name?: string; curatorName?: string } }> };
    };
  };
  const songs = (body.results?.songs?.data ?? [])
    .map(songFromData)
    .filter((song): song is CatalogSong => Boolean(song));
  const playlists = (body.results?.playlists?.data ?? [])
    .map(playlistFromData)
    .filter((playlist): playlist is CatalogPlaylist => Boolean(playlist));
  if (!songs.length && !playlists.length) {
    return { ok: false as const, error: `No Apple Music songs or playlists matched “${term}”.` };
  }
  return { ok: true as const, songs, playlists, query: term };
}

export async function searchCatalogSongs(input: {
  query: string;
  developerToken: string;
  storefront?: string;
  limit?: number;
}) {
  const found = await searchCatalog(input);
  if (!found.ok) {
    if (found.error === "A song, playlist, or artist is required.") {
      return { ok: false as const, error: "A song title or artist is required." };
    }
    if (found.error.startsWith("No Apple Music songs or playlists matched")) {
      const term = parseAppleMusicQuery(input.query);
      return { ok: false as const, error: `No Apple Music songs matched “${term}”.` };
    }
    return found;
  }
  if (!found.songs.length) return { ok: false as const, error: `No Apple Music songs matched “${found.query}”.` };
  return { ok: true as const, songs: found.songs, query: found.query };
}

export async function resolveCatalogPlaylist(input: {
  query?: string;
  playlistId?: string;
  developerToken: string;
  storefront?: string;
}) {
  const id =
    parseAppleMusicPlaylistId(input.playlistId) || parseAppleMusicPlaylistIdFromInput(input.query);
  const storefront = (input.storefront || appleMusicStorefront()).toLowerCase();
  if (id) {
    const url = `/catalog/${encodeURIComponent(storefront)}/playlists/${encodeURIComponent(id)}`;
    const response = await appleFetch(url, { method: "GET", developerToken: input.developerToken });
    if (response.ok) {
      const body = (await response.json()) as {
        data?: Array<{ id?: string; attributes?: { name?: string; curatorName?: string } }>;
      };
      const playlist = playlistFromData(body.data?.[0] ?? {});
      if (playlist) return { ok: true as const, playlist };
    }
    return { ok: true as const, playlist: { id, title: "", curator: "" } };
  }
  const found = await searchCatalog({
    query: input.query ?? "",
    developerToken: input.developerToken,
    limit: 5,
  });
  if (!found.ok) return found;
  if (!found.playlists.length) {
    return { ok: false as const, error: `No Apple Music playlists matched “${found.query}”.` };
  }
  return { ok: true as const, playlist: found.playlists[0] };
}

export async function resolveCatalogSong(input: {
  query?: string;
  songId?: string;
  developerToken: string;
}) {
  const id = parseAppleMusicSongId(input.songId);
  if (id) return { ok: true as const, song: { id, title: "", artist: "" } };
  const found = await searchCatalogSongs({
    query: input.query ?? "",
    developerToken: input.developerToken,
    limit: 1,
  });
  if (!found.ok) return found;
  return { ok: true as const, song: found.songs[0] };
}

export async function rateSong(input: {
  songId: string;
  developerToken: string;
  userToken: string;
  value?: 1 | -1;
}) {
  const id = parseAppleMusicSongId(input.songId);
  if (!id) return { ok: false as const, error: "A catalog song id is required." };
  const response = await appleFetch(`/me/ratings/songs/${encodeURIComponent(id)}`, {
    method: "PUT",
    developerToken: input.developerToken,
    userToken: input.userToken,
    body: JSON.stringify({ type: "rating", attributes: { value: input.value ?? 1 } }),
  });
  if (!response.ok) {
    return { ok: false as const, error: `Could not love that song (${response.status}).`, status: response.status };
  }
  return { ok: true as const, songId: id, rating: input.value ?? 1 };
}

export async function addSongToLibrary(input: {
  songId: string;
  developerToken: string;
  userToken: string;
}) {
  const id = parseAppleMusicSongId(input.songId);
  if (!id) return { ok: false as const, error: "A catalog song id is required." };
  const response = await appleFetch(`/me/library?ids[songs]=${encodeURIComponent(id)}`, {
    method: "POST",
    developerToken: input.developerToken,
    userToken: input.userToken,
  });
  if (!response.ok && response.status !== 202 && response.status !== 204) {
    return { ok: false as const, error: `Could not add that song to the library (${response.status}).`, status: response.status };
  }
  return { ok: true as const, songId: id };
}

async function findLibraryPlaylist(input: {
  name: string;
  developerToken: string;
  userToken: string;
}) {
  const wanted = input.name.trim().toLowerCase();
  const response = await appleFetch(`/me/library/playlists?limit=25`, {
    method: "GET",
    developerToken: input.developerToken,
    userToken: input.userToken,
  });
  if (!response.ok) return null;
  const body = (await response.json()) as {
    data?: Array<{ id?: string; attributes?: { name?: string } }>;
  };
  return (
    body.data?.find((row) => (row.attributes?.name ?? "").trim().toLowerCase() === wanted)?.id ??
    null
  );
}

export async function addSongToPlaylist(input: {
  songId: string;
  playlistName: string;
  developerToken: string;
  userToken: string;
}) {
  const id = parseAppleMusicSongId(input.songId);
  const name = input.playlistName.trim().slice(0, 80) || "Lexi";
  if (!id) return { ok: false as const, error: "A catalog song id is required." };
  const existing = await findLibraryPlaylist({
    name,
    developerToken: input.developerToken,
    userToken: input.userToken,
  });
  if (existing) {
    const response = await appleFetch(`/me/library/playlists/${encodeURIComponent(existing)}/tracks`, {
      method: "POST",
      developerToken: input.developerToken,
      userToken: input.userToken,
      body: JSON.stringify({ data: [{ id, type: "songs" }] }),
    });
    if (!response.ok && response.status !== 202 && response.status !== 204) {
      return { ok: false as const, error: `Could not add that song to “${name}” (${response.status}).` };
    }
    return { ok: true as const, songId: id, playlist: name, playlistId: existing };
  }
  const created = await appleFetch(`/me/library/playlists`, {
    method: "POST",
    developerToken: input.developerToken,
    userToken: input.userToken,
    body: JSON.stringify({
      attributes: { name },
      relationships: { tracks: { data: [{ id, type: "songs" }] } },
    }),
  });
  if (!created.ok && created.status !== 201 && created.status !== 202) {
    return { ok: false as const, error: `Could not create playlist “${name}” (${created.status}).` };
  }
  const body = (await created.json().catch(() => ({}))) as { data?: Array<{ id?: string }> };
  return { ok: true as const, songId: id, playlist: name, playlistId: body.data?.[0]?.id ?? "" };
}

export function appleMusicNotConfiguredResult() {
  return {
    ok: false as const,
    configured: false,
    connected: false,
    error: "Apple Music is not configured.",
    setup: APPLE_MUSIC_SETUP,
  };
}

export function requireAppleMusicConfig() {
  if (isAppleMusicConfigured()) return null;
  return appleMusicNotConfiguredResult();
}

export async function requireDeveloperToken() {
  const missing = requireAppleMusicConfig();
  if (missing) return missing;
  const minted = mintAppleMusicDeveloperToken();
  if (!minted.ok) {
    return { ok: false as const, configured: true, connected: false, error: minted.error, setup: APPLE_MUSIC_SETUP };
  }
  return { ok: true as const, token: minted.token, exp: minted.exp };
}
