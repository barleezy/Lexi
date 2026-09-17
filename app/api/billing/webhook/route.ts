import { connection } from "next/server";
import { handleStripeWebhook } from "@/lib/wallet/stripe";
import { handleXaiStripeWebhook } from "@/lib/wallet/xai-topup";
import { STRIPE_WEBHOOK_URL } from "@/lib/wallet/packs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook — credits voice_seconds and xAI prepaid (idempotent).
 *
 * Dashboard endpoint must be exactly:
 *   https://www.talktolexi.app/api/billing/webhook
 * /api/webhooks/stripe runs the same handlers so either URL credits minutes.
 * Do not use the apex host (talktolexi.app → 307 to www; Stripe refuses redirects).
 * Do not use a trailing slash (Next 308s to the non-slash URL).
 */
export async function POST(request: Request) {
  await connection();
  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();
  const minutes = await handleStripeWebhook({ rawBody, signature });
  if (!minutes.ok) {
    return Response.json({ error: minutes.error }, { status: minutes.status });
  }
  const xai = await handleXaiStripeWebhook({ rawBody, signature });
  if (!xai.ok) {
    return Response.json({ error: xai.error }, { status: xai.status });
  }
  return Response.json({ received: true, ...minutes, xai });
}

/** Probe / misconfig hint — Stripe only POSTs; this is for humans and uptime checks. */
export async function GET() {
  return Response.json({
    ok: true,
    webhook: STRIPE_WEBHOOK_URL,
    note: "Credits voice minutes and xAI prepaid. Same handlers as /api/webhooks/stripe. Stripe must POST to this www URL with no trailing slash.",
  });
}
