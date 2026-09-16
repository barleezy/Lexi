import Stripe from "stripe";
import {
  BUY_CANCEL_URL,
  BUY_SUCCESS_URL,
  isStripeConfigured,
  stripePriceIdForPack,
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
