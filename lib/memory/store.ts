import { neon } from "@neondatabase/serverless";
import { bandFromStart, daysElapsed, decaySalience, rateForBand } from "@/lib/memory/decay";
import { defaultUserId } from "@/lib/memory/user";

export type MemoryRow = {
  id: string;
  user_id: string;
  memory_key: string;
  raw_text: string;
  weighted_text: string | null;
  start_salience: number;
  salience: number;
  band: string;
  rate: number;
  t0: string;
  last_decay: string | null;
  created_at: string;
  updated_at: string;
};

export type DecayLine = {
  memoryKey: string;
  rawText: string;
  weightedText: string | null;
  startSalience: number;
  salience: number;
  band: string;
  rate: number;
  days: number;
  t0: string;
};

export const MEMORY_INSTRUCTION_CAP = 10;

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

export async function migrateMemories() {
  if (!isMemoryStoreConfigured()) return { ok: false, reason: "missing DATABASE_URL" as const };
  await ensureTable();
  return { ok: true as const };
}

let ensured: Promise<ReturnType<typeof sql>> | null = null;

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
  return db;
}

export async function listByUser(userId: string): Promise<MemoryRow[]> {
  const db = await ensureTable();
  if (!db) return [];
  return (await db.query(
    `SELECT * FROM memories WHERE user_id = $1 ORDER BY t0 ASC`,
    [userId],
  )) as MemoryRow[];
}

export async function upsertMemory(input: {
  userId: string;
  memoryKey: string;
  rawText: string;
  weightedText?: string;
  startSalience: number;
  t0?: Date;
}): Promise<MemoryRow | null> {
  const db = await ensureTable();
  if (!db) return null;
  const start = Math.min(10, Math.max(1, input.startSalience));
  const band = bandFromStart(start);
  const rate = rateForBand(band);
  const t0 = input.t0 ?? new Date();
  const rows = (await db.query(
    `INSERT INTO memories (
       user_id, memory_key, raw_text, weighted_text, start_salience, salience, band, rate, t0, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, now())
     ON CONFLICT (user_id, memory_key) DO UPDATE SET
       raw_text = excluded.raw_text,
       weighted_text = excluded.weighted_text,
       start_salience = excluded.start_salience,
       salience = excluded.start_salience,
       band = excluded.band,
       rate = excluded.rate,
       t0 = excluded.t0,
       updated_at = now()
     RETURNING *`,
    [input.userId, input.memoryKey, input.rawText, input.weightedText ?? null, start, band, rate, t0.toISOString()],
  )) as MemoryRow[];
  return rows[0] ?? null;
}

export async function recallForUser(userId: string, at = new Date()): Promise<DecayLine[]> {
  const db = await ensureTable();
  if (!db) return [];
  const rows = await listByUser(userId);
  const lines: DecayLine[] = [];
  for (const row of rows) {
    const clock = new Date(row.t0);
    const band = bandFromStart(row.start_salience);
    const rate = rateForBand(band);
    const days = daysElapsed(at, clock);
    const salience = decaySalience(row.start_salience, rate, days);
    await db.query(
      `UPDATE memories
       SET salience = $1, band = $2, rate = $3, last_decay = $4, updated_at = $4
       WHERE id = $5`,
      [salience, band, rate, at.toISOString(), row.id],
    );
    lines.push({
      memoryKey: row.memory_key,
      rawText: row.raw_text,
      weightedText: row.weighted_text,
      startSalience: row.start_salience,
      salience,
      band,
      rate,
      days,
      t0: row.t0,
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

export function formatMemoryInstructions(lines: DecayLine[]) {
  const selected = rankMemoriesForInstructions(lines)
    .filter((line) => line.rawText.trim() || line.weightedText?.trim())
    .slice(0, MEMORY_INSTRUCTION_CAP)
    .map((line, index) => {
      const text = line.rawText.trim() || line.weightedText?.trim() || "";
      return `${index + 1}. [${line.memoryKey} start=${round(line.startSalience)} current=${round(line.salience)} band=${line.band}]\n${text}`;
    });
  if (selected.length === 0) return "";
  return `RECALLED MEMORIES

These are stored memories from prior sessions. Never present them as certain. Flag confidence on every recalled fact. When two stored facts conflict, surface the conflict rather than resolving it silently.

${selected.join("\n\n")}`;
}

export function formatDecayState(lines: DecayLine[]) {
  if (lines.length === 0) return "no active decay tags";
  return lines
    .map(
      (line) =>
        `${line.memoryKey} start=${round(line.startSalience)} current=${round(line.salience)} band=${line.band} rate=${line.rate} days=${round(line.days)} t0=${line.t0}`,
    )
    .join(" | ");
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}
