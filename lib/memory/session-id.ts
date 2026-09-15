const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSessionId(raw?: string | null) {
  const trimmed = raw?.trim() ?? "";
  return SESSION_ID_RE.test(trimmed) ? trimmed : null;
}

export function formatSessionIdLine(raw?: string | null) {
  const id = parseSessionId(raw);
  return id ? `SESSION ID: ${id}` : "";
}

export function newMemorySessionId() {
  return crypto.randomUUID();
}
