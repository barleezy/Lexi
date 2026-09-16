import { cookies } from "next/headers";
import { LEXI_SESSION_COOKIE, verifyAuthSession } from "@/lib/auth/session";
import { buyPagePacks, isStripeConfigured } from "@/lib/wallet/packs";
import { BuyClient } from "./buy-client";

export const metadata = {
  title: "Buy minutes · Talk To Lexi",
  description: "Whisper, Murmur, or Echo — voice minutes for Lexi.",
};

export default async function BuyPage() {
  const jar = await cookies();
  const token = jar.get(LEXI_SESSION_COOKIE)?.value ?? "";
  const session = token ? verifyAuthSession(token) : null;
  const packs = buyPagePacks();
  const stripeReady = isStripeConfigured();

  return (
    <main className="flex min-h-dvh flex-1 flex-col font-sans text-zinc-100">
      <BuyClient packs={packs} signedIn={Boolean(session)} stripeReady={stripeReady} />
    </main>
  );
}
