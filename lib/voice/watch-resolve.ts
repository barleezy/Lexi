import { refusePornSubject } from "@/lib/generate/safety";
import { isBlockedVideoHost, parseVideoSourceUrl } from "@/lib/voice/video-proxy";
import {
  adultEmbedCanFrame,
  adultEmbedUrl,
  ashemaletubeVideoPageUrl,
  CLOUDFLARE_DIRECT_HINT,
  DIRECT_STREAM_HINT,
  extractAdultMediaFromHtml,
  isAdultPageUrl,
  isCloudflareChallenge,
  isDirectWatchMediaUrl,
  normalizeAdultWatchInput,
  watchStreamKind,
} from "@/lib/voice/watch-adult";

const PAGE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAX_HTML_BYTES = 1_500_000;
const LOGIN_HINT =
  /\b(?:log\s*in|sign\s*in|sign\s*up|create an account|members?\s+only|premium only|subscribe|subscription|join now|paid (?:members?|content)|membership required|verify your age|age verification required)\b/i;
const LOGIN_OR_PAID =
  "That video needs a login or paid membership on the site. We will not bypass a paywall. Open it there, or upload a file.";

function usableEmbed(url: string) {
  return url && adultEmbedCanFrame(url) ? url : "";
}

export type WatchResolveResult = {
  title: string;
  mediaUrl: string;
  kind: "mp4" | "hls";
  embedUrl: string;
  pageUrl: string;
};

function looksLoggedOut(html: string, hasMedia: boolean) {
  if (hasMedia) return false;
  return LOGIN_HINT.test(html);
}

async function readHtml(response: Response) {
  try {
    const buffer = await response.arrayBuffer();
    const bytes = buffer.byteLength > MAX_HTML_BYTES ? buffer.slice(0, MAX_HTML_BYTES) : buffer;
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

async function fetchAdultHtml(href: string) {
  const upstream = await fetch(href, {
    redirect: "follow",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": PAGE_UA,
    },
  });
  const finalUrl = upstream.url || href;
  const html = await readHtml(upstream);
  return { ok: upstream.ok, status: upstream.status, finalUrl, html };
}

function finishExtract(
  html: string,
  finalUrl: string,
): { ok: true; result: WatchResolveResult } | { ok: false; error: string; embedUrl?: string } {
  const extracted = extractAdultMediaFromHtml(html, finalUrl);
  const safetyText = [extracted.title, extracted.embedUrl].filter(Boolean).join(" ");
  if (safetyText) {
    const safety = refusePornSubject(safetyText);
    if (!safety.ok) return { ok: false, error: safety.error };
  }
  if (extracted.media) {
    return {
      ok: true,
      result: {
        title: extracted.title || "Adult video",
        mediaUrl: extracted.media.href,
        kind: extracted.media.kind,
        embedUrl: usableEmbed(extracted.embedUrl),
        pageUrl: finalUrl,
      },
    };
  }
  if (looksLoggedOut(html, false)) {
    return { ok: false, error: LOGIN_OR_PAID, embedUrl: usableEmbed(extracted.embedUrl) };
  }
  if (usableEmbed(extracted.embedUrl)) {
    return {
      ok: true,
      result: {
        title: extracted.title || "Adult video",
        mediaUrl: "",
        kind: "mp4",
        embedUrl: extracted.embedUrl,
        pageUrl: finalUrl,
      },
    };
  }
  return {
    ok: false,
    error: `Could not find a playable stream on that page. ${DIRECT_STREAM_HINT}`,
  };
}

function titleFromWatchUrl(href: string) {
  try {
    const last = decodeURIComponent(new URL(href).pathname.split("/").filter(Boolean).pop() ?? "");
    return last || "Video";
  } catch {
    return "Video";
  }
}

export function resolveDirectWatchMedia(raw: string):
  | { ok: true; result: WatchResolveResult }
  | { ok: false; error: string }
  | null {
  const input = normalizeAdultWatchInput(raw);
  if (!isDirectWatchMediaUrl(input)) return null;
  const parsed = parseVideoSourceUrl(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  return {
    ok: true,
    result: {
      title: titleFromWatchUrl(parsed.href),
      mediaUrl: parsed.href,
      kind: watchStreamKind(parsed.href),
      embedUrl: "",
      pageUrl: parsed.href,
    },
  };
}

export async function resolveWatchUrl(raw: string): Promise<
  | { ok: true; result: WatchResolveResult }
  | { ok: false; error: string; embedUrl?: string }
> {
  const direct = resolveDirectWatchMedia(raw);
  if (direct) return direct;
  return resolveAdultWatchPage(raw);
}

export async function resolveAdultWatchPage(raw: string): Promise<
  | { ok: true; result: WatchResolveResult }
  | { ok: false; error: string; embedUrl?: string }
> {
  const page = normalizeAdultWatchInput(raw);
  const direct = resolveDirectWatchMedia(page);
  if (direct) return direct;
  if (!isAdultPageUrl(page)) {
    return { ok: false, error: "That is not a supported adult video page." };
  }
  const parsed = parseVideoSourceUrl(page);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  let fetched: Awaited<ReturnType<typeof fetchAdultHtml>>;
  try {
    fetched = await fetchAdultHtml(parsed.href);
  } catch {
    return { ok: false, error: "Could not open that video page." };
  }

  try {
    if (isBlockedVideoHost(new URL(fetched.finalUrl).hostname)) {
      return { ok: false, error: "That video host is not allowed." };
    }
  } catch {
    return { ok: false, error: "Invalid video host." };
  }

  if (isCloudflareChallenge(fetched.html) || (!fetched.ok && !fetched.html)) {
    const alt = ashemaletubeVideoPageUrl(fetched.finalUrl) || ashemaletubeVideoPageUrl(parsed.href);
    if (alt && alt !== fetched.finalUrl) {
      try {
        const retry = await fetchAdultHtml(alt);
        if (retry.html && !isCloudflareChallenge(retry.html)) {
          return finishExtract(retry.html, retry.finalUrl);
        }
      } catch {
        // fall through
      }
    }
    if (isCloudflareChallenge(fetched.html) || fetched.status === 403) {
      return { ok: false, error: CLOUDFLARE_DIRECT_HINT };
    }
  }

  if (!fetched.ok && fetched.html) {
    const extracted = finishExtract(fetched.html, fetched.finalUrl);
    if (extracted.ok) return extracted;
    if (fetched.status === 401 || fetched.status === 403) {
      return {
        ok: false,
        error: LOGIN_OR_PAID,
        embedUrl: usableEmbed(adultEmbedUrl(fetched.finalUrl) || adultEmbedUrl(parsed.href)),
      };
    }
    return { ok: false, error: "Could not open that video page." };
  }

  if (!fetched.ok) {
    return { ok: false, error: "Could not open that video page." };
  }

  return finishExtract(fetched.html, fetched.finalUrl);
}
