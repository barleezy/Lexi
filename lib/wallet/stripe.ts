import Stripe from "stripe";
import {
  BUY_CANCEL_URL,
  BUY_SUCCESS_URL,
  isStripeConfigured,
  stripePriceIdForPack,
  stripeSubscriptionPriceId,
  SUBSCRIBE_CANCEL_URL,
  SUBSCRIBE_SUCCESS_URL,
  SUBSCRIPTION_PLAN,
  voicePackById,
  voicePackByPriceId,
  type VoicePackId,
} from "./packs";
import {
  markAccountSubscribed,
  setSubscriptionByStripeId,
} from "./subscription";
import { creditVoiceSeconds } from "./voice";

export function stripeClient(env: NodeJS.ProcessEnv = process.env) {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-02-24.acacia" });
}

/** Diagnose STRIPE_PRICE_SUBSCRIPTION without dumping the full price id. */
function describeStripePriceSubscription(raw: string | undefined) {
  if (raw === undefined) return { set: false as const, status: "missing" as const };
  if (raw.length === 0 || raw.trim().length === 0) {
    return { set: false as const, status: "empty" as const, length: raw.length };
  }
  const value = raw.trim();
  const prefix = value.startsWith("price_") ? "price_" : "";
  const tail = value.slice(-4);
  const starCount = Math.max(0, value.length - prefix.length - tail.length);
  const masked = `${prefix}${"*".repeat(starCount)}${tail}`;
  return { set: true as const, prefix: prefix || "(none)", length: value.length, tail, masked };
}

function logStripePriceSubscription() {
  console.info("[stripe] STRIPE_PRICE_SUBSCRIPTION", describeStripePriceSubscription(process.env.STRIPE_PRICE_SUBSCRIPTION));
}

async function createCheckoutForPack(input: {
  userId: string;
  pack: (typeof import("./packs").VOICE_PACKS)[number];
  priceId: string;
  env: NodeJS.ProcessEnv;
}) {
  const stripe = stripeClient(input.env);
  if (!stripe) return { ok: false as const, status: 503, error: "Billing is not configured." };

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
}

/** /api/checkout/subscribe — recurring monthly Checkout. Returns stay on /subscribe. */
export async function createSubscriptionCheckout(input: {
  userId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  if (!isStripeConfigured(env)) {
    console.error("[subscribe-checkout] billing is not configured");
    return { ok: false as const, status: 503, error: "Billing is not configured." };
  }
  const priceId = stripeSubscriptionPriceId(env);
  if (!priceId) {
    logStripePriceSubscription();
    console.error("[subscribe-checkout] STRIPE_PRICE_SUBSCRIPTION is missing");
    return { ok: false as const, status: 503, error: "That plan is not for sale yet." };
  }
  const stripe = stripeClient(env);
  if (!stripe) {
    console.error("[subscribe-checkout] Stripe client is not configured");
    return { ok: false as const, status: 503, error: "Billing is not configured." };
  }

  try {
    logStripePriceSubscription();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: SUBSCRIBE_SUCCESS_URL,
      cancel_url: SUBSCRIBE_CANCEL_URL,
      client_reference_id: input.userId,
      metadata: {
        user_id: input.userId,
        plan: SUBSCRIPTION_PLAN.id,
      },
      subscription_data: {
        metadata: {
          user_id: input.userId,
          plan: SUBSCRIPTION_PLAN.id,
        },
      },
    });
    if (!session.url) {
      console.error("[subscribe-checkout] Stripe session had no URL", session.id);
      return { ok: false as const, status: 502, error: "Could not start Checkout." };
    }
    return { ok: true as const, url: session.url, sessionId: session.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Checkout.";
    console.error("[subscribe-checkout] Stripe session create failed", error);
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

  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as Stripe.Subscription;
    const userId =
      (typeof subscription.metadata?.user_id === "string" && subscription.metadata.user_id.trim()) ||
      (typeof subscription.metadata?.userId === "string" && subscription.metadata.userId.trim()) ||
      "";
    const updated = await setSubscriptionByStripeId({
      subscriptionId: subscription.id,
      customerId: typeof subscription.customer === "string" ? subscription.customer : "",
      userId,
      subscribed: false,
    });
    if (!updated.ok) {
      return { ok: false as const, status: 500, error: updated.error };
    }
    return { ...updated, subscribed: false };
  }

  if (event.type === "customer.subscription.updated") {
    const subscription = event.data.object as Stripe.Subscription;
    const userId =
      (typeof subscription.metadata?.user_id === "string" && subscription.metadata.user_id.trim()) ||
      (typeof subscription.metadata?.userId === "string" && subscription.metadata.userId.trim()) ||
      "";
    const subscribed = subscription.status === "active" || subscription.status === "trialing";
    const updated = await setSubscriptionByStripeId({
      subscriptionId: subscription.id,
      customerId: typeof subscription.customer === "string" ? subscription.customer : "",
      userId,
      subscribed,
    });
    if (!updated.ok) {
      return { ok: false as const, status: 500, error: updated.error };
    }
    return { ...updated, subscribed };
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
  const subscriptionCheckout =
    session.mode === "subscription" || session.metadata?.plan === SUBSCRIPTION_PLAN.id;
  if (subscriptionCheckout) {
    if (!userId) {
      return {
        ok: true as const,
        ignored: true as const,
        reason: "missing_checkout_metadata",
      };
    }
    const marked = await markAccountSubscribed({
      userId,
      customerId: typeof session.customer === "string" ? session.customer : "",
      subscriptionId: typeof session.subscription === "string" ? session.subscription : "",
      subscribed: true,
    });
    if (!marked.ok) {
      return { ok: false as const, status: 500, error: marked.error };
    }
    return { ok: true as const, subscribed: true, userId: marked.userId };
  }

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
