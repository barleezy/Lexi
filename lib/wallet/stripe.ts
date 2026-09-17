import Stripe from "stripe";
import { stripeSecretKey, stripeWebhookSecret } from "@/lib/xai/env";
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
  readAccountSubscriptionIds,
  setSubscriptionByStripeId,
} from "./subscription";
import { creditSubscriptionCheckoutMinutes, creditVoiceSeconds } from "./voice";

export function stripeClient(env: NodeJS.ProcessEnv = process.env) {
  const key = stripeSecretKey(env);
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
      price_id: input.priceId,
    },
  });
  if (!session.url) return { ok: false as const, status: 502, error: "Could not start Checkout." };
  return { ok: true as const, url: session.url, sessionId: session.id };
}

function isActiveStripeStatus(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

/** Cancel at period end so the current month stays usable. */
export async function cancelAccountSubscriptionAtPeriodEnd(input: {
  userId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const stripe = stripeClient(env);
  if (!stripe) return { ok: false as const, status: 503, error: "Billing is not configured." };

  const ids = await readAccountSubscriptionIds(input.userId);
  const customerIds = new Set<string>();
  if (ids.customerId) customerIds.add(ids.customerId);
  if (ids.email) {
    try {
      const customers = await stripe.customers.list({ email: ids.email, limit: 5 });
      for (const customer of customers.data) {
        if (customer.id) customerIds.add(customer.id);
      }
    } catch {
      // Fall through to the stored subscription id.
    }
  }

  let subscription: Stripe.Subscription | null = null;
  if (ids.subscriptionId) {
    try {
      const stored = await stripe.subscriptions.retrieve(ids.subscriptionId);
      if (isActiveStripeStatus(stored.status) || stored.cancel_at_period_end) {
        subscription = stored;
      }
    } catch {
      subscription = null;
    }
  }

  if (!subscription) {
    for (const customerId of customerIds) {
      try {
        const subscriptions = await stripe.subscriptions.list({ customer: customerId, limit: 10 });
        const match =
          subscriptions.data.find((item) => isActiveStripeStatus(item.status)) ||
          subscriptions.data.find((item) => item.cancel_at_period_end);
        if (match) {
          subscription = match;
          break;
        }
      } catch {
        // Keep checking other customers.
      }
    }
  }

  if (!subscription) {
    return { ok: false as const, status: 404, error: "No active subscription to cancel." };
  }

  try {
    const updated = subscription.cancel_at_period_end
      ? subscription
      : await stripe.subscriptions.update(subscription.id, { cancel_at_period_end: true });

    await markAccountSubscribed({
      userId: input.userId,
      customerId: typeof updated.customer === "string" ? updated.customer : ids.customerId,
      subscriptionId: updated.id,
      subscribed: isActiveStripeStatus(updated.status),
    });

    return {
      ok: true as const,
      cancelAtPeriodEnd: updated.cancel_at_period_end === true,
      currentPeriodEnd: updated.current_period_end ?? null,
      alreadyScheduled: subscription.cancel_at_period_end === true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel subscription.";
    console.error("[subscription-cancel] Stripe update failed", error);
    return { ok: false as const, status: 502, error: message };
  }
}

export async function readAccountSubscriptionCancelState(input: {
  userId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const stripe = stripeClient(env);
  const ids = await readAccountSubscriptionIds(input.userId);
  if (!stripe) {
    return {
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null as number | null,
      subscriptionId: ids.subscriptionId,
    };
  }

  try {
    if (ids.subscriptionId) {
      const stored = await stripe.subscriptions.retrieve(ids.subscriptionId);
      return {
        cancelAtPeriodEnd: stored.cancel_at_period_end === true,
        currentPeriodEnd: stored.current_period_end ?? null,
        subscriptionId: stored.id,
      };
    }
    if (ids.customerId) {
      const subscriptions = await stripe.subscriptions.list({ customer: ids.customerId, limit: 10 });
      const match =
        subscriptions.data.find((item) => isActiveStripeStatus(item.status)) ||
        subscriptions.data.find((item) => item.cancel_at_period_end);
      if (match) {
        return {
          cancelAtPeriodEnd: match.cancel_at_period_end === true,
          currentPeriodEnd: match.current_period_end ?? null,
          subscriptionId: match.id,
        };
      }
    }
  } catch {
    // Surface the stored flag without Stripe details.
  }

  return {
    cancelAtPeriodEnd: false,
    currentPeriodEnd: null as number | null,
    subscriptionId: ids.subscriptionId,
  };
}

/** Alias for /api/billing/cancel — same period-end cancel. */
export async function cancelAccountSubscription(input: {
  userId: string;
  env?: NodeJS.ProcessEnv;
}) {
  const canceled = await cancelAccountSubscriptionAtPeriodEnd(input);
  if (!canceled.ok) return canceled;
  return {
    ok: true as const,
    cancelAtPeriodEnd: canceled.cancelAtPeriodEnd,
    alreadyCanceling: canceled.alreadyScheduled,
    currentPeriodEnd: canceled.currentPeriodEnd,
  };
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
  const secret = stripeWebhookSecret(env);
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
  return creditCompletedCheckoutSession({
    session,
    stripe,
    env,
    stripeEventId: event.id,
  });
}

/** Pull paid Checkout sessions for this user so the page can show minutes if the webhook only topped up xAI. */
export async function creditPaidCheckoutsForUser(
  userId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const stripe = stripeClient(env);
  const id = userId.trim();
  if (!stripe || !id) return { ok: true as const, creditedSeconds: 0 };
  const sessions = await listCompletedCheckoutsForUser(stripe, id);
  let creditedSeconds = 0;
  for (const session of sessions) {
    try {
      const result = await creditCompletedCheckoutSession({
        session,
        stripe,
        env,
        stripeEventId: `cs:${session.id}`,
      });
      if (result.ok && "credited" in result && typeof result.credited === "number") {
        creditedSeconds += result.credited;
      }
    } catch (error) {
      console.error("[stripe-minutes] reconcile session failed", session.id, error);
    }
  }
  return { ok: true as const, creditedSeconds };
}

async function creditCompletedCheckoutSession(input: {
  session: Stripe.Checkout.Session;
  stripe: Stripe;
  env: NodeJS.ProcessEnv;
  stripeEventId: string;
}) {
  const { session, stripe, env } = input;
  const userId = checkoutUserId(session);
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
    const credited = await creditSubscriptionCheckoutMinutes({
      userId,
      stripeEventId: input.stripeEventId,
      stripeSessionId: session.id,
    });
    if (!credited.ok) {
      return { ok: false as const, status: 500, error: credited.error };
    }
    return {
      ok: true as const,
      subscribed: true,
      userId: marked.userId,
      credited: credited.credited,
      voiceSeconds: credited.voiceSeconds,
    };
  }

  const pack = await resolveVoicePackFromCheckout(session, stripe, env);
  const seconds = pack?.seconds ?? 0;
  if (!userId || !pack || seconds <= 0) {
    console.warn("[stripe-minutes] ignored checkout.session.completed", {
      eventId: input.stripeEventId,
      sessionId: session.id,
      userId: userId || null,
      pack: pack?.id ?? null,
      mode: session.mode,
    });
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
    stripeEventId: input.stripeEventId,
    stripeSessionId: session.id,
  });
  if (!credited.ok) {
    console.error("[stripe-minutes] credit failed", credited.error, {
      eventId: input.stripeEventId,
      userId,
      pack: pack.id,
      seconds,
    });
    return { ok: false as const, status: 500, error: credited.error };
  }
  if (credited.credited > 0) {
    console.info("[stripe-minutes] credited", {
      eventId: input.stripeEventId,
      userId,
      pack: pack.id,
      seconds,
      credited: credited.credited,
      voiceSeconds: credited.voiceSeconds,
    });
  }
  return {
    ok: true as const,
    credited: credited.credited,
    voiceSeconds: credited.voiceSeconds,
    userId,
    pack: pack.id,
  };
}

function checkoutUserId(session: Stripe.Checkout.Session) {
  return (
    (typeof session.metadata?.user_id === "string" && session.metadata.user_id.trim()) ||
    (typeof session.metadata?.userId === "string" && session.metadata.userId.trim()) ||
    (typeof session.client_reference_id === "string" && session.client_reference_id.trim()) ||
    ""
  );
}

async function resolveVoicePackFromCheckout(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
  env: NodeJS.ProcessEnv,
) {
  const fromMeta = voicePackById(session.metadata?.pack ?? session.metadata?.packId);
  if (fromMeta) return fromMeta;
  const fromPriceMeta = voicePackByPriceId(
    session.metadata?.price_id ?? session.metadata?.priceId,
    env,
  );
  if (fromPriceMeta) return fromPriceMeta;
  try {
    const full = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["line_items.data.price"],
    });
    const priceId = full.line_items?.data?.[0]?.price?.id;
    return voicePackByPriceId(priceId, env);
  } catch (error) {
    console.error("[stripe-minutes] could not resolve pack from line items", error);
    return null;
  }
}

function checkoutBelongsToUser(session: Stripe.Checkout.Session, userId: string) {
  const owner = checkoutUserId(session);
  return Boolean(owner) && owner.toLowerCase() === userId.toLowerCase();
}

async function listCompletedCheckoutsForUser(stripe: Stripe, userId: string) {
  const listed = await stripe.checkout.sessions.list({
    limit: 40,
    status: "complete",
    created: { gte: Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 14 },
  });
  return listed.data.filter((session) => checkoutBelongsToUser(session, userId));
}
