import { requireAuthSessionUserId } from "@/lib/auth/session";
import { createVoiceCheckoutSession } from "@/lib/wallet/stripe";

export const maxDuration = 30;

export async function POST(request: Request) {
  let body: { packId?: unknown; userId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    body = {};
  }

  const userId = await requireAuthSessionUserId(
    request,
    typeof body.userId === "string" ? body.userId : null,
  );
  if (!userId) {
    return Response.json({ error: "Sign in first." }, { status: 401 });
  }

  const packId = typeof body.packId === "string" ? body.packId : "";
  const created = await createVoiceCheckoutSession({ request, userId, packId });
  if (!created.ok) {
    return Response.json({ error: created.error }, { status: created.status });
  }
  return Response.json({ ok: true, url: created.url, sessionId: created.sessionId });
}
