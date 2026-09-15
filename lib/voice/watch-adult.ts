const KNOWN_ADULT_HOSTS = [
  "pornhub.com",
  "pornhub.org",
  "pornhubpremium.com",
  "xvideos.com",
  "xvideos.es",
  "xnxx.com",
  "xnxx.es",
  "xnxx.tv",
  "xhamster.com",
  "xhamster.desi",
  "xhwebsite.com",
  "redtube.com",
  "spankbang.com",
  "youporn.com",
  "tube8.com",
  "youjizz.com",
  "tnaflix.com",
  "eporner.com",
  "porntube.com",
  "ashemaletube.com",
  "transangels.com",
  "adulttime.com",
  "thegay.com",
];

const ADULT_HOST_HINT =
  /(?:porn|xxx|xvideos|xnxx|xhamster|redtube|spankbang|youporn|tube8|youjizz|pornhub|eporner|tnaflix|ashemaletube|transangels|adulttime|thegay)/i;
const ADULT_PATH =
  /\/(?:view_video(?:\.php)?|video-|video\/|videos\/|embedframe\/|embed\/|xembed\.php)/i;

const XNXX_HOSTS = ["xnxx.com", "xnxx.es", "xnxx.tv", "xnxx-cdn.com"];
const ADULT_CDN_REFERER: Array<[string, string]> = [["xnxx-cdn.com", "https://www.xnxx.com/"]];

function pageHost(raw: string) {
  try {
    return new URL(raw.trim()).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function hostMatchesList(host: string) {
  return KNOWN_ADULT_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

const DIRECT_MEDIA_EXT =
  /\.(?:mp4|webm|m3u8|mov|m4v|mkv|avi|flv|wmv|asf|mpeg|mpg|mpe|ogv|ogg|3gp|3g2|ts|m2ts|mts)(?:$|[/?#])/i;
const DIRECT_MEDIA_PATH = /\/(?:get_file|get_media|video_redirect|get_video)\b/i;

export const DIRECT_STREAM_HINT =
  "Paste a direct video file or stream URL (mp4, webm, m3u8, or get_file). It plays in this feed — no embed.";

export const CLOUDFLARE_DIRECT_HINT =
  "That site is blocking our server (Cloudflare). Official embeds will not play inside Lexi. Paste the direct mp4, webm, m3u8, or get_file URL into this box — it plays in the watch feed. If this browser cannot read the page (CORS), the site page will not work; you need the file/stream URL.";

function hostMatchesSuffix(host: string, known: string) {
  return host === known || host.endsWith(`.${known}`);
}

export function isXnxxHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  return XNXX_HOSTS.some((known) => hostMatchesSuffix(host, known));
}

export function isXnxxTubeUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    if (!isXnxxHost(parsed.hostname)) return false;
    if (isDirectWatchMediaUrl(raw)) return false;
    const path = parsed.pathname;
    return (
      /\/video-[a-z0-9]+/i.test(path) ||
      /\/embedframe\/[a-z0-9]+/i.test(path) ||
      isAdultPageUrl(raw)
    );
  } catch {
    return false;
  }
}

export function isAdultPageHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  if (!host) return false;
  return hostMatchesList(host) || isXnxxHost(host) || ADULT_HOST_HINT.test(host);
}

export type WatchResolveKind = "mp4" | "hls";

export function isWatchHlsUrl(raw: string) {
  return /\.m3u8(?:$|[/?#])/i.test(raw.trim());
}

export function watchStreamKind(raw: string): WatchResolveKind {
  return isWatchHlsUrl(raw) ? "hls" : "mp4";
}

export function isDirectWatchMediaUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return false;
    if (DIRECT_MEDIA_EXT.test(parsed.pathname) || DIRECT_MEDIA_EXT.test(parsed.href)) return true;
    if (DIRECT_MEDIA_PATH.test(parsed.pathname + parsed.search)) return true;
    return false;
  } catch {
    return false;
  }
}

export function isAdultPageUrl(raw: string) {
  try {
    if (isDirectWatchMediaUrl(raw)) return false;
    const parsed = new URL(raw.trim());
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtube.com" || host === "youtu.be" || host.endsWith(".youtube.com") || host === "vimeo.com") {
      return false;
    }
    if (hostMatchesList(host)) return true;
    if (ADULT_PATH.test(parsed.pathname + parsed.search) && ADULT_HOST_HINT.test(host)) return true;
    return false;
  } catch {
    return false;
  }
}

export function adultEmbedUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    const path = parsed.pathname;
    if (host.endsWith("pornhub.com") || host.endsWith("pornhub.org") || host.endsWith("pornhubpremium.com")) {
      const key = parsed.searchParams.get("viewkey") || /viewkey=([a-z0-9]+)/i.exec(raw)?.[1];
      return key ? `https://www.pornhub.com/embed/${key}` : "";
    }
    if (host.includes("xvideos")) {
      const id = /\/video(\d+)/i.exec(path)?.[1];
      return id ? `https://www.xvideos.com/embedframe/${id}` : "";
    }
    if (host.includes("xnxx")) {
      const id =
        /\/video-([a-z0-9]+)/i.exec(path)?.[1] || /\/embedframe\/([a-z0-9]+)/i.exec(path)?.[1];
      return id ? `https://www.xnxx.com/embedframe/${id}` : "";
    }
    if (host.includes("xhamster") || host.includes("xhwebsite")) {
      const id = /\/videos\/[^/]*-(\d+)$/i.exec(path)?.[1] || /\/embed\/(\d+)/i.exec(path)?.[1];
      return id ? `https://xhamster.com/embed/${id}` : "";
    }
    if (host.includes("redtube")) {
      const id = /\/(\d+)/.exec(path)?.[1] || parsed.searchParams.get("id");
      return id ? `https://embed.redtube.com/?id=${id}` : "";
    }
    if (host.includes("spankbang")) {
      const id = /^\/([a-z0-9]+)\//i.exec(path)?.[1];
      return id ? `https://spankbang.com/${id}/embed/` : "";
    }
    if (host.includes("youporn")) {
      const id = /\/watch\/(\d+)/i.exec(path)?.[1];
      return id ? `https://www.youporn.com/embed/${id}` : "";
    }
    if (host.includes("ashemaletube")) {
      const id =
        /\/(?:videos|video|embed)\/(\d+)/i.exec(path)?.[1] || parsed.searchParams.get("id");
      return id ? `https://www.ashemaletube.com/embed/${id}` : "";
    }
    if (host.includes("transangels") || host.includes("adulttime")) {
      const id =
        /\/(?:en\/)?(?:video|videos|embed|scene)\/(?:[^/]+\/)*(\d+)/i.exec(path)?.[1] ||
        parsed.searchParams.get("id");
      if (!id) return "";
      const site = host.includes("transangels") ? "www.transangels.com" : "www.adulttime.com";
      return `https://${site}/en/embed/${id}`;
    }
    if (host === "thegay.com" || host.endsWith(".thegay.com")) {
      const key =
        parsed.searchParams.get("viewkey") ||
        parsed.searchParams.get("id") ||
        /\/(?:videos?|embed)\/(\d+)/i.exec(path)?.[1];
      return key ? `https://www.thegay.com/embed/${key}` : "";
    }
    return "";
  } catch {
    return "";
  }
}

export function adultPageHost(raw: string) {
  return pageHost(raw);
}

/** Official AShemaleTube embeds send X-Frame-Options: SAMEORIGIN — iframe is always blank. */
export function adultEmbedCanFrame(raw: string) {
  const host = pageHost(raw);
  if (!host) return false;
  if (host === "ashemaletube.com" || host.endsWith(".ashemaletube.com")) return false;
  return Boolean(adultEmbedUrl(raw) || /\/embed\//i.test(raw));
}

export function normalizeAdultWatchInput(raw: string) {
  const trimmed = raw.trim();
  const iframeSrc = /<iframe\b[^>]*\bsrc=["']([^"']+)/i.exec(trimmed)?.[1];
  if (iframeSrc) return iframeSrc.trim();
  if (/^function\/\d+\//i.test(trimmed)) {
    return kvsRealUrl(trimmed) || trimmed;
  }
  return trimmed;
}

export function isCloudflareChallenge(html: string) {
  return /cf-mitigated|challenge-platform|cdn-cgi\/challenge|Just a moment/i.test(html);
}

export function ashemaletubeVideoPageUrl(raw: string) {
  try {
    const parsed = new URL(raw.trim());
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (!host.includes("ashemaletube")) return "";
    const id = /\/(?:videos|video|embed)\/(\d+)/i.exec(parsed.pathname)?.[1] || parsed.searchParams.get("id");
    return id ? `https://www.ashemaletube.com/videos/${id}/` : "";
  } catch {
    return "";
  }
}

export function kvsRealUrl(videoUrl: string, licenseCode = "", baseUrl = "") {
  let href = videoUrl.trim().replace(/^function\/\d+\//, "");
  if (href.startsWith("//")) href = `https:${href}`;
  if (href.startsWith("/") && baseUrl) {
    try {
      href = new URL(href, baseUrl).href;
    } catch {
      return "";
    }
  }
  if (!href.startsWith("http://") && !href.startsWith("https://")) return "";
  return unescapeJsonUrl(href);
}

function decodeEntities(value: string) {
  return value
    .replace(/\\u0026/g, "&")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/\\+"/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#47;/g, "/");
}

function unescapeJsonUrl(value: string) {
  try {
    return decodeEntities(JSON.parse(`"${value.replace(/^"+|"+$/g, "")}"`));
  } catch {
    return decodeEntities(value);
  }
}

function isMediaHref(href: string) {
  if (isDirectWatchMediaUrl(href)) return true;
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return /\/(?:hls|mp4)\b/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function qualityScore(href: string) {
  const match = /\b(2160|1440|1080|720|480|360|240)p?\b/i.exec(href);
  return match ? Number(match[1]) : href.toLowerCase().includes(".m3u8") ? 500 : 400;
}

function pickMedia(urls: string[]): { href: string; kind: WatchResolveKind } | null {
  const unique = [...new Set(urls.map((url) => unescapeJsonUrl(url)).filter(isMediaHref))];
  if (!unique.length) return null;
  const hls = unique.filter((url) => url.toLowerCase().includes(".m3u8"));
  const pool = hls.length ? hls : unique;
  pool.sort((a, b) => qualityScore(b) - qualityScore(a));
  const chosen = pool[0];
  return { href: chosen, kind: chosen.toLowerCase().includes(".m3u8") ? "hls" : "mp4" };
}

function collectQuotedUrls(html: string, pattern: RegExp) {
  const found: string[] = [];
  const copy = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = copy.exec(html))) {
    const raw = match[1] || match[2];
    if (raw) found.push(raw);
  }
  return found;
}

function readTitle(html: string) {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html);
  if (og?.[1]) return decodeEntities(og[1]).trim();
  const title = /<title[^>]*>([^<]+)/i.exec(html);
  return decodeEntities(title?.[1] ?? "").replace(/\s+[|-]\s+.*$/, "").trim();
}

function extractKvsUrls(html: string, pageUrl: string) {
  const license = /['"]license_code['"]\s*:\s*['"]([^'"]+)['"]/i.exec(html)?.[1] ?? "";
  const found: string[] = [];
  const keys = /['"](video_url|video_alt_url\d*)['"]\s*:\s*['"]([^'"]+)['"]/gi;
  let match: RegExpExecArray | null;
  while ((match = keys.exec(html))) {
    const real = kvsRealUrl(match[2], license, pageUrl);
    if (real) found.push(real);
  }
  found.push(
    ...collectQuotedUrls(html, /function\/\d+\/(https?:\\?\/\\?\/[^'"]+)/gi).map((url) =>
      kvsRealUrl(`function/0/${url}`, license, pageUrl),
    ),
  );
  return found;
}

export function extractAdultMediaFromHtml(html: string, pageUrl: string) {
  const urls: string[] = [];
  urls.push(
    ...extractKvsUrls(html, pageUrl),
    ...collectQuotedUrls(html, /html5player\.setVideo(?:UrlHigh|UrlLow|HLS)\(['"]([^'"]+)/gi),
    ...collectQuotedUrls(html, /"videoUrl"\s*:\s*"([^"]+)"/gi),
    ...collectQuotedUrls(html, /"contentUrl"\s*:\s*"([^"]+)"/gi),
    ...collectQuotedUrls(html, /property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)/gi),
    ...collectQuotedUrls(html, /content=["']([^"']+)["'][^>]+property=["']og:video(?::url)?["']/gi),
    ...collectQuotedUrls(html, /setVideoHLS\(['"]([^'"]+)/gi),
    ...collectQuotedUrls(html, /setVideoHLS["'\s:=]+["']([^"']+)/gi),
    ...collectQuotedUrls(html, /['"]hls['"]\s*:\s*['"](https?:[^'"]+\.m3u8[^'"]*)/gi),
    ...collectQuotedUrls(html, /"(?:720p|480p|240p|1080p)"\s*:\s*\["([^"]+)"/gi),
  );
  const defs = /mediaDefinitions"\s*:\s*(\[[\s\S]*?\])/.exec(html) || /"mediaDefinitions"\s*:\s*(\[[\s\S]*?\])/.exec(html);
  if (defs?.[1]) {
    const hrefs = defs[1].match(/https?:\\?\/\\?\/[^"'\s]+/g) || [];
    for (const href of hrefs) urls.push(href);
  }
  return { title: readTitle(html), media: pickMedia(urls), embedUrl: adultEmbedUrl(pageUrl) };
}

export function watchMediaReferer(mediaUrl: string, pageUrl = "") {
  try {
    if (pageUrl.trim()) {
      const page = new URL(pageUrl);
      if ((page.protocol === "http:" || page.protocol === "https:") && page.href !== mediaUrl) {
        return page.href;
      }
    }
  } catch {
    // Use the media host below.
  }
  try {
    const host = new URL(mediaUrl).hostname.replace(/^www\./, "").toLowerCase();
    const cdn = ADULT_CDN_REFERER.find(([suffix]) => hostMatchesSuffix(host, suffix));
    if (cdn) return cdn[1];
    if (isXnxxHost(host)) return "https://www.xnxx.com/";
    const known = KNOWN_ADULT_HOSTS.find((name) => hostMatchesSuffix(host, name));
    if (known) return `https://www.${known}/`;
  } catch {
    return "";
  }
  return "";
}

export function shouldProxyWatchMedia(mediaUrl: string) {
  if (isWatchHlsUrl(mediaUrl)) return true;
  if (DIRECT_MEDIA_PATH.test(mediaUrl)) return true;
  try {
    const host = new URL(mediaUrl).hostname;
    return isXnxxHost(host) || isAdultPageHost(host);
  } catch {
    return false;
  }
}

export function proxiedWatchMedia(mediaUrl: string, pageUrl = "") {
  try {
    const media = new URL(mediaUrl);
    if (media.protocol !== "http:" && media.protocol !== "https:") return "";
    const base = `/api/video/proxy?url=${encodeURIComponent(media.href)}`;
    const referer = watchMediaReferer(media.href, pageUrl);
    return referer ? `${base}&referer=${encodeURIComponent(referer)}` : base;
  } catch {
    return "";
  }
}
