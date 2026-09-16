import Stripe from "stripe";
import { AccountAuthError, markAccountPaidByEmail } from "@/lib/auth/accounts";
import { stripeClient } from "@/lib/wallet/stripe";

function customerEmailFromSession(session: Stripe.Checkout.Session) {
  const fromDetails = session.customer_details?.email?.trim();
  if (fromDetails) return fromDetails;
  const fromSession = session.customer_email?.trim();
  if (fromSession) return fromSession;
  return "";
}

/**
 * Subscription Payment Link webhook.
 * Verifies Stripe signature, then marks the matching account paid by email.
 */
export async function handleSubscriptionStripeWebhook(input: {
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
  const email = customerEmailFromSession(session);
  if (!email) {
    return {
      ok: true as const,
      ignored: true as const,
      reason: "missing_customer_email",
    };
  }

  try {
    const marked = await markAccountPaidByEmail(email);
    return {
      ok: true as const,
      paid: marked.matched,
      userId: marked.userId,
      email: marked.email,
      eventId: event.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not mark account paid.";
    const status = error instanceof AccountAuthError ? error.status : 500;
    return { ok: false as const, status, error: message };
  }
}
