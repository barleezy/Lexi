import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  if (!session) {
    redirect("/?next=/buy");
  }

  const packs = buyPagePacks();
  const stripeReady = isStripeConfigured();

  return (
    <main className="flex min-h-dvh flex-1 flex-col font-sans text-zinc-100">
      {!stripeReady ? (
        <p className="relative z-20 mx-auto max-w-3xl px-6 pt-6 text-center text-sm text-zinc-400">
          Billing is not configured yet.
        </p>
      ) : null}
      <BuyClient packs={packs} />
    </main>
  );
}
