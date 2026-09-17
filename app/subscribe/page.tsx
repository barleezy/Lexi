import { connection } from "next/server";
import { readIncomingAuthSession } from "@/lib/auth/session";
import { isSubscriptionConfigured, SUBSCRIPTION_PLAN } from "@/lib/wallet/packs";
import { SubscribeClient } from "./subscribe-client";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Subscribe · Talk To Lexi",
  description: "Monthly Lexi — a recurring companion plan.",
};

export default async function SubscribePage() {
  await connection();
  const session = await readIncomingAuthSession();

  return (
    <main className="flex min-h-0 flex-1 flex-col font-sans text-zinc-100">
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
