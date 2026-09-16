import { neon } from "@neondatabase/serverless";
import { CHAT_COMPLETIONS_URL, readChatError, readChatText } from "../channels/parse";
import { parseSessionId } from "./session-id";
import { listTurnsForSession } from "./store";
import type { ChatTurn } from "./turns";
import { normalizeUserId } from "./user";
import { TEXT_FAST_MAX_TOKENS, TEXT_FAST_MODEL, textFastModelFromEnv } from "../wallet/models";

/** Keep the last N call summaries per user (newest first). */
export const CALL_MEMORY_CAP = 10;

/**
 * Call-summary memories. Separate from the legacy salience `memories` table
 * (facts live in `facts`). Columns: user_id, summary, created_at.
 */
export const CALL_MEMORIES_TABLE = "call_memories";

export type CallMemoryRow = {
  id: string;
  user_id: string;
  summary: string;
  created_at: string;
};

function sql() {
  const url = process.env.DATABASE_URL?.trim() || process.env.NEON_DATABASE_URL?.trim();
  if (!url) return null;
  return neon(url);
}

let ensured = false;

export async function ensureCallMemoriesTable() {
  const db = sql();
  if (!db) return null;
  if (ensured) return db;
  await db.query(`
    CREATE TABLE IF NOT EXISTS call_memories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      summary text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS call_memories_user_created_idx
    ON call_memories (user_id, created_at DESC)`);
  ensured = true;
  return db;
}

/** Newest first. */
export async function listCallMemories(userId: string, limit = CALL_MEMORY_CAP): Promise<CallMemoryRow[]> {
  const db = await ensureCallMemoriesTable();
  if (!db) return [];
  const id = normalizeUserId(userId);
  if (!id) return [];
  const cap = Math.min(CALL_MEMORY_CAP, Math.max(1, Math.floor(limit)));
  const rows = (await db.query(
    `SELECT id, user_id, summary, created_at
     FROM call_memories
     WHERE lower(user_id) = lower($1)
     ORDER BY created_at DESC
     LIMIT $2`,
    [id, cap],
  )) as CallMemoryRow[];
  return rows;
}

export async function insertCallMemory(userId: string, summary: string) {
  const db = await ensureCallMemoriesTable();
  if (!db) return null;
  const id = normalizeUserId(userId);
  const text = summary.trim();
  if (!id || !text) return null;

  const rows = (await db.query(
    `INSERT INTO call_memories (user_id, summary)
     VALUES ($1, $2)
     RETURNING id, user_id, summary, created_at`,
    [id, text],
  )) as CallMemoryRow[];

  await db.query(
    `DELETE FROM call_memories
     WHERE lower(user_id) = lower($1)
       AND id NOT IN (
         SELECT id FROM call_memories
         WHERE lower(user_id) = lower($1)
         ORDER BY created_at DESC
         LIMIT $2
       )`,
    [id, CALL_MEMORY_CAP],
  );

  return rows[0] ?? null;
}

/** Instruction block — summaries only, never raw transcript. */
export function formatCallMemories(rows: Array<{ summary: string }>) {
  const lines = rows
    .map((row) => row.summary.trim())
    .filter(Boolean)
    .slice(0, CALL_MEMORY_CAP);
  if (!lines.length) return "";
  return `RECENT CALL MEMORIES (newest first — brief context only, do not recite verbatim unless asked)\n\n${lines
    .map((line, index) => `${index + 1}. ${line}`)
    .join("\n")}`;
}

export function mergeMemoryInstructions(factsBlock: string, callMemoriesBlock: string) {
  const facts = factsBlock.trim();
  const calls = callMemoriesBlock.trim();
  if (facts && calls) return `${facts}\n\n${calls}`;
  return facts || calls;
}

function turnsToSummarySource(turns: ChatTurn[]) {
  const lines: string[] = [];
  for (const turn of turns) {
    const user = turn.user_text.trim();
    const assistant = turn.assistant_text.trim();
    if (user) lines.push(`User: ${user.slice(0, 400)}`);
    if (assistant) lines.push(`Assistant: ${assistant.slice(0, 400)}`);
  }
  return lines.join("\n").slice(0, 12_000);
}

/** 2–4 sentence call summary via text model. No tools needed. */
export async function generateCallSummary(turns: ChatTurn[], env: NodeJS.ProcessEnv = process.env) {
  const source = turnsToSummarySource(turns);
  if (!source.trim()) return "";

  const key = env.XAI_API_KEY?.trim();
  if (!key) return "";

  const model = textFastModelFromEnv(env) || TEXT_FAST_MODEL;
  const upstream = await fetch(CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      max_tokens: Math.min(220, TEXT_FAST_MAX_TOKENS),
      messages: [
        {
          role: "system",
          content:
            "Summarize this voice call between Lexi and the user in 2 to 4 short sentences. " +
            "Capture what they talked about and any important beats. " +
            "No raw transcript, no quotes dump, no bullet list, no headings — prose only.",
        },
        { role: "user", content: source },
      ],
    }),
  });

  let data: unknown = {};
  try {
    data = await upstream.json();
  } catch {
    data = {};
  }
  if (!upstream.ok) {
    console.warn("[call-memories] summary failed:", readChatError(data) || upstream.status);
    return "";
  }
  return readChatText(data).trim();
}

/**
 * After hangup settle: summarize this memory session's turns and store.
 * Never writes the raw transcript into call_memories.
 */
export async function summarizeSettledCall(input: {
  userId: string;
  sessionId?: string | null;
}) {
  const userId = normalizeUserId(input.userId);
  const sessionId = parseSessionId(input.sessionId);
  if (!userId || !sessionId) return { ok: false as const, reason: "missing_ids" as const };

  const turns = await listTurnsForSession(userId, sessionId);
  if (turns.length === 0) return { ok: false as const, reason: "no_turns" as const };

  const summary = await generateCallSummary(turns);
  if (!summary) return { ok: false as const, reason: "empty_summary" as const };

  const row = await insertCallMemory(userId, summary);
  if (!row) return { ok: false as const, reason: "db" as const };
  return { ok: true as const, summary: row.summary, id: row.id };
}
