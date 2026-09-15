import { neon } from "@neondatabase/serverless";
import { bandFromStart, bumpAffect, daysElapsed, decaySalience, rateForBand } from "@/lib/memory/decay";
import { extractNameFromBlob, FACT_KEYS, isIdentityKey, type FactKey } from "@/lib/memory/extract";
import { parseSessionId } from "@/lib/memory/session-id";
import { PRIOR_TURN_CAP, type ChatTurn } from "@/lib/memory/turns";
import { defaultUserId, normalizeUserId } from "@/lib/memory/user";

export type FactRow = {
  id: string;
  user_id: string;
  memory_key: string;
  value: string;
  affect: number;
  t_zero: string;
  last_decay: string | null;
  created_at: string;
  updated_at: string;
};

export type DecayLine = {
  memoryKey: string;
  value: string;
  startSalience: number;
  salience: number;
  band: string;
  rate: number;
  days: number;
  t0: string;
  kind: "fact" | "legacy";
};

export type SessionRow = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
};

export type MigrateResult =
  | { ok: false; reason: "missing DATABASE_URL" }
  | {
      ok: true;
      defaultUserId: string;
      renamedUserIds: number;
      nameFactsBackfilled: number;
      legacyRows: number;
    };

export const MEMORY_INSTRUCTION_CAP = 10;

const FACT_KEY_SET = new Set<string>(FACT_KEYS);

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "";
}

export function isMemoryStoreConfigured() {
  return Boolean(databaseUrl());
}

function sql() {
  const url = databaseUrl();
  if (!url) return null;
  return neon(url);
}

let lastMigrate: Extract<MigrateResult, { ok: true }> | null = null;
let ensured: Promise<ReturnType<typeof sql>> | null = null;

export async function migrateMemories(): Promise<MigrateResult> {
  if (!isMemoryStoreConfigured()) return { ok: false, reason: "missing DATABASE_URL" };
  await ensureTable();
  return lastMigrate ?? {
    ok: true,
    defaultUserId: defaultUserId(),
    renamedUserIds: 0,
    nameFactsBackfilled: 0,
    legacyRows: 0,
  };
}

async function ensureTable() {
  if (!ensured) {
    ensured = migrateTable().catch((error) => {
      ensured = null;
      throw error;
    });
  }
  return ensured;
}

async function migrateTable() {
  const db = sql();
  if (!db) return null;
  await db.query(`
    CREATE TABLE IF NOT EXISTS memories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      memory_key text NOT NULL,
      raw_text text NOT NULL,
      weighted_text text,
      start_salience double precision NOT NULL,
      salience double precision NOT NULL,
      band text NOT NULL CHECK (band IN ('low', 'medium', 'high')),
      rate double precision NOT NULL,
      t0 timestamptz NOT NULL,
      last_decay timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, memory_key)
    )
  `);
  // Existing Neon tables predating user_id are a no-op above. Add missing
  // columns, backfill, then index. Never DROP — keep legacy columns/rows.
  await db.query(`
    DO $$
    BEGIN
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS user_id text;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS memory_key text;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS raw_text text;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS weighted_text text;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS start_salience double precision;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS salience double precision;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS band text;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS rate double precision;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS t0 timestamptz;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS last_decay timestamptz;
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'raw_event'
      ) THEN
        UPDATE memories SET raw_text = raw_event WHERE raw_text IS NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'weighted_version'
      ) THEN
        UPDATE memories SET weighted_text = weighted_version WHERE weighted_text IS NULL;
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'memories' AND column_name = 'affect'
      ) THEN
        UPDATE memories SET start_salience = affect::double precision WHERE start_salience IS NULL;
        UPDATE memories SET salience = affect::double precision WHERE salience IS NULL;
      END IF;

      UPDATE memories SET memory_key = 'legacy-' || id::text WHERE memory_key IS NULL;
      UPDATE memories SET raw_text = '' WHERE raw_text IS NULL;
      UPDATE memories SET start_salience = 3 WHERE start_salience IS NULL;
      UPDATE memories SET salience = start_salience WHERE salience IS NULL;
      UPDATE memories SET band = CASE
        WHEN start_salience <= 3 THEN 'low'
        WHEN start_salience <= 6 THEN 'medium'
        ELSE 'high'
      END
      WHERE band IS NULL OR band NOT IN ('low', 'medium', 'high');
      UPDATE memories SET rate = CASE band
        WHEN 'low' THEN 0.08
        WHEN 'medium' THEN 0.02
        ELSE 0.005
      END
      WHERE rate IS NULL;
      UPDATE memories SET t0 = COALESCE(created_at, now()) WHERE t0 IS NULL;
      UPDATE memories SET created_at = now() WHERE created_at IS NULL;
      UPDATE memories SET updated_at = COALESCE(created_at, now()) WHERE updated_at IS NULL;

      ALTER TABLE memories ALTER COLUMN memory_key SET NOT NULL;
      ALTER TABLE memories ALTER COLUMN raw_text SET NOT NULL;
      ALTER TABLE memories ALTER COLUMN start_salience SET NOT NULL;
      ALTER TABLE memories ALTER COLUMN salience SET NOT NULL;
      ALTER TABLE memories ALTER COLUMN band SET NOT NULL;
      ALTER TABLE memories ALTER COLUMN rate SET NOT NULL;
      ALTER TABLE memories ALTER COLUMN t0 SET NOT NULL;
      ALTER TABLE memories ALTER COLUMN created_at SET NOT NULL;
      ALTER TABLE memories ALTER COLUMN updated_at SET NOT NULL;
    END $$;
  `);
  await db.query(`UPDATE memories SET user_id = $1 WHERE user_id IS NULL`, [defaultUserId()]);
  await db.query(`
    DO $$
    BEGIN
      ALTER TABLE memories ALTER COLUMN user_id SET NOT NULL;
    END $$;
  `);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS memories_user_id_memory_key_uidx ON memories (user_id, memory_key)`);
  await db.query(`CREATE INDEX IF NOT EXISTS memories_user_id_idx ON memories (user_id)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS facts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      memory_key text NOT NULL,
      value text NOT NULL,
      affect double precision NOT NULL,
      t_zero timestamptz NOT NULL,
      last_decay timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, memory_key)
    )
  `);
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS facts_user_id_memory_key_uidx ON facts (user_id, memory_key)`);
  await db.query(`CREATE INDEX IF NOT EXISTS facts_user_id_idx ON facts (user_id)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS turns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      user_text text NOT NULL,
      assistant_text text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS turns_user_id_idx ON turns (user_id)`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(),
      ended_at timestamptz
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id)`);
  await db.query(`ALTER TABLE turns ADD COLUMN IF NOT EXISTS session_id uuid`);
  await db.query(`CREATE INDEX IF NOT EXISTS turns_session_id_idx ON turns (session_id)`);

  const renamedUserIds = await renameDefaultUserIds(db);
  const nameFactsBackfilled = await backfillNameFacts(db);
  const legacyCount = (await db.query(`SELECT COUNT(*)::int AS n FROM memories`)) as { n: number }[];
  lastMigrate = {
    ok: true,
    defaultUserId: defaultUserId(),
    renamedUserIds,
    nameFactsBackfilled,
    legacyRows: legacyCount[0]?.n ?? 0,
  };
  return db;
}

async function renameDefaultUserIds(db: NonNullable<ReturnType<typeof sql>>) {
  const target = defaultUserId();
  const memories = (await db.query(
    `UPDATE memories m
     SET user_id = $1
     WHERE lower(m.user_id) = lower($1)
       AND m.user_id <> $1
       AND NOT EXISTS (
         SELECT 1 FROM memories x
         WHERE x.user_id = $1
           AND x.memory_key IS NOT DISTINCT FROM m.memory_key
           AND x.id <> m.id
       )
     RETURNING m.id`,
    [target],
  )) as { id: string }[];
  const facts = (await db.query(
    `UPDATE facts f
     SET user_id = $1
     WHERE lower(f.user_id) = lower($1)
       AND f.user_id <> $1
       AND NOT EXISTS (
         SELECT 1 FROM facts x
         WHERE x.user_id = $1
           AND x.memory_key IS NOT DISTINCT FROM f.memory_key
           AND x.id <> f.id
       )
     RETURNING f.id`,
    [target],
  )) as { id: string }[];
  const turns = (await db.query(
    `UPDATE turns SET user_id = $1 WHERE lower(user_id) = lower($1) AND user_id <> $1 RETURNING id`,
    [target],
  )) as { id: string }[];
  const sessions = (await db.query(
    `UPDATE sessions SET user_id = $1 WHERE lower(user_id) = lower($1) AND user_id <> $1 RETURNING id`,
    [target],
  )) as { id: string }[];
  return memories.length + facts.length + turns.length + sessions.length;
}

async function backfillNameFacts(db: NonNullable<ReturnType<typeof sql>>) {
  const blobs = (await db.query(
    `SELECT user_id, raw_text, start_salience, t0
     FROM memories
     WHERE raw_text IS NOT NULL AND btrim(raw_text) <> ''
     ORDER BY t0 ASC`,
  )) as { user_id: string; raw_text: string; start_salience: number; t0: string }[];

  const found = new Map<string, { value: string; t0: string }>();
  for (const row of blobs) {
    const userId = normalizeUserId(row.user_id);
    const name = extractNameFromBlob(row.raw_text);
    if (!name) continue;
    found.set(userId, { value: name, t0: row.t0 });
  }

  let inserted = 0;
  for (const [userId, fact] of found) {
    const rows = (await db.query(
      `INSERT INTO facts (user_id, memory_key, value, affect, t_zero)
       VALUES ($1, 'name', $2, $3, $4)
       ON CONFLICT (user_id, memory_key) DO NOTHING
       RETURNING id`,
      [userId, fact.value, 10, fact.t0],
    )) as { id: string }[];
    inserted += rows.length;
  }
  return inserted;
}

export async function createOrResumeSession(userId: string, sessionId?: string | null) {
  const db = await ensureTable();
  if (!db) return null;
  const id = normalizeUserId(userId);
  const existing = parseSessionId(sessionId);
  if (existing) {
    const rows = (await db.query(
      `SELECT id, user_id, started_at, ended_at FROM sessions WHERE id = $1 AND user_id = $2`,
      [existing, id],
    )) as SessionRow[];
    if (rows[0] && !rows[0].ended_at) return rows[0];
  }
  const created = (await db.query(
    `INSERT INTO sessions (user_id) VALUES ($1) RETURNING id, user_id, started_at, ended_at`,
    [id],
  )) as SessionRow[];
  return created[0] ?? null;
}

export async function endSession(userId: string, sessionId: string) {
  const db = await ensureTable();
  if (!db) return null;
  const existing = parseSessionId(sessionId);
  if (!existing) return null;
  const rows = (await db.query(
    `UPDATE sessions
     SET ended_at = now()
     WHERE id = $1 AND user_id = $2 AND ended_at IS NULL
     RETURNING id, user_id, started_at, ended_at`,
    [existing, normalizeUserId(userId)],
  )) as SessionRow[];
  return rows[0] ?? null;
}

export async function insertTurn(input: {
  userId: string;
  userText: string;
  assistantText: string;
  sessionId?: string | null;
}) {
  const db = await ensureTable();
  if (!db) return null;
  const userId = normalizeUserId(input.userId);
  let sessionId = parseSessionId(input.sessionId);
  if (sessionId) {
    const existing = (await db.query(
      `SELECT id FROM sessions WHERE id = $1 AND user_id = $2`,
      [sessionId, userId],
    )) as { id: string }[];
    if (!existing[0]) {
      const created = await createOrResumeSession(userId, null);
      sessionId = created?.id ?? null;
    }
  } else {
    const created = await createOrResumeSession(userId, null);
    sessionId = created?.id ?? null;
  }
  const rows = (await db.query(
    `INSERT INTO turns (user_id, user_text, assistant_text, session_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, session_id, created_at`,
    [userId, input.userText, input.assistantText, sessionId],
  )) as { id: string; user_id: string; session_id: string | null; created_at: string }[];
  return rows[0] ?? null;
}

export async function upsertFact(input: {
  userId: string;
  memoryKey: FactKey;
  value: string;
  affect: number;
  tZero?: Date;
}): Promise<FactRow | null> {
  const db = await ensureTable();
  if (!db) return null;
  const userId = normalizeUserId(input.userId);
  const incoming = Math.min(10, Math.max(1, input.affect));
  const existing = (await db.query(
    `SELECT affect FROM facts WHERE user_id = $1 AND memory_key = $2`,
    [userId, input.memoryKey],
  )) as { affect: number }[];
  const affect = isIdentityKey(input.memoryKey)
    ? 10
    : existing[0]
      ? bumpAffect(existing[0].affect, incoming)
      : incoming;
  const tZero = existing[0] ? null : (input.tZero ?? new Date());
  const rows = (await db.query(
    `INSERT INTO facts (user_id, memory_key, value, affect, t_zero, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (user_id, memory_key) DO UPDATE SET
       value = excluded.value,
       affect = $4,
       updated_at = now()
     RETURNING *`,
    [userId, input.memoryKey, input.value, affect, (tZero ?? new Date()).toISOString()],
  )) as FactRow[];
  return rows[0] ?? null;
}

export async function recordExchange(input: {
  userId: string;
  userText: string;
  assistantText: string;
  facts: { memoryKey: FactKey; value: string }[];
  affect: number;
  sessionId?: string | null;
}) {
  const turn = await insertTurn({
    userId: input.userId,
    userText: input.userText,
    assistantText: input.assistantText,
    sessionId: input.sessionId,
  });
  const rows: FactRow[] = [];
  for (const fact of input.facts) {
    const row = await upsertFact({
      userId: input.userId,
      memoryKey: fact.memoryKey,
      value: fact.value,
      affect: input.affect,
    });
    if (row) rows.push(row);
  }
  return { turn, facts: rows };
}

export async function listRecentTurns(userId: string, limit = PRIOR_TURN_CAP): Promise<ChatTurn[]> {
  const db = await ensureTable();
  if (!db) return [];
  const cap = Math.min(20, Math.max(1, Math.floor(limit)));
  const rows = (await db.query(
    `SELECT id, user_text, assistant_text
     FROM turns
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [normalizeUserId(userId), cap],
  )) as { id: string; user_text: string; assistant_text: string }[];
  return [...rows].reverse();
}

export async function recallForUser(userId: string, at = new Date()): Promise<DecayLine[]> {
  const db = await ensureTable();
  if (!db) return [];
  const id = normalizeUserId(userId);
  const rows = (await db.query(
    `SELECT * FROM facts WHERE user_id = $1 ORDER BY t_zero ASC`,
    [id],
  )) as FactRow[];
  const lines: DecayLine[] = [];
  for (const row of rows) {
    if (!FACT_KEY_SET.has(row.memory_key) || !row.value.trim()) continue;
    const clock = new Date(row.t_zero);
    const band = bandFromStart(row.affect);
    const rate = rateForBand(band);
    const days = daysElapsed(at, clock);
    const salience = decaySalience(row.affect, rate, days);
    await db.query(`UPDATE facts SET last_decay = $1, updated_at = $1 WHERE id = $2`, [
      at.toISOString(),
      row.id,
    ]);
    lines.push({
      memoryKey: row.memory_key,
      value: row.value,
      startSalience: row.affect,
      salience,
      band,
      rate,
      days,
      t0: row.t_zero,
      kind: "fact",
    });
  }
  return lines;
}

export function rankMemoriesForInstructions(lines: DecayLine[]) {
  return [...lines].sort((a, b) => {
    if (b.salience !== a.salience) return b.salience - a.salience;
    const t0 = Date.parse(b.t0) - Date.parse(a.t0);
    if (t0 !== 0) return t0;
    return a.memoryKey.localeCompare(b.memoryKey);
  });
}

export function formatFactLine(line: DecayLine) {
  const current = Math.round(line.salience);
  const from = Math.round(line.startSalience);
  if (line.kind === "legacy") {
    return `legacy: ${line.value} (affect ${current}/10, decayed from ${from})`;
  }
  return `${line.memoryKey}: ${line.value} (affect ${current}/10, decayed from ${from})`;
}

export function formatMemoryInstructions(lines: DecayLine[]) {
  const selected = rankMemoriesForInstructions(lines)
    .filter((line) => line.value.trim() && line.kind === "fact")
    .slice(0, MEMORY_INSTRUCTION_CAP)
    .map(formatFactLine);
  if (selected.length === 0) return "";
  return `RECALLED FACTS\n\n${selected.join("\n")}`;
}

export function formatDecayState(lines: DecayLine[]) {
  if (lines.length === 0) return "no active decay tags";
  return lines
    .map(
      (line) =>
        `${line.memoryKey}=${line.value} affect=${round(line.salience)}/10 from=${round(line.startSalience)} band=${line.band} days=${round(line.days)}`,
    )
    .join(" | ");
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
