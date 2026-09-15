export const VOICE_STORAGE_KEYS = {
  sessionId: "lexi.sessionId",
  started: "lexi.started",
  userId: "lexi.userId",
  caption: "lexi.caption",
  transcripts: "lexi.transcripts",
} as const;

export type StoredTranscriptRow = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type VoiceSessionStore = {
  sessionId: string | null;
  started: boolean;
  userId: string;
  caption: string;
  rows: StoredTranscriptRow[];
};

function store() {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function parseTranscripts(raw: string | null | undefined): StoredTranscriptRow[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rows: StoredTranscriptRow[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.id !== "string" || !row.id) continue;
      if (row.role !== "user" && row.role !== "assistant") continue;
      if (typeof row.text !== "string") continue;
      rows.push({ id: row.id, role: row.role, text: row.text });
    }
    return rows;
  } catch {
    return [];
  }
}

export function readVoiceSessionStore(): VoiceSessionStore {
  const memory = store();
  if (!memory) {
    return {
      sessionId: null,
      started: false,
      userId: "Ian",
      caption: "",
      rows: [],
    };
  }
  const sessionId = memory.getItem(VOICE_STORAGE_KEYS.sessionId)?.trim() || null;
  return {
    sessionId,
    started: memory.getItem(VOICE_STORAGE_KEYS.started) === "1",
    userId: memory.getItem(VOICE_STORAGE_KEYS.userId)?.trim() || "Ian",
    caption: memory.getItem(VOICE_STORAGE_KEYS.caption) ?? "",
    rows: parseTranscripts(memory.getItem(VOICE_STORAGE_KEYS.transcripts)),
  };
}

export function writeVoiceSessionStore(update: {
  sessionId?: string | null;
  started?: boolean;
  userId?: string;
  caption?: string;
  rows?: StoredTranscriptRow[];
}) {
  const memory = store();
  if (!memory) return;
  if (update.sessionId !== undefined) {
    if (update.sessionId) memory.setItem(VOICE_STORAGE_KEYS.sessionId, update.sessionId);
    else memory.removeItem(VOICE_STORAGE_KEYS.sessionId);
  }
  if (update.started !== undefined) {
    memory.setItem(VOICE_STORAGE_KEYS.started, update.started ? "1" : "0");
  }
  if (update.userId !== undefined) {
    memory.setItem(VOICE_STORAGE_KEYS.userId, update.userId.trim() || "Ian");
  }
  if (update.caption !== undefined) {
    memory.setItem(VOICE_STORAGE_KEYS.caption, update.caption);
  }
  if (update.rows !== undefined) {
    memory.setItem(VOICE_STORAGE_KEYS.transcripts, JSON.stringify(update.rows));
  }
}

export function clearVoiceSessionStore() {
  const memory = store();
  if (!memory) return;
  for (const key of Object.values(VOICE_STORAGE_KEYS)) memory.removeItem(key);
}
