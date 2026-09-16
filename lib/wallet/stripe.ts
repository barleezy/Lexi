import Stripe from "stripe";
import { publicAppUrl } from "../auth/login";
import {
  isStripeConfigured,
  stripePriceIdForPack,
  voicePackById,
  type VoicePackId,
} from "./packs";
import { creditVoiceSeconds } from "./voice";

export function stripeClient(env: NodeJS.ProcessEnv = process.env) {
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2025-02-24.acacia" });
}

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

  const stripe = stripeClient(env);
  if (!stripe) return { ok: false as const, status: 503, error: "Billing is not configured." };

  const origin = publicAppUrl(input.request);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/?billing=success`,
    cancel_url: `${origin}/?billing=cancel`,
    client_reference_id: input.userId,
    metadata: {
      userId: input.userId,
      packId: pack.id,
      seconds: String(pack.seconds),
    },
  });
  if (!session.url) return { ok: false as const, status: 502, error: "Could not start Checkout." };
  return { ok: true as const, url: session.url, sessionId: session.id };
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
    (typeof session.metadata?.userId === "string" && session.metadata.userId) ||
    (typeof session.client_reference_id === "string" && session.client_reference_id) ||
    "";
  const seconds = Number(session.metadata?.seconds);
  if (!userId || !Number.isFinite(seconds) || seconds <= 0) {
    return { ok: false as const, status: 400, error: "Checkout metadata missing user/seconds." };
  }

  const credited = await creditVoiceSeconds({
    userId,
    seconds: Math.floor(seconds),
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
