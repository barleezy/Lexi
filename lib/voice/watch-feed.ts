import { PORN_REFUSAL } from "@/lib/generate/safety";
import { isPageLikeVideoUrl, titleFromVideoUrl } from "@/lib/voice/video";
import {
  CLOUDFLARE_DIRECT_HINT,
  DIRECT_STREAM_HINT,
  extractAdultMediaFromHtml,
  isAdultPageUrl,
  isCloudflareChallenge,
  isDirectWatchMediaUrl,
  isWatchHlsUrl,
  isXnxxTubeUrl,
  normalizeAdultWatchInput,
  proxiedWatchMedia,
  watchStreamKind,
} from "@/lib/voice/watch-adult";
import { directVideoHref } from "@/lib/voice/watch-formats";
import { resolveWatchUrl } from "@/lib/voice/watch-resolve";

export type WatchFeedErrorCode =
  | "invalid_url"
  | "unsupported_url"
  | "blocked_page"
  | "blocked_host"
  | "cloudflare"
  | "login_required"
  | "no_stream"
  | "age_gate"
  | "network"
  | "hls_fail";

export type WatchFeedClass = "direct" | "adult-page" | "blocked-page" | "unsupported";

export type WatchFeedMedia = {
  ok: true;
  kind: "hls" | "mp4";
  title: string;
  mediaUrl: string;
  playable: string;
  pageUrl: string;
  raw: string;
};

export type WatchFeedError = {
  ok: false;
  code: WatchFeedErrorCode;
  error: string;
  embedUrl?: string;
};

export type WatchFeedResult = WatchFeedMedia | WatchFeedError;

export const WATCH_FEED_ERRORS: Record<WatchFeedErrorCode, string> = {
  invalid_url: "That is not a valid video URL.",
  unsupported_url: DIRECT_STREAM_HINT,
  blocked_page:
    "YouTube and similar pages will not play here. Upload a file or paste a direct video URL.",
  blocked_host: "That video host is not allowed.",
  cloudflare: CLOUDFLARE_DIRECT_HINT,
  login_required:
    "That video needs a login or paid membership on the site. We will not bypass a paywall. Open it there, or upload a file.",
  no_stream: `Could not find a playable stream on that page. ${DIRECT_STREAM_HINT}`,
  age_gate: PORN_REFUSAL,
  network: "Could not open that video. Check the link and try again.",
  hls_fail: "Could not play that HLS stream. Paste another m3u8 or mp4 URL, or try again.",
};

export function watchFeedError(
  code: WatchFeedErrorCode,
  error = WATCH_FEED_ERRORS[code],
  embedUrl = "",
): WatchFeedError {
  return embedUrl ? { ok: false, code, error, embedUrl } : { ok: false, code, error };
}

export function classifyWatchFeed(raw: string): WatchFeedClass {
  const trimmed = normalizeAdultWatchInput(raw);
  if (!trimmed) return "unsupported";
  if (isPageLikeVideoUrl(trimmed)) return "blocked-page";
  if (isDirectWatchMediaUrl(trimmed)) return "direct";
  if (isXnxxTubeUrl(trimmed) || isAdultPageUrl(trimmed)) return "adult-page";
  if (directVideoHref(trimmed) && /^https?:\/\//i.test(trimmed) && !isAdultPageUrl(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (/\.(?:mp4|webm|m3u8|mov|m4v)(?:$|[/?#])/i.test(parsed.pathname + parsed.search)) {
        return "direct";
      }
    } catch {
      return "unsupported";
    }
  }
  return "unsupported";
}

export function playableWatchFeedSrc(mediaUrl: string, pageUrl = "") {
  return proxiedWatchMedia(mediaUrl, pageUrl) || mediaUrl;
}

function specFromMedia(
  raw: string,
  title: string,
  mediaUrl: string,
  kind: "hls" | "mp4",
  pageUrl: string,
): WatchFeedMedia {
  return {
    ok: true,
    kind: kind === "hls" || isWatchHlsUrl(mediaUrl) ? "hls" : "mp4",
    title: title || titleFromVideoUrl(raw),
    mediaUrl,
    playable: playableWatchFeedSrc(mediaUrl, pageUrl || raw),
    pageUrl: pageUrl || raw,
    raw,
  };
}

function mapResolveError(error: string, embedUrl?: string): WatchFeedError {
  const text = error.trim() || WATCH_FEED_ERRORS.no_stream;
  if (text === PORN_REFUSAL || /under\s*18|minor/i.test(text)) {
    return watchFeedError("age_gate", text, embedUrl);
  }
  if (text === CLOUDFLARE_DIRECT_HINT || /cloudflare|just a moment/i.test(text)) {
    return watchFeedError("cloudflare", text, embedUrl);
  }
  if (/log\s*in|paid membership|paywall/i.test(text)) {
    return watchFeedError("login_required", text, embedUrl);
  }
  if (/not allowed/i.test(text)) return watchFeedError("blocked_host", text);
  if (/not a supported/i.test(text)) return watchFeedError("unsupported_url", text);
  if (/could not open/i.test(text)) return watchFeedError("network", text);
  if (/could not find a playable stream/i.test(text)) {
    return watchFeedError("no_stream", text, embedUrl);
  }
  return watchFeedError("no_stream", text, embedUrl);
}

/** Server-side feed handler: URL in → HLS/mp4 spec or a typed error. */
export async function resolveWatchFeed(raw: string): Promise<WatchFeedResult> {
  const trimmed = normalizeAdultWatchInput(raw);
  if (!trimmed) return watchFeedError("invalid_url");

  const classified = classifyWatchFeed(trimmed);
  if (classified === "blocked-page") return watchFeedError("blocked_page");
  if (classified === "unsupported") return watchFeedError("unsupported_url");

  try {
    const resolved = await resolveWatchUrl(trimmed);
    if (!resolved.ok) {
      return mapResolveError(resolved.error, resolved.embedUrl);
    }
    if (resolved.result.mediaUrl) {
      return specFromMedia(
        trimmed,
        resolved.result.title,
        resolved.result.mediaUrl,
        resolved.result.kind,
        resolved.result.pageUrl,
      );
    }
    return watchFeedError("no_stream", WATCH_FEED_ERRORS.no_stream, resolved.result.embedUrl);
  } catch {
    return watchFeedError("network");
  }
}

export function parseWatchFeedJson(body: unknown, raw = ""): WatchFeedResult {
  if (!body || typeof body !== "object") return watchFeedError("network");
  const row = body as Record<string, unknown>;
  if (row.ok === false) {
    const code = typeof row.code === "string" ? row.code : "no_stream";
    const error = typeof row.error === "string" && row.error.trim() ? row.error : WATCH_FEED_ERRORS.no_stream;
    const embedUrl = typeof row.embedUrl === "string" ? row.embedUrl : "";
    if (code in WATCH_FEED_ERRORS) {
      return watchFeedError(code as WatchFeedErrorCode, error, embedUrl);
    }
    return mapResolveError(error, embedUrl);
  }
  const mediaUrl = typeof row.mediaUrl === "string" ? row.mediaUrl : "";
  if (!mediaUrl) {
    const error = typeof row.error === "string" ? row.error : "";
    const embedUrl = typeof row.embedUrl === "string" ? row.embedUrl : "";
    if (error) return mapResolveError(error, embedUrl);
    return watchFeedError("no_stream", WATCH_FEED_ERRORS.no_stream, embedUrl);
  }
  const kind = row.kind === "hls" || isWatchHlsUrl(mediaUrl) ? "hls" : "mp4";
  const title = typeof row.title === "string" ? row.title : "";
  const pageUrl = typeof row.pageUrl === "string" && row.pageUrl ? row.pageUrl : raw;
  const playable =
    typeof row.playable === "string" && row.playable
      ? row.playable
      : playableWatchFeedSrc(mediaUrl, pageUrl);
  return {
    ok: true,
    kind,
    title: title || titleFromVideoUrl(raw || mediaUrl),
    mediaUrl,
    playable,
    pageUrl,
    raw: typeof row.raw === "string" && row.raw ? row.raw : raw,
  };
}

async function tryBrowserExtract(pageUrl: string): Promise<WatchFeedResult | null> {
  try {
    const response = await fetch(pageUrl, {
      mode: "cors",
      credentials: "omit",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) return null;
    const html = (await response.text()).slice(0, 1_500_000);
    if (!html || isCloudflareChallenge(html)) return null;
    const extracted = extractAdultMediaFromHtml(html, response.url || pageUrl);
    if (!extracted.media) return null;
    return specFromMedia(
      pageUrl,
      extracted.title,
      extracted.media.href,
      extracted.media.kind,
      response.url || pageUrl,
    );
  } catch {
    return null;
  }
}

/** Browser feed handler: same spec as resolveWatchFeed, via /api/video/resolve. */
export async function requestWatchFeed(raw: string): Promise<WatchFeedResult> {
  const trimmed = normalizeAdultWatchInput(raw);
  if (!trimmed) return watchFeedError("invalid_url");

  const classified = classifyWatchFeed(trimmed);
  if (classified === "blocked-page") return watchFeedError("blocked_page");
  if (classified === "unsupported") return watchFeedError("unsupported_url");

  try {
    const response = await fetch(`/api/video/resolve?url=${encodeURIComponent(trimmed)}`);
    let body: unknown = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    const parsed = parseWatchFeedJson(body, trimmed);
    if (parsed.ok) return parsed;
    if (
      classified === "adult-page" &&
      (parsed.code === "cloudflare" || parsed.code === "no_stream" || parsed.code === "network")
    ) {
      const extracted = await tryBrowserExtract(trimmed);
      if (extracted) return extracted;
    }
    return parsed;
  } catch {
    if (classified === "direct") {
      const href = directVideoHref(trimmed);
      if (href) {
        return specFromMedia(trimmed, titleFromVideoUrl(trimmed), href, watchStreamKind(href), href);
      }
    }
    if (classified === "adult-page") {
      const extracted = await tryBrowserExtract(trimmed);
      if (extracted) return extracted;
    }
    return watchFeedError("network");
  }
}
