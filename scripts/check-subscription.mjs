import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/subscribe/page.tsx", import.meta.url), "utf8");
assert.ok(page.includes("https://buy.stripe.com/3cIfZgeEkbjgbI91aA6Vq00"), "payment link on Subscribe page");
assert.ok(page.includes('target="_blank"'), "opens payment link in new tab");
assert.ok(!/sk_live_|sk_test_/.test(page), "no Stripe secret on Subscribe page");

const route = readFileSync(new URL("../app/api/webhooks/stripe/route.ts", import.meta.url), "utf8");
assert.ok(route.includes("handleSubscriptionStripeWebhook"), "webhook uses subscription handler");

const sub = readFileSync(new URL("../lib/wallet/subscription.ts", import.meta.url), "utf8");
assert.ok(sub.includes("constructEvent"), "verifies Stripe signature");
assert.ok(sub.includes("STRIPE_WEBHOOK_SECRET"), "uses webhook secret");
assert.ok(sub.includes("checkout.session.completed"), "listens for checkout.session.completed");
assert.ok(sub.includes("markAccountPaidByEmail"), "marks account paid by email");
assert.ok(sub.includes("stripeClient"), "uses Stripe Node SDK via stripeClient");
assert.ok(!/NEXT_PUBLIC_STRIPE_SECRET/.test(sub), "secret key is never public");

const accounts = readFileSync(new URL("../lib/auth/accounts.ts", import.meta.url), "utf8");
assert.ok(accounts.includes("markAccountPaidByEmail"), "accounts helper exports mark paid");
assert.ok(accounts.includes("paid boolean"), "accounts.paid column ensured");

const envExample = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
assert.ok(envExample.includes("STRIPE_SECRET_KEY"), "secret key documented server-side");
assert.ok(envExample.includes("/api/webhooks/stripe"), "subscription webhook path documented");
assert.ok(envExample.includes("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"), "publishable key is public-only");

console.log("subscription check ok");
