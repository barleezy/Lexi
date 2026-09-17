import { logVoiceEnv } from "@/lib/xai/env";

export function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    return;
  }

  const names = Object.keys(process.env)
    .filter((k) => /STRIPE|PRICE|XAI_/i.test(k))
    .sort();
  console.info("[env] STRIPE|PRICE|XAI names", names);
  logVoiceEnv("boot");
}
