import { requireAuthSessionUserId } from "@/lib/auth/session";
import { cancelAccountSubscriptionAtPeriodEnd } from "@/lib/wallet/stripe";

export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const userId = await requireAuthSessionUserId(request);
    if (!userId) {
      return Response.json({ error: "Sign in first." }, { status: 401 });
    }

    const canceled = await cancelAccountSubscriptionAtPeriodEnd({ userId });
    if (!canceled.ok) {
      return Response.json({ error: canceled.error }, { status: canceled.status });
    }
    return Response.json({
      ok: true,
      cancelAtPeriodEnd: canceled.cancelAtPeriodEnd,
      currentPeriodEnd: canceled.currentPeriodEnd,
      alreadyScheduled: canceled.alreadyScheduled,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not cancel subscription.";
    console.error("[billing-cancel] route threw", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
