import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { neon } from "@neondatabase/serverless";
import { normalizeUserId } from "@/lib/memory/user";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 128;
const MIN_ACCOUNT = 2;
const MAX_ACCOUNT = 40;

export class AccountAuthError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "";
}

function sql() {
  const url = databaseUrl();
  if (!url) return null;
  return neon(url);
}

export function isAccountStoreConfigured() {
  return Boolean(databaseUrl());
}

export function validateAccountName(raw?: string | null) {
  const userId = normalizeUserId(raw);
  if (!userId) throw new AccountAuthError("Account is required.");
  if (userId.length < MIN_ACCOUNT || userId.length > MAX_ACCOUNT) {
    throw new AccountAuthError(`Account must be ${MIN_ACCOUNT}–${MAX_ACCOUNT} characters.`);
  }
  if (!/^[\p{L}\p{N}._-]+$/u.test(userId)) {
    throw new AccountAuthError("Account can only use letters, numbers, dots, underscores, and hyphens.");
  }
  return userId;
}

export function validatePassword(raw?: unknown) {
  if (typeof raw !== "string") throw new AccountAuthError("Password is required.");
  if (raw.length < MIN_PASSWORD) {
    throw new AccountAuthError(`Password must be at least ${MIN_PASSWORD} characters.`);
  }
  if (raw.length > MAX_PASSWORD) throw new AccountAuthError("Password is too long.");
  return raw;
}

const MAX_EMAIL = 254;

export function validateEmail(raw?: unknown) {
  if (typeof raw !== "string") throw new AccountAuthError("Email is required.");
  const email = raw.trim().toLowerCase();
  if (!email) throw new AccountAuthError("Email is required.");
  if (email.length > MAX_EMAIL) throw new AccountAuthError("Email is too long.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AccountAuthError("Enter a valid email address.");
  }
  return email;
}

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
  const salt = Buffer.from(parts[4] ?? "", "base64url");
  const expected = Buffer.from(parts[5] ?? "", "base64url");
  if (!salt.length || expected.length !== KEY_LEN) return false;
  const actual = scryptSync(password, salt, expected.length, { N: n, r, p });
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

let ensured: Promise<void> | null = null;

async function ensureAccountsTable() {
  const db = sql();
  if (!db) throw new AccountAuthError("Accounts are not configured. Set DATABASE_URL.", 503);
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
      await db.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email text`);
      await db.query(
        `
        CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_lower_idx
        ON accounts (lower(email))
        WHERE email IS NOT NULL AND email <> ''
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

/** Barleezy and Ian are the same admin row (`normalizeUserId`). Server-only — not shown in UI. */
export const ADMIN_ACCOUNT_EMAIL = "barlow80136@gmail.com";

export async function ensureBootstrapAdmin() {
  const db = await ensureAccountsTable();
  const userId = normalizeUserId("Barleezy");
  const email = ADMIN_ACCOUNT_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD?.trim();
  if (password) {
    await db.query(
      `
      INSERT INTO accounts (user_id, password_hash, email)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email, updated_at = now()
    `,
      [userId, hashPassword(password), email],
    );
    return;
  }
  await db.query(
    `
    UPDATE accounts
    SET email = $1, updated_at = now()
    WHERE user_id = $2
  `,
    [email, userId],
  );
}

async function emailTakenByOther(db: NonNullable<ReturnType<typeof sql>>, email: string, userId?: string) {
  const rows = userId
    ? ((await db.query(
        `SELECT user_id FROM accounts WHERE lower(email) = $1 AND user_id <> $2 LIMIT 1`,
        [email, userId],
      )) as { user_id?: string }[])
    : ((await db.query(`SELECT user_id FROM accounts WHERE lower(email) = $1 LIMIT 1`, [
        email,
      ])) as { user_id?: string }[]);
  return Array.isArray(rows) && rows.length > 0;
}

export async function createAccount(rawUserId: string, password: string, rawEmail: string) {
  const userId = validateAccountName(rawUserId);
  const secret = validatePassword(password);
  const email = validateEmail(rawEmail);
  await ensureBootstrapAdmin();
  const db = await ensureAccountsTable();
  const existing = await db.query(`SELECT user_id FROM accounts WHERE user_id = $1 LIMIT 1`, [userId]);
  if (Array.isArray(existing) && existing.length > 0) {
    throw new AccountAuthError("That account already exists. Sign in instead.", 409);
  }
  if (await emailTakenByOther(db, email)) {
    throw new AccountAuthError("That email is already in use.", 409);
  }
  await db.query(`INSERT INTO accounts (user_id, password_hash, email) VALUES ($1, $2, $3)`, [
    userId,
    hashPassword(secret),
    email,
  ]);
  return userId;
}

export async function authenticateAccount(rawUserId: string, password: string, rawEmail: string) {
  const userId = validateAccountName(rawUserId);
  const secret = validatePassword(password);
  const email = validateEmail(rawEmail);
  await ensureBootstrapAdmin();
  const db = await ensureAccountsTable();
  const rows = (await db.query(
    `SELECT password_hash, email FROM accounts WHERE user_id = $1 LIMIT 1`,
    [userId],
  )) as { password_hash?: string; email?: string | null }[];
  const stored = typeof rows[0]?.password_hash === "string" ? rows[0].password_hash : "";
  if (!stored || !verifyPassword(secret, stored)) {
    throw new AccountAuthError("Account, email, or password is wrong.", 401);
  }
  const bound = typeof rows[0]?.email === "string" ? rows[0].email.trim().toLowerCase() : "";
  if (bound) {
    if (bound !== email) {
      throw new AccountAuthError("Account, email, or password is wrong.", 401);
    }
    return userId;
  }
  if (await emailTakenByOther(db, email, userId)) {
    throw new AccountAuthError("That email is already in use.", 409);
  }
  await db.query(`UPDATE accounts SET email = $1, updated_at = now() WHERE user_id = $2`, [
    email,
    userId,
  ]);
  return userId;
}
