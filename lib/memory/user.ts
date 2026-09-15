const DEFAULT_USER_ID = "ian";
const COOKIE = "lexi_user_id";

export function defaultUserId() {
  return DEFAULT_USER_ID;
}

export function readUserId(request: Request, queryUserId?: string | null) {
  const fromQuery = queryUserId?.trim();
  if (fromQuery) return fromQuery;
  const fromHeader = request.headers.get("x-lexi-user-id")?.trim();
  if (fromHeader) return fromHeader;
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  const fromCookie = match?.[1]?.trim();
  if (fromCookie) return decodeURIComponent(fromCookie);
  return null;
}

export function resolveUserId(request: Request, queryUserId?: string | null) {
  return readUserId(request, queryUserId) ?? DEFAULT_USER_ID;
}
