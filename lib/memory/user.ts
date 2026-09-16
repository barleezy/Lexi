/** Ian's existing Neon account. Case variants normalize here so his memories stay keyed. */
export const IAN_USER_ID = "Ian";

/** Admin allowlist. Ian is admin, not the only user. */
export const ADMIN_USER_IDS = [IAN_USER_ID] as const;

/** @deprecated Ian's account id — do not default unsigned traffic to this. */
export const DEFAULT_USER_ID = IAN_USER_ID;

export const LEXI_USER_COOKIE = "lexi_user_id";
export const LEXI_USER_COOKIE_MAX_AGE = 60 * 60 * 24 * 180;

/** Ian's account id for legacy NULL-row backfill and his pinned facts only. */
export function defaultUserId() {
  return IAN_USER_ID;
}

/** Logins that are the admin (Ian). Username Barleezy maps to the same account. */
const ADMIN_LOGIN_ALIASES = new Set(["ian", "barleezy"]);

/** Canonicalize a known account id. Blank is not Ian. `ian` / `Barleezy` stay `Ian`. */
export function normalizeUserId(raw?: string | null) {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  if (ADMIN_LOGIN_ALIASES.has(trimmed.toLowerCase())) return IAN_USER_ID;
  return trimmed;
}

export function isIanUserId(raw?: string | null) {
  return normalizeUserId(raw) === IAN_USER_ID;
}

export function isAdminUserId(raw?: string | null) {
  const userId = normalizeUserId(raw);
  if (!userId) return false;
  return ADMIN_USER_IDS.some((admin) => admin.toLowerCase() === userId.toLowerCase());
}

export function readUserId(request: Request, queryUserId?: string | null) {
  const fromQuery = queryUserId?.trim();
  if (fromQuery) return normalizeUserId(fromQuery) || null;
  const fromHeader = request.headers.get("x-lexi-user-id")?.trim();
  if (fromHeader) return normalizeUserId(fromHeader) || null;
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${LEXI_USER_COOKIE}=([^;]+)`));
  const fromCookie = match?.[1]?.trim();
  if (fromCookie) return normalizeUserId(decodeURIComponent(fromCookie)) || null;
  return null;
}

/** Signed-in account only. Never invents Ian. */
export function resolveUserId(request: Request, queryUserId?: string | null) {
  return readUserId(request, queryUserId) ?? "";
}

export function isGuestUserId(raw?: string | null) {
  return normalizeUserId(raw).toLowerCase().startsWith("guest_");
}

export function newGuestUserId() {
  const hex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `guest_${hex}`;
}

/** Voice can run without a password account. Guests get a stable cookie id. */
export function ensureRequestUserId(request: Request, queryUserId?: string | null) {
  return resolveUserId(request, queryUserId) || newGuestUserId();
}

export function requireSignedInUserId(request: Request, queryUserId?: string | null) {
  const userId = resolveUserId(request, queryUserId);
  if (!userId || isGuestUserId(userId)) return null;
  return userId;
}

export function requireAdminUserId(request: Request, queryUserId?: string | null) {
  const userId = requireSignedInUserId(request, queryUserId);
  if (!userId || !isAdminUserId(userId)) return null;
  return userId;
}

export function readBrowserUserId() {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${LEXI_USER_COOKIE}=([^;]+)`));
  return match?.[1] ? normalizeUserId(decodeURIComponent(match[1])) : "";
}

export function writeBrowserUserId(raw: string) {
  const userId = normalizeUserId(raw);
  if (typeof document === "undefined") return userId;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; secure" : "";
  if (!userId) {
    document.cookie = `${LEXI_USER_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
    return "";
  }
  document.cookie = `${LEXI_USER_COOKIE}=${encodeURIComponent(userId)}; path=/; max-age=${LEXI_USER_COOKIE_MAX_AGE}; samesite=lax${secure}`;
  return userId;
}

export function ensureBrowserUserId() {
  const existing = readBrowserUserId();
  if (existing) return existing;
  return writeBrowserUserId(newGuestUserId());
}
