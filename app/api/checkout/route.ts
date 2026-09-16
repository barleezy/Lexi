import { requireAuthSessionUserId } from "@/lib/auth/session";
import { createCheckoutByPriceId } from "@/lib/wallet/stripe";

export const maxDuration = 30;

export async function POST(request: Request) {
  let body: { priceId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const userId = await requireAuthSessionUserId(request);
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  const priceId = typeof body.priceId === "string" ? body.priceId : "";
  const created = await createCheckoutByPriceId({ userId, priceId });
  if (!created.ok) {
    return Response.json({ error: created.error }, { status: created.status });
  }
  return Response.json({ ok: true, url: created.url, sessionId: created.sessionId });
}
