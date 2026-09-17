import { connection } from "next/server";
import { VoiceHome } from "@/components/voice-home";
import { buyPagePacks, isStripeConfigured } from "@/lib/wallet/packs";

export const dynamic = "force-dynamic";

export default async function Home() {
  await connection();
  return <VoiceHome catalogPacks={buyPagePacks()} billingReady={isStripeConfigured()} />;
}
