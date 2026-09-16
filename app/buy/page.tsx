import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LEXI_SESSION_COOKIE, verifyAuthSession } from "@/lib/auth/session";
import { buyPagePacks } from "@/lib/wallet/packs";
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

  return <BuyClient packs={buyPagePacks()} />;
}
