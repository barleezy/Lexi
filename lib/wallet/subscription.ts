import { findAccountRow } from "@/lib/auth/accounts";
import { normalizeUserId } from "@/lib/memory/user";
import { neon } from "@neondatabase/serverless";

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

function isActiveStripeStatus(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

let ensured: Promise<void> | null = null;

export async function ensureSubscriptionSchema() {
  const db = sql();
  if (!db) return null;
  if (!ensured) {
    ensured = (async () => {
      await db.query(
        `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false`,
      );
      await db.query(
        `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS subscribed boolean NOT NULL DEFAULT false`,
      );
      await db.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS monthly_minutes_reset_at timestamptz`);
      await db.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_customer_id text`);
      await db.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_subscription_id text`);
    })().catch((error) => {
      ensured = null;
      throw error;
    });
  }
  await ensured;
  return db;
}

type SubscriptionRow = {
  user_id?: string;
  email?: string | null;
  paid?: boolean | null;
  subscribed?: boolean | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
};

export async function readSubscriptionRow(userId: string): Promise<SubscriptionRow | null> {
  const id = normalizeUserId(userId);
  if (!id) return null;
  const db = await ensureSubscriptionSchema();
  if (!db) return null;
  const account = await findAccountRow(id);
  const accountId = account?.user_id ?? id;
  const rows = asRows<SubscriptionRow>(
    await db.query(
      `
      SELECT user_id, email, paid, subscribed, stripe_customer_id, stripe_subscription_id
      FROM accounts
      WHERE user_id = $1
      LIMIT 1
    `,
      [accountId],
    ),
  );
  return rows[0] ?? null;
}

export async function markAccountSubscribed(input: {
  userId: string;
  customerId?: string | null;
  subscriptionId?: string | null;
  subscribed?: boolean;
}) {
  const userId = normalizeUserId(input.userId);
  if (!userId) return { ok: false as const, error: "userId required" };
  const db = await ensureSubscriptionSchema();
  if (!db) return { ok: false as const, error: "wallet not configured" };
  const account = await findAccountRow(userId);
  const accountId = account?.user_id ?? userId;
  const subscribed = input.subscribed !== false;
  await db.query(
    `
    UPDATE accounts
    SET
      subscribed = $2,
      paid = CASE WHEN $2 THEN true ELSE paid END,
      stripe_customer_id = COALESCE(NULLIF($3, ''), stripe_customer_id),
      stripe_subscription_id = COALESCE(NULLIF($4, ''), stripe_subscription_id),
      updated_at = now()
    WHERE user_id = $1
  `,
    [accountId, subscribed, input.customerId?.trim() || "", input.subscriptionId?.trim() || ""],
  );
  return { ok: true as const, userId: accountId, subscribed };
}

export async function setSubscriptionByStripeId(input: {
  subscriptionId?: string | null;
  customerId?: string | null;
  userId?: string | null;
  subscribed: boolean;
}) {
  const db = await ensureSubscriptionSchema();
  if (!db) return { ok: false as const, error: "wallet not configured" };
  const subscriptionId = input.subscriptionId?.trim() || "";
  const customerId = input.customerId?.trim() || "";
  const userId = normalizeUserId(input.userId ?? "") || "";
  if (!subscriptionId && !customerId && !userId) {
    return { ok: true as const, matched: false as const };
  }
  const rows = asRows<{ user_id?: string }>(
    await db.query(
      `
      UPDATE accounts
      SET
        subscribed = $1,
        paid = CASE WHEN $1 THEN true ELSE paid END,
        stripe_customer_id = COALESCE(NULLIF($3, ''), stripe_customer_id),
        stripe_subscription_id = COALESCE(NULLIF($2, ''), stripe_subscription_id),
        updated_at = now()
      WHERE
        ($2 <> '' AND stripe_subscription_id = $2)
        OR ($3 <> '' AND stripe_customer_id = $3)
        OR ($4 <> '' AND user_id = $4)
      RETURNING user_id
    `,
      [input.subscribed, subscriptionId, customerId, userId],
    ),
  );
  return { ok: true as const, matched: rows.length > 0, userId: rows[0]?.user_id ?? null };
}

async function syncStripeSubscription(row: SubscriptionRow): Promise<boolean> {
  const { stripeClient } = await import("@/lib/wallet/stripe");
  const stripe = stripeClient();
  if (!stripe) return Boolean(row.subscribed || row.paid);

  const customerIds = new Set<string>();
  if (row.stripe_customer_id?.trim()) customerIds.add(row.stripe_customer_id.trim());
  const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
  if (email) {
    try {
      const customers = await stripe.customers.list({ email, limit: 5 });
      for (const customer of customers.data) {
        if (customer.id) customerIds.add(customer.id);
      }
    } catch {
      // Fall back to the stored flag if Stripe is unreachable.
    }
  }

  for (const customerId of customerIds) {
    try {
      const subscriptions = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
      const active = subscriptions.data.find((item) => isActiveStripeStatus(item.status));
      if (active) {
        if (row.user_id) {
          await markAccountSubscribed({
            userId: row.user_id,
            customerId,
            subscriptionId: active.id,
            subscribed: true,
          });
        }
        return true;
      }
    } catch {
      // Keep checking other customers.
    }
  }

  if (row.subscribed && customerIds.size) {
    if (row.user_id) {
      await markAccountSubscribed({
        userId: row.user_id,
        customerId: row.stripe_customer_id,
        subscriptionId: row.stripe_subscription_id,
        subscribed: false,
      });
    }
    return false;
  }

  return Boolean(row.subscribed || row.paid);
}

/** True when the account has an active monthly subscription. */
export async function readAccountSubscribed(userId: string): Promise<boolean> {
  try {
    const row = await readSubscriptionRow(userId);
    if (!row) return false;
    if (row.subscribed || row.paid) {
      if (!row.stripe_customer_id && !row.email) return true;
    }
    return await syncStripeSubscription(row);
  } catch {
    return false;
  }
}

/** DB flag only — no Stripe round trip. Used by the site header. */
export async function readStoredSubscribed(userId: string): Promise<boolean> {
  try {
    const row = await readSubscriptionRow(userId);
    return Boolean(row?.subscribed || row?.paid);
  } catch {
    return false;
  }
}

export async function readAccountSubscriptionIds(userId: string) {
  const row = await readSubscriptionRow(userId);
  return {
    email: typeof row?.email === "string" ? row.email.trim() : "",
    customerId: row?.stripe_customer_id?.trim() || "",
    subscriptionId: row?.stripe_subscription_id?.trim() || "",
    subscribed: Boolean(row?.subscribed || row?.paid),
  };
}
