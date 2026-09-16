import { readIncomingAuthSession } from "@/lib/auth/session";
import { isSubscriptionConfigured, SUBSCRIPTION_PLAN } from "@/lib/wallet/packs";
import { SubscribeClient } from "./subscribe-client";

export const metadata = {
  title: "Subscribe · Talk To Lexi",
  description: "Monthly Lexi — a recurring companion plan.",
};

export default async function SubscribePage() {
  const session = await readIncomingAuthSession();

  return (
    <main className="flex min-h-dvh flex-1 flex-col font-sans text-zinc-100">
      <SubscribeClient
        signedIn={Boolean(session)}
        planReady={isSubscriptionConfigured()}
        label={SUBSCRIPTION_PLAN.label}
        priceLabel={SUBSCRIPTION_PLAN.priceLabel}
        cadence={SUBSCRIPTION_PLAN.cadence}
      />
    </main>
  );
}
