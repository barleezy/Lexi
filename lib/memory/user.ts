export const DEFAULT_USER_ID = "Ian";
const COOKIE = "lexi_user_id";

export function defaultUserId() {
  return DEFAULT_USER_ID;
}

/** One default until real auth. `ian` / `Ian` / `IAN` all become `Ian`. */
export function normalizeUserId(raw?: string | null) {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return DEFAULT_USER_ID;
  if (trimmed.toLowerCase() === DEFAULT_USER_ID.toLowerCase()) return DEFAULT_USER_ID;
  return trimmed;
}

export function readUserId(request: Request, queryUserId?: string | null) {
  const fromQuery = queryUserId?.trim();
  if (fromQuery) return normalizeUserId(fromQuery);
  const fromHeader = request.headers.get("x-lexi-user-id")?.trim();
  if (fromHeader) return normalizeUserId(fromHeader);
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  const fromCookie = match?.[1]?.trim();
  if (fromCookie) return normalizeUserId(decodeURIComponent(fromCookie));
  return null;
}

export function resolveUserId(request: Request, queryUserId?: string | null) {
  return readUserId(request, queryUserId) ?? DEFAULT_USER_ID;
}
