import { readIncomingAuthSession } from "@/lib/auth/session";
import { buyPagePacks, isStripeConfigured } from "@/lib/wallet/packs";
import { BuyClient } from "./buy-client";

export const metadata = {
  title: "Buy minutes · Talk To Lexi",
  description: "Whisper, Murmur, or Echo — voice minutes for Lexi.",
};

export default async function BuyPage() {
  const session = await readIncomingAuthSession();
  const packs = buyPagePacks();
  const stripeReady = isStripeConfigured();

  return (
    <main className="flex min-h-0 flex-1 flex-col font-sans text-zinc-100">
      <BuyClient packs={packs} signedIn={Boolean(session)} stripeReady={stripeReady} />
    </main>
  );
}
