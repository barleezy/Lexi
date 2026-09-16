/** Canonical production origin. Apex talktolexi.app 307s to www — Stripe will not follow. */
export const CANONICAL_APP_ORIGIN = "https://www.talktolexi.app";

/** Stripe Dashboard endpoint — www, no trailing slash. */
export const STRIPE_WEBHOOK_PATH = "/api/billing/webhook";
export const STRIPE_WEBHOOK_URL = `${CANONICAL_APP_ORIGIN}${STRIPE_WEBHOOK_PATH}`;

/** Minute packs. Seconds live only in server config — never trust the client. */
export const VOICE_PACKS = [
  { id: "pack_10", label: "10 minutes", seconds: 600, envPrice: "STRIPE_PRICE_PACK_10" },
  { id: "pack_30", label: "30 minutes", seconds: 1800, envPrice: "STRIPE_PRICE_PACK_30" },
  { id: "pack_60", label: "60 minutes", seconds: 3600, envPrice: "STRIPE_PRICE_PACK_60" },
] as const;

export type VoicePackId = (typeof VOICE_PACKS)[number]["id"];

export function voicePackById(raw: unknown) {
  const id = typeof raw === "string" ? raw.trim() : "";
  return VOICE_PACKS.find((pack) => pack.id === id) ?? null;
}

export function stripePriceIdForPack(pack: (typeof VOICE_PACKS)[number], env: NodeJS.ProcessEnv = process.env) {
  return env[pack.envPrice]?.trim() || "";
}

export function publicPacks(env: NodeJS.ProcessEnv = process.env) {
  return VOICE_PACKS.map((pack) => ({
    id: pack.id,
    label: pack.label,
    seconds: pack.seconds,
    configured: Boolean(stripePriceIdForPack(pack, env)),
  }));
}

export function isStripeConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.STRIPE_SECRET_KEY?.trim() && env.STRIPE_WEBHOOK_SECRET?.trim());
}
