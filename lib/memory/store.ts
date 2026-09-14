import { neon } from "@neondatabase/serverless";
import { bandFromStart, daysElapsed, decaySalience, rateForBand } from "@/lib/memory/decay";

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
  startSalience: number;
  salience: number;
  band: string;
  rate: number;
  days: number;
  t0: string;
};

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

async function ensureTable() {
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
