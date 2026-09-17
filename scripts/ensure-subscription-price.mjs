/**
 * Ensure a recurring monthly $9.99 Stripe Price exists for /subscribe.
 *
 * Usage (with real STRIPE_SECRET_KEY in the env):
 *   node --experimental-strip-types scripts/ensure-subscription-price.mjs
 *
 * Prints the price_… id to set as STRIPE_PRICE_SUBSCRIPTION in Vercel.
 * Never commits the secret key.
 */
import Stripe from "stripe";

const PRODUCT_NAME = "Talk To Lexi Monthly";
const AMOUNT_CENTS = 999;
const CURRENCY = "usd";
const INTERVAL = "month";

const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (server-only) before running this script.");
  process.exit(1);
}

const stripe = new Stripe(key, { apiVersion: "2025-02-24.acacia" });

const existingEnv = process.env.STRIPE_PRICE_SUBSCRIPTION?.trim() || "";
if (existingEnv) {
  const price = await stripe.prices.retrieve(existingEnv);
  console.log(
    JSON.stringify(
      {
        envPriceId: existingEnv,
        type: price.type,
        interval: price.recurring?.interval ?? null,
        unit_amount: price.unit_amount,
        currency: price.currency,
        active: price.active,
        ok: price.type === "recurring" && price.recurring?.interval === "month",
      },
      null,
      2,
    ),
  );
  if (price.type !== "recurring" || price.recurring?.interval !== "month") {
    console.error(
      "\nSTRIPE_PRICE_SUBSCRIPTION is not a recurring monthly price. Create one below or in the Dashboard.",
    );
  } else {
    console.log("\nEnv price is already a recurring monthly price. Keep STRIPE_PRICE_SUBSCRIPTION as-is.");
    process.exit(0);
  }
}

const products = await stripe.products.list({ limit: 100, active: true });
let product = products.data.find((p) => p.name === PRODUCT_NAME) ?? null;
if (!product) {
  product = await stripe.products.create({
    name: PRODUCT_NAME,
    description: "Monthly Lexi companion plan",
  });
  console.log("Created product:", product.id);
} else {
  console.log("Reusing product:", product.id);
}

const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
const match = prices.data.find(
  (p) =>
    p.type === "recurring" &&
    p.recurring?.interval === INTERVAL &&
    p.unit_amount === AMOUNT_CENTS &&
    p.currency === CURRENCY,
);

const price =
  match ??
  (await stripe.prices.create({
    product: product.id,
    unit_amount: AMOUNT_CENTS,
    currency: CURRENCY,
    recurring: { interval: INTERVAL },
  }));

console.log(
  JSON.stringify(
    {
      action: match ? "reused" : "created",
      priceId: price.id,
      type: price.type,
      interval: price.recurring?.interval ?? null,
      unit_amount: price.unit_amount,
      currency: price.currency,
      vercel: `Set STRIPE_PRICE_SUBSCRIPTION=${price.id}`,
    },
    null,
    2,
  ),
);
