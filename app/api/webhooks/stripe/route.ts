import { handleXaiStripeWebhook, XAI_STRIPE_WEBHOOK_URL } from "@/lib/wallet/xai-topup";

export const runtime = "nodejs";

/**
 * Stripe → xAI prepaid credit top-up.
 *
 * Separate from the voice-minutes webhook at /api/billing/webhook.
 *
 * Setup:
 *  1. Stripe Dashboard → Developers → Webhooks → Add endpoint
 *  2. URL: https://talktolexi.app/api/webhooks/stripe
 *     If apex 307s to www, use https://www.talktolexi.app/api/webhooks/stripe
 *     (Stripe will not follow redirects; no trailing slash).
 *  3. Events: checkout.session.completed
 *  4. Copy the signing secret: Stripe endpoint → Signing secret → Reveal (whsec_…).
 *     Vercel → Project → Settings → Environment Variables →
 *     STRIPE_XAI_WEBHOOK_SECRET (preferred; keeps voice-minutes STRIPE_WEBHOOK_SECRET intact)
 *     or STRIPE_WEBHOOK_SECRET. Also set XAI_MANAGEMENT_API_KEY and XAI_TEAM_ID.
 *
 * Top-up: POST https://management-api.x.ai/v1/billing/teams/{team_id}/prepaid/top-up
 * Header: Authorization: Bearer <XAI_MANAGEMENT_API_KEY>  (not XAI_API_KEY)
 * Body: { "amount": { "val": "<cents>" } }  — Stripe session.amount_total as a string.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();
  try {
    const result = await handleXaiStripeWebhook({ rawBody, signature });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ received: true, ...result });
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
    note: "xAI prepaid top-up. Voice minutes stay on /api/billing/webhook.",
  });
}
