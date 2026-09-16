import { handleSubscriptionStripeWebhook } from "@/lib/wallet/subscription";

export const runtime = "nodejs";

/**
 * Stripe subscription webhook — marks accounts.paid from checkout.session.completed.
 *
 * Dashboard endpoint (prefer www, no trailing slash):
 *   https://www.talktolexi.app/api/webhooks/stripe
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();
  const result = await handleSubscriptionStripeWebhook({ rawBody, signature });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ received: true, ...result });
}

export async function GET() {
  return Response.json({
    ok: true,
    webhook: "/api/webhooks/stripe",
    note: "Stripe must POST checkout.session.completed here with a valid signature.",
  });
}
