import { formatSessionIdLine, parseSessionId } from "@/lib/memory/session-id";

const REQUEST_TYPES = new Set(["session.update", "conversation.item.create", "response.create"]);

function hasSessionLine(text: string, sessionId: string) {
  return text.includes(`SESSION ID: ${sessionId}`);
}

function prefixSessionLine(text: string, sessionId: string) {
  const line = formatSessionIdLine(sessionId);
  if (!line || hasSessionLine(text, sessionId)) return text;
  return text ? `${line}\n${text}` : line;
}

export function stampRealtimeRequest(
  event: Record<string, unknown>,
  sessionId?: string | null,
) {
  const id = parseSessionId(sessionId);
  const type = typeof event.type === "string" ? event.type : "";
  if (!id || !REQUEST_TYPES.has(type)) return event;

  if (type === "session.update") {
    const session = { ...((event.session as Record<string, unknown> | undefined) ?? {}) };
    const instructions = typeof session.instructions === "string" ? session.instructions : "";
    const line = formatSessionIdLine(id);
    if (line && !hasSessionLine(instructions, id)) {
      session.instructions = instructions ? `${instructions}\n\n${line}` : line;
    }
    return { ...event, session };
  }

  if (type === "conversation.item.create") {
    const item = { ...((event.item as Record<string, unknown> | undefined) ?? {}) };
    const content = Array.isArray(item.content) ? item.content : [];
    item.content = content.map((part) => {
      if (!part || typeof part !== "object") return part;
      const block = part as Record<string, unknown>;
      if (typeof block.text !== "string") return block;
      return { ...block, text: prefixSessionLine(block.text, id) };
    });
    return { ...event, item };
  }

  const response = { ...((event.response as Record<string, unknown> | undefined) ?? {}) };
  const instructions = typeof response.instructions === "string" ? response.instructions : "";
  const line = formatSessionIdLine(id);
  if (line && !hasSessionLine(instructions, id)) {
    response.instructions = instructions ? `${instructions}\n${line}` : line;
  }
  const metadata = { ...((response.metadata as Record<string, unknown> | undefined) ?? {}) };
  metadata.session_id = id;
  response.metadata = metadata;
  return { ...event, response };
}
