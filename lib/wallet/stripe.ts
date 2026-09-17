import Stripe from "stripe";
import {
  BUY_CANCEL_URL,
  BUY_SUCCESS_URL,
  isStripeConfigured,
  stripePriceIdForPack,
  stripeSubscriptionPriceId,
  SUBSCRIBE_CANCEL_URL,
  SUBSCRIPTION_PLAN,
  voicePackById,
  voicePackByPriceId,
  type VoicePackId,
} from "./packs";
import { creditVoiceSeconds } from "./voice";

export function stripeClient(env: NodeJS.ProcessEnv = process.env) {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-02-24.acacia" });
}

function stripeErrorMessage(error: unknown) {
  if (error && typeof error === "object") {
    const maybe = error as {
      message?: unknown;
      type?: unknown;
      code?: unknown;
      raw?: { message?: unknown };
    };
    const rawMessage = typeof maybe.raw?.message === "string" ? maybe.raw.message.trim() : "";
    const message = typeof maybe.message === "string" ? maybe.message.trim() : "";
    const detail = rawMessage || message;
    if (detail) {
      const code = typeof maybe.code === "string" && maybe.code ? ` [${maybe.code}]` : "";
      const type = typeof maybe.type === "string" && maybe.type ? ` (${maybe.type})` : "";
      return `${detail}${code}${type}`;
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return "Stripe Checkout failed.";
}

function assertAbsoluteCheckoutUrls(successUrl: string, cancelUrl: string) {
  for (const url of [successUrl, cancelUrl]) {
    if (!/^https:\/\/www\.talktolexi\.app\//.test(url)) {
      throw new Error(`Checkout return URL must be an absolute www production URL: ${url}`);
    }
  }
}

async function createCheckoutForPack(input: {
  userId: string;
  pack: (typeof import("./packs").VOICE_PACKS)[number];
  priceId: string;
  env: NodeJS.ProcessEnv;
}) {
  const stripe = stripeClient(input.env);
  if (!stripe) return { ok: false as const, status: 503, error: "Billing is not configured." };

  try {
    assertAbsoluteCheckoutUrls(BUY_SUCCESS_URL, BUY_CANCEL_URL);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: BUY_SUCCESS_URL,
      cancel_url: BUY_CANCEL_URL,
      client_reference_id: input.userId,
      metadata: {
        user_id: input.userId,
        pack: input.pack.id,
      },
    });
    if (!session.url) return { ok: false as const, status: 502, error: "Could not start Checkout." };
    return { ok: true as const, url: session.url, sessionId: session.id };
  } catch (error) {
    const message = stripeErrorMessage(error);
    console.error("[stripe] pack checkout.sessions.create failed:", message);
    return { ok: false as const, status: 502, error: message };
  }
}

/**
 * Ensure STRIPE_PRICE_SUBSCRIPTION is a recurring Price (month/year).
 * One-time pack prices fail Checkout when mode=subscription.
 */
export async function assertRecurringSubscriptionPrice(
  stripe: Stripe,
  priceId: string,
): Promise<{ ok: true; price: Stripe.Price } | { ok: false; status: number; error: string }> {
  let price: Stripe.Price;
  try {
    price = await stripe.prices.retrieve(priceId);
  } catch (error) {
    const message = stripeErrorMessage(error);
    console.error("[stripe] prices.retrieve failed for subscription price:", priceId, message);
    return {
      ok: false,
      status: 502,
      error: `Could not load STRIPE_PRICE_SUBSCRIPTION (${priceId}): ${message}`,
    };
  }

  if (price.type !== "recurring") {
    const error =
      `STRIPE_PRICE_SUBSCRIPTION (${priceId}) is type=${price.type}, not recurring. ` +
      `In Stripe Dashboard → Products → Add price → Recurring (monthly), copy the new price_… id into Vercel.`;
    console.error("[stripe] subscription price is not recurring:", error);
    return { ok: false, status: 503, error };
  }

  const interval = price.recurring?.interval;
  if (interval !== "month" && interval !== "year") {
    const error =
      `STRIPE_PRICE_SUBSCRIPTION (${priceId}) recurring.interval=${interval ?? "missing"}; ` +
      `expected month or year.`;
    console.error("[stripe] subscription price interval unsupported:", error);
    return { ok: false, status: 503, error };
  }

  return { ok: true, price };
}

/** /api/checkout/subscribe — recurring Checkout (mode=subscription). Absolute www return URLs. */
export async function createSubscriptionCheckout(input: {
  userId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  if (!isStripeConfigured(env)) {
    return { ok: false as const, status: 503, error: "Billing is not configured." };
  }
  const priceId = stripeSubscriptionPriceId(env);
  if (!priceId) {
    return {
      ok: false as const,
      status: 503,
      error:
        "STRIPE_PRICE_SUBSCRIPTION is not set. Create a Recurring monthly price in Stripe and set the price_… id in Vercel.",
    };
  }
  const stripe = stripeClient(env);
  if (!stripe) return { ok: false as const, status: 503, error: "Billing is not configured." };

  const checked = await assertRecurringSubscriptionPrice(stripe, priceId);
  if (!checked.ok) return checked;

  try {
    assertAbsoluteCheckoutUrls(BUY_SUCCESS_URL, SUBSCRIBE_CANCEL_URL);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: BUY_SUCCESS_URL,
      cancel_url: SUBSCRIBE_CANCEL_URL,
      client_reference_id: input.userId,
      metadata: {
        user_id: input.userId,
        plan: SUBSCRIPTION_PLAN.id,
      },
    });
    if (!session.url) return { ok: false as const, status: 502, error: "Could not start Checkout." };
    return { ok: true as const, url: session.url, sessionId: session.id };
  } catch (error) {
    const message = stripeErrorMessage(error);
    console.error("[stripe] subscription checkout.sessions.create failed:", {
      priceId,
      mode: "subscription",
      success_url: BUY_SUCCESS_URL,
      cancel_url: SUBSCRIBE_CANCEL_URL,
      error: message,
    });
    return { ok: false as const, status: 502, error: message };
  }
}

/** /api/checkout — client sends { priceId }; pack/seconds resolved server-side. */
export async function createCheckoutByPriceId(input: {
  userId: string;
  priceId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  if (!isStripeConfigured(env)) {
    return { ok: false as const, status: 503, error: "Billing is not configured." };
  }
  const pack = voicePackByPriceId(input.priceId, env);
  if (!pack) return { ok: false as const, status: 400, error: "Unknown price." };
  const priceId = stripePriceIdForPack(pack, env);
  if (!priceId) return { ok: false as const, status: 503, error: "That pack is not for sale yet." };
  return createCheckoutForPack({ userId: input.userId, pack, priceId, env });
}

/** Legacy /api/billing/checkout — client sends { packId }. */
export async function createVoiceCheckoutSession(input: {
  request: Request;
  userId: string;
  packId: VoicePackId | string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  if (!isStripeConfigured(env)) {
    return { ok: false as const, status: 503, error: "Billing is not configured." };
  }
  const pack = voicePackById(input.packId);
  if (!pack) return { ok: false as const, status: 400, error: "Unknown pack." };
  const priceId = stripePriceIdForPack(pack, env);
  if (!priceId) return { ok: false as const, status: 503, error: "That pack is not for sale yet." };
  return createCheckoutForPack({ userId: input.userId, pack, priceId, env });
}

export async function handleStripeWebhook(input: {
  rawBody: string;
  signature: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
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

  if (event.type !== "checkout.session.completed") {
    return { ok: true as const, ignored: true as const };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const userId =
    (typeof session.metadata?.user_id === "string" && session.metadata.user_id.trim()) ||
    (typeof session.metadata?.userId === "string" && session.metadata.userId.trim()) ||
    (typeof session.client_reference_id === "string" && session.client_reference_id.trim()) ||
    "";
  // Seconds always from server pack map — never trust a client-invented amount.
  const pack = voicePackById(session.metadata?.pack ?? session.metadata?.packId);
  const seconds = pack?.seconds ?? 0;
  // Stripe Dashboard / CLI test events often omit our metadata. Ack 200 so Stripe
  // marks delivery success; only real Checkout sessions with user+pack credit.
  if (!userId || seconds <= 0) {
    return {
      ok: true as const,
      ignored: true as const,
      reason: "missing_checkout_metadata",
    };
  }

  const credited = await creditVoiceSeconds({
    userId,
    seconds,
    source: "stripe",
    stripeEventId: event.id,
    stripeSessionId: session.id,
  });
  if (!credited.ok) {
    return { ok: false as const, status: 500, error: credited.error };
  }
  return {
    ok: true as const,
    credited: credited.credited,
    voiceSeconds: credited.voiceSeconds,
    userId,
  };
}
