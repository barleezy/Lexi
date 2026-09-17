import { connection } from "next/server";
import { handleStripeWebhook, stripeClient } from "@/lib/wallet/stripe";
import { handleXaiStripeWebhook, XAI_STRIPE_WEBHOOK_URL } from "@/lib/wallet/xai-topup";
import { stripeWebhookSecret } from "@/lib/xai/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe → voice minutes + xAI prepaid credit top-up.
 *
 * Same handlers as /api/billing/webhook so pack minutes credit whichever URL Stripe hits.
 *
 * Setup:
 *  1. Stripe Dashboard → Developers → Webhooks → Add endpoint
 *  2. URL: https://www.talktolexi.app/api/webhooks/stripe
 *     Do not use the apex host (talktolexi.app → 307 to www; Stripe refuses redirects).
 *     Do not use a trailing slash (Next 308s to the non-slash URL).
 *  3. Events: checkout.session.completed
 *  4. Copy the signing secret: Stripe endpoint → Signing secret → Reveal (whsec_…).
 *     Vercel → Project → Settings → Environment Variables → STRIPE_WEBHOOK_SECRET.
 *     Also set XAI_MANAGEMENT_API_KEY and XAI_TEAM_ID.
 *
 * Top-up: POST https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/top-up
 * Header: Authorization: Bearer <XAI_MANAGEMENT_API_KEY>  (not XAI_API_KEY)
 * Body: { "amount": { "val": "<cents>" } }  — Stripe session.amount_total as a string.
 */
export async function POST(req: Request) {
  await connection();
  const signature = req.headers.get("stripe-signature") ?? "";
  const body = await req.text();
  const stripe = stripeClient();
  const webhookSecret = stripeWebhookSecret();
  if (!stripe || !webhookSecret) {
    return Response.json({ error: "Billing is not configured." }, { status: 503 });
  }
  try {
    stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error("[stripe-xai-webhook] invalid signature", error);
    return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }
  try {
    const minutes = await handleStripeWebhook({ rawBody: body, signature });
    if (!minutes.ok) {
      return Response.json({ error: minutes.error }, { status: minutes.status });
    }
    const result = await handleXaiStripeWebhook({ rawBody: body, signature });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ received: true, ...result, minutes });
  } catch (error) {
    console.error("[stripe-xai-webhook] processing error", error);
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}

/** Probe / misconfig hint — Stripe only POSTs; this is for humans and uptime checks. */
export async function GET() {
  return Response.json({
    ok: true,
    webhook: XAI_STRIPE_WEBHOOK_URL,
    note: "Credits voice minutes and xAI prepaid. Same handlers as /api/billing/webhook.",
  });
}
