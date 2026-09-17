import { requireAuthSessionUserId } from "@/lib/auth/session";
import { createSubscriptionCheckout } from "@/lib/wallet/stripe";

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const userId = await requireAuthSessionUserId(request);
    if (!userId) {
      console.warn("[subscribe-checkout] 401 — no session");
      return Response.json({ error: "Sign in first." }, { status: 401 });
    }

    const created = await createSubscriptionCheckout({ userId });
    if (!created.ok) {
      console.error("[subscribe-checkout] session create failed", created.error, created.status);
      return Response.json({ error: created.error }, { status: created.status });
    }
    return Response.json({ ok: true, url: created.url, sessionId: created.sessionId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Checkout.";
    console.error("[subscribe-checkout] route threw", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
