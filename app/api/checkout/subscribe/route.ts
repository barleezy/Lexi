import { requireAuthSessionUserId } from "@/lib/auth/session";
import { createSubscriptionCheckout } from "@/lib/wallet/stripe";

export const maxDuration = 30;

export async function POST(request: Request) {
  const userId = requireAuthSessionUserId(request);
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  const created = await createSubscriptionCheckout({ userId });
  if (!created.ok) {
    return Response.json({ error: created.error }, { status: created.status });
  }
  return Response.json({ ok: true, url: created.url, sessionId: created.sessionId });
}
