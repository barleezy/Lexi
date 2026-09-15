import {
  isBlockedVideoHost,
  isRedirectStatus,
  looksLikeVideoContentType,
  parseVideoSourceUrl,
} from "@/lib/voice/video-proxy";

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

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  let parsed = parseVideoSourceUrl(raw);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  const range = request.headers.get("range");
  let hops = 0;
  let upstream: Response | null = null;

  while (hops < MAX_HOPS) {
    const headers: Record<string, string> = {
      Accept: "video/mp4,video/webm,video/*,*/*",
    };
    if (range) headers.Range = range;
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
    if (!looksLikeVideoContentType(contentType)) {
      return Response.json(
        { error: "That URL is not a direct video file. YouTube and similar sites need an uploaded file." },
        { status: 400 },
      );
    }
  }

  if (!upstream.ok && upstream.status !== 206) {
    return Response.json({ error: "Could not load the video." }, { status: 502 });
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
