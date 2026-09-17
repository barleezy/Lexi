import { neon } from "@neondatabase/serverless";
import Stripe from "stripe";
import { stripeClient } from "./stripe";

/** Official xAI Management API. Inference `XAI_API_KEY` is not accepted here. */
export const XAI_MANAGEMENT_API_BASE = "https://management-api.x.ai";
export const XAI_PREPAID_TOPUP_PATH = "/v1/billing/teams/{team_id}/prepaid/top-up";

/** Public Stripe endpoint for xAI prepaid top-up. Distinct from voice-minutes `/api/billing/webhook`. */
export const XAI_STRIPE_WEBHOOK_PATH = "/api/webhooks/stripe";
export const XAI_STRIPE_WEBHOOK_URL = `https://www.talktolexi.app${XAI_STRIPE_WEBHOOK_PATH}`;

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

export async function ensureXaiTopupSchema() {
  const db = sql();
  if (!db) return null;
  if (!ensured) {
    ensured = (async () => {
      await db.query(
        `
        CREATE TABLE IF NOT EXISTS xai_credit_topups (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          stripe_event_id text NOT NULL,
          stripe_session_id text,
          user_id text,
          email text,
          amount_cents integer NOT NULL,
          status text NOT NULL DEFAULT 'pending',
          xai_status integer,
          xai_body text,
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `,
      );
      await db.query(
        `
        CREATE UNIQUE INDEX IF NOT EXISTS xai_credit_topups_stripe_event_uidx
        ON xai_credit_topups (stripe_event_id)
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

export function xaiManagementApiKey(env: NodeJS.ProcessEnv = process.env) {
  return env.XAI_MANAGEMENT_API_KEY?.trim() || "";
}

/** Team id from env only — never invent a placeholder. Copy from xAI Console → Team settings. */
export function xaiTeamId(env: NodeJS.ProcessEnv = process.env) {
  return env.XAI_TEAM_ID?.trim() || "";
}

export function xaiPrepaidTopUpUrl(env: NodeJS.ProcessEnv = process.env) {
  const teamId = xaiTeamId(env);
  const explicit = env.XAI_CREDITS_TOPUP_ENDPOINT?.trim();
  if (explicit) {
    return explicit.replace(/\{team_id\}/gi, teamId);
  }
  if (!teamId) return "";
  return `${XAI_MANAGEMENT_API_BASE}/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/top-up`;
}

function stripeXaiWebhookSecret(env: NodeJS.ProcessEnv = process.env) {
  return env.STRIPE_WEBHOOK_SECRET?.trim() || "";
}

function sessionUserId(session: Stripe.Checkout.Session) {
  return (
    (typeof session.metadata?.user_id === "string" && session.metadata.user_id.trim()) ||
    (typeof session.metadata?.userId === "string" && session.metadata.userId.trim()) ||
    (typeof session.client_reference_id === "string" && session.client_reference_id.trim()) ||
    ""
  );
}

function sessionEmail(session: Stripe.Checkout.Session) {
  return (
    (typeof session.metadata?.email === "string" && session.metadata.email.trim()) ||
    (typeof session.customer_email === "string" && session.customer_email.trim()) ||
    (typeof session.customer_details?.email === "string" && session.customer_details.email.trim()) ||
    ""
  );
}

type Claim =
  | { ok: true; claimed: true }
  | { ok: true; claimed: false; alreadySucceeded: true }
  | { ok: false; error: string };

async function claimStripeEvent(input: {
  stripeEventId: string;
  stripeSessionId: string | null;
  userId: string;
  email: string;
  amountCents: number;
}): Promise<Claim> {
  const db = await ensureXaiTopupSchema();
  if (!db) return { ok: false, error: "wallet not configured" };

  const existing = asRows<{ status?: string }>(
    await db.query(`SELECT status FROM xai_credit_topups WHERE stripe_event_id = $1 LIMIT 1`, [
      input.stripeEventId,
    ]),
  );
  if (existing[0]?.status === "succeeded") {
    return { ok: true, claimed: false, alreadySucceeded: true };
  }
  if (existing[0]) {
    return { ok: false, error: "xAI top-up already in progress for this Stripe event" };
  }

  try {
    await db.query(
      `
      INSERT INTO xai_credit_topups (
        stripe_event_id, stripe_session_id, user_id, email, amount_cents, status
      )
      VALUES ($1, $2, $3, $4, $5, 'pending')
    `,
      [input.stripeEventId, input.stripeSessionId, input.userId || null, input.email || null, input.amountCents],
    );
    return { ok: true, claimed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/unique|duplicate/i.test(message)) throw error;
    const again = asRows<{ status?: string }>(
      await db.query(`SELECT status FROM xai_credit_topups WHERE stripe_event_id = $1 LIMIT 1`, [
        input.stripeEventId,
      ]),
    );
    if (again[0]?.status === "succeeded") {
      return { ok: true, claimed: false, alreadySucceeded: true };
    }
    return { ok: false, error: "xAI top-up already in progress for this Stripe event" };
  }
}

async function markTopupSucceeded(stripeEventId: string, xaiStatus: number, xaiBody: string) {
  const db = await ensureXaiTopupSchema();
  if (!db) return;
  await db.query(
    `
    UPDATE xai_credit_topups
    SET status = 'succeeded', xai_status = $2, xai_body = $3
    WHERE stripe_event_id = $1
  `,
    [stripeEventId, xaiStatus, xaiBody],
  );
}

async function releaseTopupClaim(stripeEventId: string) {
  const db = await ensureXaiTopupSchema();
  if (!db) return;
  await db.query(`DELETE FROM xai_credit_topups WHERE stripe_event_id = $1 AND status = 'pending'`, [
    stripeEventId,
  ]);
}

export async function topUpXaiPrepaidCredits(input: {
  amount_total: number;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const key = xaiManagementApiKey(env);
  const teamId = xaiTeamId(env);
  const url = xaiPrepaidTopUpUrl(env);
  const amount_total = input.amount_total;
  const requestBody = { amount: { val: String(amount_total) } };

  if (!key) {
    return { ok: false as const, error: "XAI_MANAGEMENT_API_KEY is not configured." };
  }
  if (!teamId || !url) {
    return { ok: false as const, error: "XAI_TEAM_ID is not configured." };
  }

  console.info("[xai-topup] request body", requestBody);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const body = await response.text();
  console.info("[xai-topup] response", { status: response.status, body });

  if (!response.ok) {
    return {
      ok: false as const,
      status: response.status,
      body,
      error: `xAI top-up failed (${response.status})`,
    };
  }
  return { ok: true as const, status: response.status, body };
}

export async function handleXaiStripeWebhook(input: {
  rawBody: string;
  signature: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const secret = stripeXaiWebhookSecret(env);
  const stripe = stripeClient(env);
  if (!stripe || !secret) {
    return { ok: false as const, status: 503, error: "Billing is not configured." };
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(input.rawBody, input.signature, secret);
  } catch {
    return { ok: false as const, status: 400, error: "Invalid Stripe signature." };
  }

  console.info("[stripe-xai-webhook] event", {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
  });

  if (event.type !== "checkout.session.completed") {
    return { ok: true as const, ignored: true as const };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const amount_total = session.amount_total;
  const userId = sessionUserId(session);
  const email = sessionEmail(session);

  console.info("[stripe-xai-webhook] checkout.session.completed", {
    eventId: event.id,
    sessionId: session.id,
    amount_total,
    currency: session.currency,
    userId,
    email,
  });

  if (amount_total == null || !Number.isFinite(amount_total) || amount_total <= 0) {
    return {
      ok: true as const,
      ignored: true as const,
      reason: "missing_amount_total",
    };
  }

  const claimed = await claimStripeEvent({
    stripeEventId: event.id,
    stripeSessionId: session.id,
    userId,
    email,
    amountCents: amount_total,
  });
  if (!claimed.ok) {
    return { ok: false as const, status: 500, error: claimed.error };
  }
  if (!claimed.claimed) {
    return { ok: true as const, alreadyProcessed: true as const, eventId: event.id };
  }

  try {
    const topped = await topUpXaiPrepaidCredits({ amount_total, env });
    if (!topped.ok) {
      await releaseTopupClaim(event.id);
      return { ok: false as const, status: 500, error: topped.error };
    }
    await markTopupSucceeded(event.id, topped.status, topped.body);
    return {
      ok: true as const,
      toppedUp: true as const,
      amountCents: amount_total,
      eventId: event.id,
      userId,
      email,
    };
  } catch (error) {
    await releaseTopupClaim(event.id);
    const message = error instanceof Error ? error.message : "xAI top-up failed";
    console.error("[stripe-xai-webhook] top-up threw", error);
    return { ok: false as const, status: 500, error: message };
  }
}
