import { neon } from "@neondatabase/serverless";
import { findAccountRow, isAccountStoreConfigured } from "../auth/accounts";
import { normalizeUserId } from "../memory/user";

/** Minimum balance to start a Call. */
export const VOICE_MIN_SECONDS = 30;

/** Per-Call hold / hard cap (seconds). Mint TTL ≤ this. */
export const VOICE_HOLD_SECONDS = 90;

/** Sweeper grace after hold before forced settle. */
export const VOICE_SWEEP_GRACE_SECONDS = 30;

export const OUT_OF_MINUTES_CODE = "out_of_minutes";
export const OUT_OF_MINUTES_MESSAGE = "Out of minutes.";

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "";
}

function sql() {
  const url = databaseUrl();
  if (!url) return null;
  return neon(url);
}

function asRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

let ensured: Promise<void> | null = null;

/**
 * accounts.voice_seconds on the user row + voice_sessions ledger.
 * Stripe webhook is the only production writer that increments voice_seconds.
 */
export async function ensureVoiceWalletSchema() {
  const db = sql();
  if (!db) return null;
  if (!ensured) {
    ensured = (async () => {
      await db.query(
        `
        CREATE TABLE IF NOT EXISTS accounts (
          user_id text PRIMARY KEY,
          password_hash text NOT NULL,
          email text,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `,
      );
      await db.query(
        `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS voice_seconds integer NOT NULL DEFAULT 0`,
      );
      await db.query(
        `
        CREATE TABLE IF NOT EXISTS voice_sessions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id text NOT NULL,
          started_at timestamptz NOT NULL DEFAULT now(),
          hold_seconds integer NOT NULL,
          settled_at timestamptz,
          used_seconds integer
        )
      `,
      );
      await db.query(
        `
        CREATE INDEX IF NOT EXISTS voice_sessions_user_open_idx
        ON voice_sessions (user_id)
        WHERE settled_at IS NULL
      `,
      );
      await db.query(
        `
        CREATE TABLE IF NOT EXISTS voice_credits (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id text NOT NULL,
          seconds integer NOT NULL,
          source text NOT NULL,
          stripe_event_id text,
          stripe_session_id text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `,
      );
      await db.query(
        `
        CREATE UNIQUE INDEX IF NOT EXISTS voice_credits_stripe_event_uidx
        ON voice_credits (stripe_event_id)
        WHERE stripe_event_id IS NOT NULL AND stripe_event_id <> ''
      `,
      );
    })().catch((error) => {
      ensured = null;
      throw error;
    });
  }
  await ensured;
  return db;
}

export function isVoiceWalletConfigured() {
  return isAccountStoreConfigured() && Boolean(databaseUrl());
}

export async function readVoiceSeconds(userId: string): Promise<number | null> {
  const id = normalizeUserId(userId);
  if (!id) return null;
  const db = await ensureVoiceWalletSchema();
  if (!db) return null;
  const account = await findAccountRow(id);
  const accountId = account?.user_id ?? id;
  const rows = asRows<{ voice_seconds?: number }>(
    await db.query(`SELECT voice_seconds FROM accounts WHERE user_id = $1 LIMIT 1`, [accountId]),
  );
  if (!rows[0]) return account ? 0 : null;
  const value = Number(rows[0].voice_seconds);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Stripe webhook only in production. Idempotent on stripe_event_id.
 * Tests may call with source "test".
 */
export async function creditVoiceSeconds(input: {
  userId: string;
  seconds: number;
  source: "stripe" | "test";
  stripeEventId?: string | null;
  stripeSessionId?: string | null;
}): Promise<{ ok: true; voiceSeconds: number; credited: number } | { ok: false; error: string }> {
  const userId = normalizeUserId(input.userId);
  const seconds = Math.floor(Number(input.seconds));
  if (!userId) return { ok: false, error: "userId required" };
  if (!Number.isFinite(seconds) || seconds <= 0) return { ok: false, error: "seconds must be positive" };
  const db = await ensureVoiceWalletSchema();
  if (!db) return { ok: false, error: "wallet not configured" };

  const account = await findAccountRow(userId);
  if (!account?.user_id) return { ok: false, error: "account not found" };
  const accountId = account.user_id;

  const eventId = input.stripeEventId?.trim() || null;
  if (eventId) {
    const existing = asRows<{ id?: string }>(
      await db.query(`SELECT id FROM voice_credits WHERE stripe_event_id = $1 LIMIT 1`, [eventId]),
    );
    if (existing[0]) {
      const balance = await readVoiceSeconds(accountId);
      return { ok: true, voiceSeconds: balance ?? 0, credited: 0 };
    }
  }

  try {
    await db.query(
      `
      INSERT INTO voice_credits (user_id, seconds, source, stripe_event_id, stripe_session_id)
      VALUES ($1, $2, $3, $4, $5)
    `,
      [accountId, seconds, input.source, eventId, input.stripeSessionId?.trim() || null],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/unique|duplicate/i.test(message) && eventId) {
      const balance = await readVoiceSeconds(accountId);
      return { ok: true, voiceSeconds: balance ?? 0, credited: 0 };
    }
    throw error;
  }

  const updated = asRows<{ voice_seconds?: number }>(
    await db.query(
      `
      UPDATE accounts
      SET voice_seconds = voice_seconds + $1, updated_at = now()
      WHERE user_id = $2
      RETURNING voice_seconds
    `,
      [seconds, accountId],
    ),
  );
  return {
    ok: true,
    voiceSeconds: Math.max(0, Math.floor(Number(updated[0]?.voice_seconds) || 0)),
    credited: seconds,
  };
}

export type VoiceHoldOk = {
  ok: true;
  voiceSessionId: string;
  holdSeconds: number;
  voiceSeconds: number;
  startedAt: string;
  capAtMs: number;
  mintTtlSeconds: number;
};

export type VoiceHoldFail = {
  ok: false;
  code: typeof OUT_OF_MINUTES_CODE | "busy" | "no_account" | "not_configured";
  error: string;
};

/**
 * Atomic-ish hold via CTE: require no open unsettled voice_session; subtract hold;
 * insert voice_sessions. Hold is VOICE_HOLD_SECONDS when balance allows, else remaining
 * when balance ∈ [VOICE_MIN_SECONDS, VOICE_HOLD_SECONDS).
 */
export async function placeVoiceHold(userId: string): Promise<VoiceHoldOk | VoiceHoldFail> {
  const id = normalizeUserId(userId);
  if (!id) return { ok: false, code: "no_account", error: "Sign in first." };
  const db = await ensureVoiceWalletSchema();
  if (!db) return { ok: false, code: "not_configured", error: "Voice wallet is not configured." };

  const account = await findAccountRow(id);
  if (!account?.user_id) return { ok: false, code: "no_account", error: "Sign in first." };
  const accountId = account.user_id;

  await sweepStaleVoiceSessions(accountId);

  const open = asRows<{ id?: string }>(
    await db.query(
      `
      SELECT id FROM voice_sessions
      WHERE lower(user_id) = lower($1) AND settled_at IS NULL
      LIMIT 1
    `,
      [accountId],
    ),
  );
  if (open[0]?.id) {
    return { ok: false, code: "busy", error: "A Call is already open. Hang up first." };
  }

  const balance = (await readVoiceSeconds(accountId)) ?? 0;
  if (balance < VOICE_MIN_SECONDS) {
    return { ok: false, code: OUT_OF_MINUTES_CODE, error: OUT_OF_MINUTES_MESSAGE };
  }
  const holdSeconds = Math.min(VOICE_HOLD_SECONDS, balance);

  const rows = asRows<{
    id?: string;
    started_at?: string;
    hold_seconds?: number;
    voice_seconds?: number;
  }>(
    await db.query(
      `
      WITH debited AS (
        UPDATE accounts
        SET voice_seconds = voice_seconds - $2, updated_at = now()
        WHERE user_id = $1
          AND voice_seconds >= $3
          AND NOT EXISTS (
            SELECT 1 FROM voice_sessions
            WHERE lower(user_id) = lower($1) AND settled_at IS NULL
          )
        RETURNING voice_seconds
      ),
      inserted AS (
        INSERT INTO voice_sessions (user_id, hold_seconds)
        SELECT $1, $2 FROM debited
        RETURNING id, started_at, hold_seconds
      )
      SELECT i.id, i.started_at, i.hold_seconds, d.voice_seconds
      FROM inserted i
      CROSS JOIN debited d
    `,
      [accountId, holdSeconds, VOICE_MIN_SECONDS],
    ),
  );

  const row = rows[0];
  if (!row?.id) {
    const again = (await readVoiceSeconds(accountId)) ?? 0;
    if (again < VOICE_MIN_SECONDS) {
      return { ok: false, code: OUT_OF_MINUTES_CODE, error: OUT_OF_MINUTES_MESSAGE };
    }
    return { ok: false, code: "busy", error: "A Call is already open. Hang up first." };
  }

  const startedAt = String(row.started_at ?? new Date().toISOString());
  const hold = Math.floor(Number(row.hold_seconds) || holdSeconds);
  return {
    ok: true,
    voiceSessionId: String(row.id),
    holdSeconds: hold,
    voiceSeconds: Math.max(0, Math.floor(Number(row.voice_seconds) || 0)),
    startedAt,
    capAtMs: Date.parse(startedAt) + hold * 1000,
    mintTtlSeconds: hold,
  };
}

/** Refund full hold when mint fails after debit. */
export async function releaseVoiceHold(userId: string, voiceSessionId: string) {
  const id = normalizeUserId(userId);
  if (!id || !voiceSessionId) return null;
  const db = await ensureVoiceWalletSchema();
  if (!db) return null;

  const rows = asRows<{ hold_seconds?: number; settled_at?: string | null }>(
    await db.query(
      `
      SELECT hold_seconds, settled_at FROM voice_sessions
      WHERE id = $1::uuid AND lower(user_id) = lower($2)
      LIMIT 1
    `,
      [voiceSessionId, id],
    ),
  );
  const hold = Math.floor(Number(rows[0]?.hold_seconds) || 0);
  if (!hold || rows[0]?.settled_at) return null;

  await db.query(
    `UPDATE accounts SET voice_seconds = voice_seconds + $1, updated_at = now() WHERE lower(user_id) = lower($2)`,
    [hold, id],
  );
  await db.query(
    `
    UPDATE voice_sessions
    SET settled_at = now(), used_seconds = 0
    WHERE id = $1::uuid AND lower(user_id) = lower($2) AND settled_at IS NULL
  `,
    [voiceSessionId, id],
  );
  return { refunded: hold };
}

export type SettleResult = {
  usedSeconds: number;
  refundedSeconds: number;
  holdSeconds: number;
  voiceSeconds: number;
  alreadySettled: boolean;
};

/** Hangup settle: used = min(elapsed, hold); refund hold - used. */
export async function settleVoiceSession(
  userId: string,
  voiceSessionId: string,
): Promise<SettleResult | null> {
  const id = normalizeUserId(userId);
  if (!id || !voiceSessionId) return null;
  const db = await ensureVoiceWalletSchema();
  if (!db) return null;

  const existing = asRows<{
    hold_seconds?: number;
    settled_at?: string | null;
    started_at?: string;
  }>(
    await db.query(
      `
      SELECT hold_seconds, settled_at, started_at
      FROM voice_sessions
      WHERE id = $1::uuid AND lower(user_id) = lower($2)
      LIMIT 1
    `,
      [voiceSessionId, id],
    ),
  );
  const row = existing[0];
  if (!row) return null;
  const holdSeconds = Math.max(0, Math.floor(Number(row.hold_seconds) || 0));
  if (row.settled_at) {
    return {
      usedSeconds: 0,
      refundedSeconds: 0,
      holdSeconds,
      voiceSeconds: (await readVoiceSeconds(id)) ?? 0,
      alreadySettled: true,
    };
  }

  const timed = asRows<{ used?: number; refund?: number }>(
    await db.query(
      `
      SELECT
        LEAST(
          hold_seconds,
          GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - started_at)))::int)
        ) AS used,
        hold_seconds - LEAST(
          hold_seconds,
          GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (now() - started_at)))::int)
        ) AS refund
      FROM voice_sessions
      WHERE id = $1::uuid
    `,
      [voiceSessionId],
    ),
  );
  const usedSeconds = Math.max(0, Math.floor(Number(timed[0]?.used) || 0));
  const refundedSeconds = Math.max(0, Math.floor(Number(timed[0]?.refund) || 0));

  if (refundedSeconds > 0) {
    await db.query(
      `UPDATE accounts SET voice_seconds = voice_seconds + $1, updated_at = now() WHERE lower(user_id) = lower($2)`,
      [refundedSeconds, id],
    );
  }
  await db.query(
    `
    UPDATE voice_sessions
    SET settled_at = now(), used_seconds = $1
    WHERE id = $2::uuid AND lower(user_id) = lower($3) AND settled_at IS NULL
  `,
    [usedSeconds, voiceSessionId, id],
  );

  return {
    usedSeconds,
    refundedSeconds,
    holdSeconds,
    voiceSeconds: (await readVoiceSeconds(id)) ?? 0,
    alreadySettled: false,
  };
}

/** Settle any open session for the user older than hold + grace (server clock). */
export async function sweepStaleVoiceSessions(userId?: string) {
  const db = await ensureVoiceWalletSchema();
  if (!db) return { settled: 0 };
  const params: unknown[] = [VOICE_SWEEP_GRACE_SECONDS];
  let userClause = "";
  if (userId) {
    params.push(normalizeUserId(userId));
    userClause = `AND lower(user_id) = lower($2)`;
  }
  const stale = asRows<{ id?: string; user_id?: string }>(
    await db.query(
      `
      SELECT id, user_id FROM voice_sessions
      WHERE settled_at IS NULL
        AND started_at < now() - ((hold_seconds + $1) * interval '1 second')
        ${userClause}
      LIMIT 50
    `,
      params,
    ),
  );
  let settled = 0;
  for (const row of stale) {
    if (!row.id || !row.user_id) continue;
    const result = await settleVoiceSession(row.user_id, row.id);
    if (result && !result.alreadySettled) settled += 1;
  }
  return { settled };
}

export function formatVoiceMinutes(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m <= 0) return `${rem}s`;
  if (rem === 0) return `${m} min`;
  return `${m}m ${rem}s`;
}

/** Resume an open unsettled hold without debiting again. */
export async function readOpenVoiceSession(userId: string, voiceSessionId: string) {
  const id = normalizeUserId(userId);
  if (!id || !voiceSessionId) return null;
  const db = await ensureVoiceWalletSchema();
  if (!db) return null;
  const rows = asRows<{
    id?: string;
    hold_seconds?: number;
    started_at?: string;
    settled_at?: string | null;
  }>(
    await db.query(
      `
      SELECT id, hold_seconds, started_at, settled_at
      FROM voice_sessions
      WHERE id = $1::uuid AND lower(user_id) = lower($2) AND settled_at IS NULL
      LIMIT 1
    `,
      [voiceSessionId, id],
    ),
  );
  const row = rows[0];
  if (!row?.id) return null;
  const holdSeconds = Math.max(0, Math.floor(Number(row.hold_seconds) || 0));
  const startedAt = String(row.started_at ?? new Date().toISOString());
  const startedMs = Date.parse(startedAt);
  const elapsed = Number.isFinite(startedMs)
    ? Math.max(0, Math.floor((Date.now() - startedMs) / 1000))
    : 0;
  const remaining = Math.max(0, holdSeconds - elapsed);
  if (remaining < 5) return null;
  return {
    voiceSessionId: String(row.id),
    holdSeconds,
    startedAt,
    remainingSeconds: remaining,
    capAtMs: startedMs + holdSeconds * 1000,
    voiceSeconds: (await readVoiceSeconds(id)) ?? 0,
  };
}

/** Realtime WebSocket must stay on voice. Never put a text model in this URL. */
export const REALTIME_VOICE_MODEL = "grok-voice-latest";
export const REALTIME_VOICE_URL = `wss://api.x.ai/v1/realtime?model=${REALTIME_VOICE_MODEL}`;

export function assertRealtimeVoiceModel(url: string) {
  if (!url.includes(`model=${REALTIME_VOICE_MODEL}`)) {
    throw new Error(`Realtime URL must use model=${REALTIME_VOICE_MODEL}`);
  }
  if (/grok-4-1-fast|grok-4\.|chat\/completions/i.test(url)) {
    throw new Error("Text models must not be used on the realtime WebSocket URL");
  }
}
