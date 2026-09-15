import {
  isBlockedVideoHost,
  isRedirectStatus,
  looksLikeVideoContentType,
  parseVideoSourceUrl,
} from "@/lib/voice/video-proxy";

export const maxDuration = 60;

const MAX_HOPS = 3;
const PASS_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges", "etag", "last-modified"];

function hopUrl(location: string | null, current: string) {
  if (!location) return { ok: false as const, error: "Redirect missing Location." };
  try {
    return parseVideoSourceUrl(new URL(location, current).href);
  } catch {
    return { ok: false as const, error: "Invalid redirect URL." };
  }
}

function proxyFail(status: number) {
  if (status === 401 || status === 403) {
    return "The video host blocked the watch proxy. Paste a different direct URL or upload the file.";
  }
  if (status === 404) return "That video URL was not found.";
  return "Could not load the video.";
}

function isHlsPlaylist(url: string, contentType: string | null) {
  const type = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.includes("mpegurl")) return true;
  return /\.m3u8(?:$|[?#])/i.test(url);
}

function rewriteHlsPlaylist(text: string, pageUrl: string, referer: string) {
  const proxyLine = (href: string) => {
    const parsed = parseVideoSourceUrl(href);
    if (!parsed.ok) return href;
    const base = `/api/video/proxy?url=${encodeURIComponent(parsed.href)}`;
    return referer ? `${base}&referer=${encodeURIComponent(referer)}` : base;
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/i, (all, uri: string) => {
          try {
            return `URI="${proxyLine(new URL(uri, pageUrl).href)}"`;
          } catch {
            return all;
          }
        });
      }
      try {
        return proxyLine(new URL(trimmed, pageUrl).href);
      } catch {
        return line;
      }
    })
    .join("\n");
}

export async function GET(request: Request) {
  const incoming = new URL(request.url);
  const raw = incoming.searchParams.get("url");
  let parsed = parseVideoSourceUrl(raw);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const range = request.headers.get("range");
  const userAgent = request.headers.get("user-agent");
  const refererParam = parseVideoSourceUrl(incoming.searchParams.get("referer"));
  const referer = refererParam.ok ? refererParam.href : request.headers.get("referer");
  let hops = 0;
  let upstream: Response | null = null;

  try {
    while (hops < MAX_HOPS) {
      const headers: Record<string, string> = {
        Accept: "application/vnd.apple.mpegurl,application/x-mpegURL,video/mp4,video/webm,video/*,*/*",
      };
      if (range) headers.Range = range;
      if (userAgent) headers["User-Agent"] = userAgent;
      if (referer) headers.Referer = referer;
      upstream = await fetch(parsed.href, {
        redirect: "manual",
        headers,
      });
      if (!isRedirectStatus(upstream.status)) break;
      const next = hopUrl(upstream.headers.get("location"), parsed.href);
      if (!next.ok) {
        return Response.json({ error: next.error }, { status: 400 });
      }
      parsed = next;
      hops += 1;
    }
  } catch {
    return Response.json({ error: "Could not load the video." }, { status: 502 });
  }

  if (!upstream) {
    return Response.json({ error: "Could not load the video." }, { status: 502 });
  }

  if (isRedirectStatus(upstream.status)) {
    return Response.json({ error: "Too many redirects." }, { status: 400 });
  }

  try {
    const finalHost = new URL(upstream.url || parsed.href).hostname;
    if (isBlockedVideoHost(finalHost)) {
      return Response.json({ error: "That video host is not allowed." }, { status: 400 });
    }
  } catch {
    return Response.json({ error: "Invalid video host." }, { status: 400 });
  }

  const contentType = upstream.headers.get("content-type");
  if (upstream.ok || upstream.status === 206) {
    if (!looksLikeVideoContentType(contentType, parsed.href)) {
      return Response.json(
        { error: "That URL is not a direct video file. YouTube and similar sites need an uploaded file." },
        { status: 400 },
      );
    }
  }

  if (!upstream.ok && upstream.status !== 206) {
    return Response.json({ error: proxyFail(upstream.status) }, { status: 502 });
  }

  if ((upstream.ok || upstream.status === 206) && isHlsPlaylist(parsed.href, contentType)) {
    const text = await upstream.text();
    if (text.trim().startsWith("#EXTM3U")) {
      const rewritten = rewriteHlsPlaylist(text, parsed.href, referer || parsed.href);
      return new Response(rewritten, {
        status: 200,
        headers: {
          "content-type": "application/vnd.apple.mpegurl",
          "cache-control": "private, max-age=60",
        },
      });
    }
    const headers = new Headers();
    for (const name of PASS_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("cache-control", "private, max-age=3600");
    return new Response(text, { status: upstream.status, headers });
  }

  const headers = new Headers();
  for (const name of PASS_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("content-type")) headers.set("content-type", "video/mp4");
  headers.set("cache-control", "private, max-age=3600");

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
