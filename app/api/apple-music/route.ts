import {
  addSongToLibrary,
  addSongToPlaylist,
  appleMusicNotConfiguredResult,
  rateSong,
  requireDeveloperToken,
  resolveCatalogPlaylist,
  resolveCatalogSong,
  searchCatalog,
} from "@/lib/apple-music/api";
import {
  APPLE_MUSIC_SETUP,
  APPLE_MUSIC_USER_COOKIE,
  APPLE_MUSIC_USER_COOKIE_MAX_AGE,
  appleMusicStorefront,
  isAppleMusicConfigured,
  parseAppleMusicAction,
  parseAppleMusicPlaylistId,
  parseAppleMusicQuery,
  parseAppleMusicSongId,
} from "@/lib/apple-music/config";
import { cookies } from "next/headers";

export const maxDuration = 30;

async function readUserToken() {
  const jar = await cookies();
  return jar.get(APPLE_MUSIC_USER_COOKIE)?.value?.trim() ?? "";
}

async function writeUserToken(token: string) {
  const jar = await cookies();
  jar.set(APPLE_MUSIC_USER_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: APPLE_MUSIC_USER_COOKIE_MAX_AGE,
  });
}

async function clearUserToken() {
  const jar = await cookies();
  jar.delete(APPLE_MUSIC_USER_COOKIE);
}

export async function GET() {
  const configured = isAppleMusicConfigured();
  const connected = Boolean(await readUserToken());
  if (!configured) {
    return Response.json({
      ok: false,
      configured: false,
      connected: false,
      storefront: appleMusicStorefront(),
      setup: APPLE_MUSIC_SETUP,
      error: "Apple Music is not configured.",
    });
  }
  const minted = await requireDeveloperToken();
  if (!minted.ok) {
    return Response.json(
      {
        ok: false,
        configured: true,
        connected,
        storefront: appleMusicStorefront(),
        setup: APPLE_MUSIC_SETUP,
        error: minted.error,
      },
      { status: 503 },
    );
  }
  return Response.json({
    ok: true,
    configured: true,
    connected,
    storefront: appleMusicStorefront(),
    developerToken: minted.token,
  });
}

export async function POST(request: Request) {
  let body: {
    action?: unknown;
    tool?: unknown;
    userToken?: unknown;
    query?: unknown;
    song?: unknown;
    songId?: unknown;
    id?: unknown;
    playlist?: unknown;
    playlistId?: unknown;
    playlistName?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = parseAppleMusicAction(body.action ?? body.tool);
  if (!action) {
    return Response.json({ error: "action must be connect, disconnect, status, love, library, playlist, or search." }, { status: 400 });
  }

  if (action === "disconnect") {
    await clearUserToken();
    return Response.json({ ok: true, configured: isAppleMusicConfigured(), connected: false });
  }

  const minted = await requireDeveloperToken();
  if (!minted.ok) {
    return Response.json(minted.ok === false ? minted : appleMusicNotConfiguredResult(), {
      status: 503,
    });
  }

  if (action === "connect") {
    const userToken = typeof body.userToken === "string" ? body.userToken.trim() : "";
    if (!userToken) {
      return Response.json(
        { error: "userToken from MusicKit.authorize() is required.", configured: true, connected: false },
        { status: 400 },
      );
    }
    await writeUserToken(userToken);
    return Response.json({ ok: true, configured: true, connected: true });
  }

  if (action === "status") {
    return Response.json({
      ok: true,
      configured: true,
      connected: Boolean(await readUserToken()),
      storefront: appleMusicStorefront(),
    });
  }

  if (action === "search") {
    const query = parseAppleMusicQuery(body.query ?? body.song);
    const playlistId = parseAppleMusicPlaylistId(body.playlistId);
    if (playlistId && !query) {
      const resolved = await resolveCatalogPlaylist({
        playlistId,
        developerToken: minted.token,
      });
      if (!resolved.ok) {
        return Response.json({ ...resolved, configured: true }, { status: 404 });
      }
      return Response.json({
        ok: true,
        configured: true,
        songs: [],
        playlists: [resolved.playlist],
        playlist: resolved.playlist,
        query: playlistId,
      });
    }
    const found = await searchCatalog({ query, developerToken: minted.token });
    if (!found.ok) {
      return Response.json({ ...found, configured: true }, { status: 404 });
    }
    return Response.json({ ...found, configured: true });
  }

  const userToken = await readUserToken();
  if (!userToken) {
    return Response.json(
      {
        ok: false,
        configured: true,
        connected: false,
        error: "Connect Apple Music first — tap Connect Apple Music and sign in.",
      },
      { status: 401 },
    );
  }

  const resolved = await resolveCatalogSong({
    query: parseAppleMusicQuery(body.query ?? body.song),
    songId: parseAppleMusicSongId(body.songId ?? body.id),
    developerToken: minted.token,
  });
  if (!resolved.ok) {
    return Response.json({ ...resolved, configured: true, connected: true }, { status: 404 });
  }

  if (action === "love") {
    const rated = await rateSong({
      songId: resolved.song.id,
      developerToken: minted.token,
      userToken,
      value: 1,
    });
    if (!rated.ok) {
      return Response.json({ ...rated, configured: true, connected: true, song: resolved.song }, { status: 502 });
    }
    return Response.json({
      ok: true,
      configured: true,
      connected: true,
      action: "love",
      song: resolved.song,
    });
  }

  if (action === "library") {
    const added = await addSongToLibrary({
      songId: resolved.song.id,
      developerToken: minted.token,
      userToken,
    });
    if (!added.ok) {
      return Response.json({ ...added, configured: true, connected: true, song: resolved.song }, { status: 502 });
    }
    return Response.json({
      ok: true,
      configured: true,
      connected: true,
      action: "library",
      song: resolved.song,
    });
  }

  const playlistName =
    (typeof body.playlistName === "string" && body.playlistName.trim()) ||
    (typeof body.playlist === "string" && body.playlist.trim()) ||
    "Lexi";
  const playlist = await addSongToPlaylist({
    songId: resolved.song.id,
    playlistName,
    developerToken: minted.token,
    userToken,
  });
  if (!playlist.ok) {
    return Response.json({ ...playlist, configured: true, connected: true, song: resolved.song }, { status: 502 });
  }
  return Response.json({
    ok: true,
    configured: true,
    connected: true,
    action: "playlist",
    song: resolved.song,
    playlist: playlist.playlist,
  });
}
