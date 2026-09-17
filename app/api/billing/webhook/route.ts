import { connection } from "next/server";
import { handleStripeWebhook } from "@/lib/wallet/stripe";
import { STRIPE_WEBHOOK_URL } from "@/lib/wallet/packs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe webhook — ONLY writer that increments voice_seconds.
 *
 * Dashboard endpoint must be exactly:
 *   https://www.talktolexi.app/api/billing/webhook
 * Do not use the apex host (talktolexi.app → 307 to www; Stripe refuses redirects).
 * Do not use a trailing slash (Next 308s to the non-slash URL).
 */
export async function POST(request: Request) {
  await connection();
  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();
  const result = await handleStripeWebhook({ rawBody, signature });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ received: true, ...result });
}

/** Probe / misconfig hint — Stripe only POSTs; this is for humans and uptime checks. */
export async function GET() {
  return Response.json({
    ok: true,
    webhook: STRIPE_WEBHOOK_URL,
    note: "Stripe must POST to this www URL with no trailing slash. Apex talktolexi.app returns 307.",
  });
}
