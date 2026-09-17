/** Canonical production origin. Apex talktolexi.app 307s to www — Stripe will not follow. */
export const CANONICAL_APP_ORIGIN = "https://www.talktolexi.app";

/** Stripe Dashboard endpoint — www, no trailing slash. */
export const STRIPE_WEBHOOK_PATH = "/api/billing/webhook";
export const STRIPE_WEBHOOK_URL = `${CANONICAL_APP_ORIGIN}${STRIPE_WEBHOOK_PATH}`;

export const BUY_SUCCESS_URL = `${CANONICAL_APP_ORIGIN}/buy/success`;
export const BUY_CANCEL_URL = `${CANONICAL_APP_ORIGIN}/buy`;
export const SUBSCRIBE_SUCCESS_URL = `${CANONICAL_APP_ORIGIN}/subscribe/success`;
export const SUBSCRIBE_CANCEL_URL = `${CANONICAL_APP_ORIGIN}/subscribe`;

/** Recurring monthly tier. Stripe price ID is STRIPE_PRICE_SUBSCRIPTION. */
export const SUBSCRIPTION_PLAN = {
  id: "monthly",
  label: "Monthly",
  priceLabel: "$9.99",
  cadence: "per month",
  minutes: 150,
  seconds: 9000,
  envPrice: "STRIPE_PRICE_SUBSCRIPTION",
} as const;

export function stripeSubscriptionPriceId(env: NodeJS.ProcessEnv = process.env) {
  return env[SUBSCRIPTION_PLAN.envPrice]?.trim() || "";
}

export function isSubscriptionConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(isStripeConfigured(env) && stripeSubscriptionPriceId(env));
}

/**
 * Minute packs. Seconds live only in server config — never trust the client.
 * Stripe price IDs come from env (STRIPE_PRICE_PACK_10/30/60).
 */
export const VOICE_PACKS = [
  {
    id: "whisper",
    label: "Whisper",
    minutes: 10,
    seconds: 600,
    priceLabel: "$2",
    envPrice: "STRIPE_PRICE_PACK_10",
    /** Set when Ian drops the pack thumbnail into /public/buy/whisper.jpg */
    thumbnail: "/buy/whisper.jpg",
  },
  {
    id: "murmur",
    label: "Murmur",
    minutes: 30,
    seconds: 1800,
    priceLabel: "$5",
    envPrice: "STRIPE_PRICE_PACK_30",
    thumbnail: "/buy/murmur.jpg",
  },
  {
    id: "echo",
    label: "Echo",
    minutes: 60,
    seconds: 3600,
    priceLabel: "$9",
    envPrice: "STRIPE_PRICE_PACK_60",
    thumbnail: "/buy/echo.jpg",
  },
] as const;

export type VoicePackId = (typeof VOICE_PACKS)[number]["id"];

/** Pack jpgs that are actually in /public. Keep this static so SSR and the client pick the same src. */
const PUBLIC_PACK_THUMBS = new Set<string>();
const PACK_THUMB_FALLBACK = "/lexi.jpg";

export function packThumbnailSrc(thumbnail: string) {
  return PUBLIC_PACK_THUMBS.has(thumbnail) ? thumbnail : PACK_THUMB_FALLBACK;
}

const LEGACY_PACK_IDS: Record<string, VoicePackId> = {
  pack_10: "whisper",
  pack_30: "murmur",
  pack_60: "echo",
};

export function voicePackById(raw: unknown) {
  const id = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (!id) return null;
  const canonical = LEGACY_PACK_IDS[id] ?? id;
  return VOICE_PACKS.find((pack) => pack.id === canonical) ?? null;
}

export function stripePriceIdForPack(
  pack: (typeof VOICE_PACKS)[number],
  env: NodeJS.ProcessEnv = process.env,
) {
  return env[pack.envPrice]?.trim() || "";
}

/** Resolve a client-supplied Stripe price ID to a known pack (server-side only). */
export function voicePackByPriceId(raw: unknown, env: NodeJS.ProcessEnv = process.env) {
  const priceId = typeof raw === "string" ? raw.trim() : "";
  if (!priceId) return null;
  return VOICE_PACKS.find((pack) => stripePriceIdForPack(pack, env) === priceId) ?? null;
}

export function publicPacks(env: NodeJS.ProcessEnv = process.env) {
  return VOICE_PACKS.map((pack) => ({
    id: pack.id,
    label: pack.label,
    minutes: pack.minutes,
    seconds: pack.seconds,
    priceLabel: pack.priceLabel,
    configured: Boolean(stripePriceIdForPack(pack, env)),
  }));
}

/** Buy page props — includes Stripe price IDs when configured. */
export function buyPagePacks(env: NodeJS.ProcessEnv = process.env) {
  return VOICE_PACKS.map((pack) => {
    const priceId = stripePriceIdForPack(pack, env);
    return {
      id: pack.id,
      label: pack.label,
      minutes: pack.minutes,
      priceLabel: pack.priceLabel,
      thumbnail: packThumbnailSrc(pack.thumbnail),
      priceId,
      configured: Boolean(priceId),
    };
  });
}

export function isStripeConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env["STRIPE_SECRET_KEY"]?.trim() && env["STRIPE_WEBHOOK_SECRET"]?.trim());
}
