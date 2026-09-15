import { createHash, randomBytes } from "crypto";
import {
  AccountAuthError,
  ensureBootstrapAdmin,
  hashPassword,
  isAccountStoreConfigured,
  validateAccountName,
  validateEmail,
  validatePassword,
} from "@/lib/auth/accounts";
import { sendOutboundEmail, isOutboundEmailConfigured } from "@/lib/channels/email";
import { neon } from "@neondatabase/serverless";

const RESET_TTL_MS = 60 * 60 * 1000;
const RESET_CODE_LEN = 12;
const RESET_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RESET_SENT = "If that account exists, we sent a reset email.";

function databaseUrl() {
  return process.env.DATABASE_URL || process.env.NEON_DATABASE_URL || "";
}

function sql() {
  const url = databaseUrl();
  if (!url) return null;
  return neon(url);
}

let ensured: Promise<void> | null = null;

async function ensureResetTable() {
  const db = sql();
  if (!db) throw new AccountAuthError("Accounts are not configured. Set DATABASE_URL.", 503);
  if (!ensured) {
    ensured = db
      .query(
        `
        CREATE TABLE IF NOT EXISTS password_resets (
          token_hash text PRIMARY KEY,
          user_id text NOT NULL,
          expires_at timestamptz NOT NULL,
          used_at timestamptz
        )
      `,
      )
      .then(() => undefined)
      .catch((error) => {
        ensured = null;
        throw error;
      });
  }
  await ensured;
  return db;
}

export function generateResetToken() {
  const bytes = randomBytes(RESET_CODE_LEN);
  return Array.from(bytes, (byte) => RESET_ALPHABET[byte % RESET_ALPHABET.length]).join("");
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token.trim().toUpperCase()).digest("base64url");
}

export function publicAppUrl(request: Request) {
  const configured = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  return new URL(request.url).origin;
}

function resetEmailBody(userId: string, token: string, resetUrl: string) {
  return [
    `Reset the Lexi password for ${userId}.`,
    "",
    "This does not include your current password — only a one-time reset.",
    "The link and code expire in 1 hour and can be used once.",
    "",
    resetUrl,
    "",
    `Or enter this code on the sign-in page: ${token}`,
    "",
    "If you did not ask for this, ignore this email.",
  ].join("\n");
}

async function dispatchResetEmail(to: string, userId: string, token: string, resetUrl: string) {
  if (!isOutboundEmailConfigured()) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[auth] password reset created; outbound email is not configured. Reset link:", resetUrl);
    } else {
      console.info("[auth] password reset created; outbound email is not configured (EMAIL_FROM + RESEND_API_KEY or SMTP_*).");
    }
    return;
  }
  const result = await sendOutboundEmail({
    to,
    subject: "Reset your Lexi password",
    text: resetEmailBody(userId, token, resetUrl),
  });
  if (!result.ok) {
    console.info("[auth] password reset email failed:", result.error);
    if (process.env.NODE_ENV !== "production") {
      console.info("[auth] password reset link (not emailed):", resetUrl);
    }
    return;
  }
  console.info("[auth] password reset email sent");
}

export async function requestPasswordReset(rawUserId: unknown, rawEmail: unknown, origin: string) {
  if (!isAccountStoreConfigured()) {
    throw new AccountAuthError("Accounts are not configured. Set DATABASE_URL.", 503);
  }
  const userId = validateAccountName(typeof rawUserId === "string" ? rawUserId : "");
  const email = validateEmail(rawEmail);
  await ensureBootstrapAdmin();
  const db = await ensureResetTable();
  const rows = (await db.query(`SELECT email FROM accounts WHERE user_id = $1 LIMIT 1`, [
    userId,
  ])) as { email?: string | null }[];
  const bound = typeof rows[0]?.email === "string" ? rows[0].email.trim().toLowerCase() : "";
  if (bound && bound === email) {
    const token = generateResetToken();
    const tokenHash = hashResetToken(token);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();
    await db.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [
      userId,
    ]);
    await db.query(
      `INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [tokenHash, userId, expiresAt],
    );
    const resetUrl = `${origin.replace(/\/$/, "")}/reset?token=${encodeURIComponent(token)}`;
    await dispatchResetEmail(email, userId, token, resetUrl);
  }
  return RESET_SENT;
}

export async function completePasswordReset(rawToken: unknown, password: unknown) {
  if (!isAccountStoreConfigured()) {
    throw new AccountAuthError("Accounts are not configured. Set DATABASE_URL.", 503);
  }
  if (typeof rawToken !== "string" || !rawToken.trim()) {
    throw new AccountAuthError("Reset code is required.");
  }
  const secret = validatePassword(password);
  const tokenHash = hashResetToken(rawToken);
  const db = await ensureResetTable();
  const rows = (await db.query(
    `SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = $1 LIMIT 1`,
    [tokenHash],
  )) as { user_id?: string; expires_at?: string; used_at?: string | null }[];
  const row = rows[0];
  const userId = typeof row?.user_id === "string" ? row.user_id : "";
  const expiresAt = row?.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!userId || row?.used_at || !expiresAt || expiresAt <= Date.now()) {
    throw new AccountAuthError("That reset code is invalid or expired.", 400);
  }
  await db.query(`UPDATE accounts SET password_hash = $1, updated_at = now() WHERE user_id = $2`, [
    hashPassword(secret),
    userId,
  ]);
  await db.query(`UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`, [
    userId,
  ]);
  return userId;
}
