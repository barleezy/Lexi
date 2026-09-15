import { refusePornSubject } from "@/lib/generate/safety";
import { isBlockedVideoHost, parseVideoSourceUrl } from "@/lib/voice/video-proxy";
import { adultEmbedUrl, extractAdultMediaFromHtml, isAdultPageUrl } from "@/lib/voice/watch-adult";

const PAGE_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MAX_HTML_BYTES = 1_500_000;
const LOGIN_HINT =
  /\b(?:log\s*in|sign\s*in|sign\s*up|create an account|members?\s+only|premium only|subscribe|subscription|join now|paid (?:members?|content)|membership required|verify your age|age verification required)\b/i;
const LOGIN_OR_PAID =
  "That video needs a login or paid membership on the site. We will not bypass a paywall. Open it there, or upload a file.";

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

export async function resolveAdultWatchPage(raw: string): Promise<
  | { ok: true; result: WatchResolveResult }
  | { ok: false; error: string; embedUrl?: string }
> {
  if (!isAdultPageUrl(raw)) {
    return { ok: false, error: "That is not a supported adult video page." };
  }
  const parsed = parseVideoSourceUrl(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  let upstream: Response;
  try {
    upstream = await fetch(parsed.href, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": PAGE_UA,
      },
    });
  } catch {
    return { ok: false, error: "Could not open that video page." };
  }

  const finalUrl = upstream.url || parsed.href;
  try {
    if (isBlockedVideoHost(new URL(finalUrl).hostname)) {
      return { ok: false, error: "That video host is not allowed." };
    }
  } catch {
    return { ok: false, error: "Invalid video host." };
  }

  if (upstream.status === 401 || upstream.status === 403) {
    return {
      ok: false,
      error: LOGIN_OR_PAID,
      embedUrl: adultEmbedUrl(finalUrl) || adultEmbedUrl(parsed.href),
    };
  }
  if (!upstream.ok) {
    return { ok: false, error: "Could not open that video page.", embedUrl: adultEmbedUrl(finalUrl) };
  }

  const type = (upstream.headers.get("content-type") || "").toLowerCase();
  if (type && !type.includes("html") && !type.includes("xml") && !type.includes("text/plain") && !type.includes("json")) {
    return { ok: false, error: "That URL is not an adult video page." };
  }

  const buffer = await upstream.arrayBuffer();
  const bytes = buffer.byteLength > MAX_HTML_BYTES ? buffer.slice(0, MAX_HTML_BYTES) : buffer;
  const html = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
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
        embedUrl: extracted.embedUrl,
        pageUrl: finalUrl,
      },
    };
  }

  if (looksLoggedOut(html, false)) {
    return {
      ok: false,
      error: LOGIN_OR_PAID,
      embedUrl: extracted.embedUrl,
    };
  }

  if (extracted.embedUrl) {
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

  return { ok: false, error: "Could not find a playable stream on that page. Try another video or upload a file." };
}
