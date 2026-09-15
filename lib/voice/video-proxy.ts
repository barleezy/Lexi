const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "metadata.goog",
]);

function isPrivateIPv4(host: string) {
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!match) return false;
  const [a, b] = [Number(match[1]), Number(match[2])];
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

export function isBlockedVideoHost(hostname: string) {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, "");
  if (!host) return true;
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.endsWith(".internal") || host.endsWith(".lan")) return true;
  if (isPrivateIPv4(host)) return true;
  return false;
}

export function parseVideoSourceUrl(raw: string | null | undefined):
  | { ok: true; href: string }
  | { ok: false; error: string } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "Missing video URL." };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid video URL." };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https video URLs are allowed." };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "Video URLs with credentials are not allowed." };
  }
  if (isBlockedVideoHost(parsed.hostname)) {
    return { ok: false, error: "That video host is not allowed." };
  }
  return { ok: true, href: parsed.href };
}

export function isRedirectStatus(status: number) {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function looksLikeVideoContentType(value: string | null | undefined) {
  const type = (value ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (!type) return true;
  if (type.startsWith("video/")) return true;
  if (type === "application/octet-stream") return true;
  if (type === "application/mp4") return true;
  if (type === "application/vnd.ms-asf" || type === "application/x-ms-asf") return true;
  if (type === "application/x-matroska") return true;
  if (type === "application/x-flv") return true;
  if (type === "application/mpeg" || type === "application/mp2t") return true;
  return false;
}
