import { handleStripeWebhook } from "@/lib/wallet/stripe";

export const runtime = "nodejs";

/** Stripe webhook is the ONLY writer that increments voice_seconds. */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature") ?? "";
  const rawBody = await request.text();
  const result = await handleStripeWebhook({ rawBody, signature });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ received: true, ...result });
}
