export const VOICE_STORAGE_KEYS = {
  sessionId: "lexi.sessionId",
  /** Hangup must delete this (web localStorage). Next Call sends null. */
  previousSessionId: "lexi.previousSessionId",
  started: "lexi.started",
  userId: "lexi.userId",
  caption: "lexi.caption",
  transcripts: "lexi.transcripts",
  voiceSessionId: "lexi.voiceSessionId",
} as const;

export type StoredTranscriptRow = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export type VoiceSessionStore = {
  sessionId: string | null;
  previousSessionId: string | null;
  voiceSessionId: string | null;
  started: boolean;
  userId: string;
  caption: string;
  rows: StoredTranscriptRow[];
};

function sessionStore() {
  try {
    if (typeof sessionStorage === "undefined") return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

/** previousSessionId lives in localStorage per product rule. */
function localStore() {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
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

export function readPreviousSessionId() {
  const local = localStore();
  const fromLocal = local?.getItem(VOICE_STORAGE_KEYS.previousSessionId)?.trim() || null;
  if (fromLocal) return fromLocal;
  // Migrate leftover sessionStorage key if present.
  const session = sessionStore();
  const legacy = session?.getItem(VOICE_STORAGE_KEYS.previousSessionId)?.trim() || null;
  if (legacy) {
    session?.removeItem(VOICE_STORAGE_KEYS.previousSessionId);
    local?.setItem(VOICE_STORAGE_KEYS.previousSessionId, legacy);
  }
  return legacy;
}

export function writePreviousSessionId(value: string | null) {
  const local = localStore();
  const session = sessionStore();
  session?.removeItem(VOICE_STORAGE_KEYS.previousSessionId);
  if (!local) return;
  if (value) local.setItem(VOICE_STORAGE_KEYS.previousSessionId, value);
  else local.removeItem(VOICE_STORAGE_KEYS.previousSessionId);
}

export function readVoiceSessionStore(): VoiceSessionStore {
  const memory = sessionStore();
  if (!memory) {
    return {
      sessionId: null,
      previousSessionId: readPreviousSessionId(),
      voiceSessionId: null,
      started: false,
      userId: "",
      caption: "",
      rows: [],
    };
  }
  const sessionId = memory.getItem(VOICE_STORAGE_KEYS.sessionId)?.trim() || null;
  return {
    sessionId,
    previousSessionId: readPreviousSessionId(),
    voiceSessionId: memory.getItem(VOICE_STORAGE_KEYS.voiceSessionId)?.trim() || null,
    started: memory.getItem(VOICE_STORAGE_KEYS.started) === "1",
    userId: memory.getItem(VOICE_STORAGE_KEYS.userId)?.trim() || "",
    caption: memory.getItem(VOICE_STORAGE_KEYS.caption) ?? "",
    rows: parseTranscripts(memory.getItem(VOICE_STORAGE_KEYS.transcripts)),
  };
}

export function writeVoiceSessionStore(update: {
  sessionId?: string | null;
  previousSessionId?: string | null;
  voiceSessionId?: string | null;
  started?: boolean;
  userId?: string;
  caption?: string;
  rows?: StoredTranscriptRow[];
}) {
  const memory = sessionStore();
  if (update.previousSessionId !== undefined) {
    writePreviousSessionId(update.previousSessionId);
  }
  if (!memory) return;
  if (update.sessionId !== undefined) {
    if (update.sessionId) memory.setItem(VOICE_STORAGE_KEYS.sessionId, update.sessionId);
    else memory.removeItem(VOICE_STORAGE_KEYS.sessionId);
  }
  if (update.voiceSessionId !== undefined) {
    if (update.voiceSessionId) memory.setItem(VOICE_STORAGE_KEYS.voiceSessionId, update.voiceSessionId);
    else memory.removeItem(VOICE_STORAGE_KEYS.voiceSessionId);
  }
  if (update.started !== undefined) {
    memory.setItem(VOICE_STORAGE_KEYS.started, update.started ? "1" : "0");
  }
  if (update.userId !== undefined) {
    const nextUserId = update.userId.trim();
    if (nextUserId) memory.setItem(VOICE_STORAGE_KEYS.userId, nextUserId);
    else memory.removeItem(VOICE_STORAGE_KEYS.userId);
  }
  if (update.caption !== undefined) {
    memory.setItem(VOICE_STORAGE_KEYS.caption, update.caption);
  }
  if (update.rows !== undefined) {
    memory.setItem(VOICE_STORAGE_KEYS.transcripts, JSON.stringify(update.rows));
  }
}

/** Hang up: drop previousSessionId + transcript. Keep userId for recalled facts. */
export function clearCallContinuityStore() {
  writePreviousSessionId(null);
  writeVoiceSessionStore({
    sessionId: null,
    previousSessionId: null,
    voiceSessionId: null,
    started: false,
    caption: "",
    rows: [],
  });
}

export function clearVoiceSessionStore() {
  writePreviousSessionId(null);
  const memory = sessionStore();
  if (!memory) return;
  for (const key of Object.values(VOICE_STORAGE_KEYS)) {
    if (key === VOICE_STORAGE_KEYS.previousSessionId) continue;
    memory.removeItem(key);
  }
}
