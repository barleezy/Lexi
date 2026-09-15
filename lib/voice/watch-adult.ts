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
  /\/(?:view_video(?:\.php)?|video\/|videos\/|embedframe\/|embed\/|xembed\.php)/i;

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

export function isAdultPageHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/^www\./, "").replace(/\.+$/, "");
  if (!host) return false;
  return hostMatchesList(host) || ADULT_HOST_HINT.test(host);
}

export function isAdultPageUrl(raw: string) {
  try {
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
      const id = /\/video-([a-z0-9]+)/i.exec(path)?.[1];
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
      const id = /\/(?:videos|embed)\/(\d+)/i.exec(path)?.[1];
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

export type WatchResolveKind = "mp4" | "hls";

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
  if (!href.startsWith("http://") && !href.startsWith("https://")) return false;
  try {
    const host = new URL(href).hostname;
    if (host === "localhost" || host === "127.0.0.1") return false;
  } catch {
    return false;
  }
  const lower = href.toLowerCase();
  if (lower.includes(".m3u8") || lower.includes(".mp4")) return true;
  return /\/(?:get_media|video_redirect|hls|mp4)\b/i.test(lower);
}

function qualityScore(href: string) {
  const match = /\b(2160|1440|1080|720|480|360|240)p?\b/i.exec(href);
  return match ? Number(match[1]) : href.toLowerCase().includes(".m3u8") ? 500 : 400;
}

function pickMedia(urls: string[]): { href: string; kind: WatchResolveKind } | null {
  const unique = [...new Set(urls.map((url) => unescapeJsonUrl(url)).filter(isMediaHref))];
  if (!unique.length) return null;
  unique.sort((a, b) => qualityScore(b) - qualityScore(a));
  const mp4 = unique.find((url) => !url.toLowerCase().includes(".m3u8"));
  const chosen = mp4 ?? unique[0];
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

export function extractAdultMediaFromHtml(html: string, pageUrl: string) {
  const urls: string[] = [];
  urls.push(
    ...collectQuotedUrls(html, /html5player\.setVideo(?:UrlHigh|UrlLow|HLS)\(['"]([^'"]+)/gi),
    ...collectQuotedUrls(html, /"videoUrl"\s*:\s*"([^"]+)"/gi),
    ...collectQuotedUrls(html, /"contentUrl"\s*:\s*"([^"]+)"/gi),
    ...collectQuotedUrls(html, /property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)/gi),
    ...collectQuotedUrls(html, /content=["']([^"']+)["'][^>]+property=["']og:video(?::url)?["']/gi),
    ...collectQuotedUrls(html, /setVideoHLS\(['"]([^'"]+)/gi),
    ...collectQuotedUrls(html, /"(?:720p|480p|240p|1080p)"\s*:\s*\["([^"]+)"/gi),
  );
  const defs = /mediaDefinitions"\s*:\s*(\[[\s\S]*?\])/.exec(html) || /"mediaDefinitions"\s*:\s*(\[[\s\S]*?\])/.exec(html);
  if (defs?.[1]) {
    const hrefs = defs[1].match(/https?:\\?\/\\?\/[^"'\s]+/g) || [];
    for (const href of hrefs) urls.push(href);
  }
  return { title: readTitle(html), media: pickMedia(urls), embedUrl: adultEmbedUrl(pageUrl) };
}

export function proxiedWatchMedia(mediaUrl: string, pageUrl: string) {
  try {
    const media = new URL(mediaUrl);
    if (media.protocol !== "http:" && media.protocol !== "https:") return "";
    const base = `/api/video/proxy?url=${encodeURIComponent(media.href)}`;
    try {
      const page = new URL(pageUrl);
      if (page.protocol === "http:" || page.protocol === "https:") {
        return `${base}&referer=${encodeURIComponent(page.href)}`;
      }
    } catch {
      return base;
    }
    return base;
  } catch {
    return "";
  }
}
