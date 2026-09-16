import { VoiceHome } from "@/components/voice-home";
import { buyPagePacks, isStripeConfigured } from "@/lib/wallet/packs";

export default function Home() {
  return <VoiceHome catalogPacks={buyPagePacks()} billingReady={isStripeConfigured()} />;
}
