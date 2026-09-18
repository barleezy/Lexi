import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { TEXT_FAST_MODEL, TEXT_FAST_MAX_TOKENS, textFastModelFromEnv } from "../lib/wallet/models.ts";
import { isVoiceConnectFailure } from "../lib/voice/connect-fail.ts";
import { SUBSCRIPTION_PLAN, VOICE_PACKS, publicPacks, voicePackById, STRIPE_WEBHOOK_URL } from "../lib/wallet/packs.ts";
import {
  VOICE_USD_PER_MINUTE,
  allottedVoiceSeconds,
  prepaidLedgerCentsToUsd,
  usdToVoiceSeconds,
  voiceSecondsToUsd,
} from "../lib/wallet/voice-rate.ts";
import { DEFAULT_CHAT_MODEL, chatModelFromEnv } from "../lib/channels/parse.ts";
import { VIDEO_CONTEXT_MODEL, VIDEO_CONTEXT_MAX_TOKENS } from "../lib/voice/video-context.ts";
import { IOS_REALTIME_URL } from "../lib/ios/config.ts";
import {
  REALTIME_VOICE_MODEL,
  REALTIME_VOICE_URL,
  VOICE_MAX_SESSION_SECONDS,
  VOICE_MAX_SESSION_SPEND_USD,
  VOICE_USD_PER_AUDIO_MINUTE,
  assertRealtimeVoiceModel,
  estimateVoiceSessionSpendUsd,
  voiceSessionLimitReason,
  voiceSessionRemainingSeconds,
} from "../lib/xai/realtime-model.ts";
import {
  clearCallContinuityStore,
  readPreviousSessionId,
  readVoiceSessionStore,
  VOICE_STORAGE_KEYS,
  writePreviousSessionId,
  writeVoiceSessionStore,
} from "../lib/voice/persist.ts";

assert.equal(REALTIME_VOICE_MODEL, "grok-voice-think-fast-1.0");
assert.equal(REALTIME_VOICE_URL, "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0");
assert.equal(IOS_REALTIME_URL, REALTIME_VOICE_URL);
assert.equal(VOICE_MAX_SESSION_SECONDS, 30 * 60);
assert.equal(VOICE_MAX_SESSION_SPEND_USD, 5);
assert.equal(VOICE_USD_PER_MINUTE, 0.08);
assert.equal(VOICE_USD_PER_AUDIO_MINUTE, VOICE_USD_PER_MINUTE);
assert.equal(VOICE_USD_PER_AUDIO_MINUTE, 0.08);
assert.equal(usdToVoiceSeconds(4.7), 3525);
assert.equal(usdToVoiceSeconds(4.7) / 60, 58.75);
assert.equal(allottedVoiceSeconds(3600, 4.7), 3525);
assert.equal(allottedVoiceSeconds(3600, null), 3600);
assert.equal(allottedVoiceSeconds(600, 4.7), 600);
assert.equal(prepaidLedgerCentsToUsd("-470"), 4.7);
assert.equal(voiceSecondsToUsd(60), 0.08);
assert.equal(estimateVoiceSessionSpendUsd(60), 0.08);
assert.equal(voiceSessionLimitReason(30 * 60 - 1), null);
assert.equal(voiceSessionLimitReason(30 * 60), "duration");
assert.equal(estimateVoiceSessionSpendUsd((VOICE_MAX_SESSION_SPEND_USD / VOICE_USD_PER_AUDIO_MINUTE) * 60), 5);
assert.ok(voiceSessionRemainingSeconds(0) <= VOICE_MAX_SESSION_SECONDS);
assertRealtimeVoiceModel(REALTIME_VOICE_URL);
assertRealtimeVoiceModel(IOS_REALTIME_URL);
assert.throws(() => assertRealtimeVoiceModel("wss://api.x.ai/v1/realtime?model=grok-voice-latest"));
assert.throws(() => assertRealtimeVoiceModel("wss://api.x.ai/v1/realtime?model=grok-4-1-fast-reasoning"));
assert.throws(() => assertRealtimeVoiceModel("wss://api.x.ai/v1/realtime?model=grok-4.6"));

{
  const s = usdToVoiceSeconds(4.7);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  assert.equal(`${m}m ${rem}s`, "58m 45s");
}

const voiceRateSrc = readFileSync(new URL("../lib/wallet/voice-rate.ts", import.meta.url), "utf8");
assert.ok(voiceRateSrc.includes("VOICE_USD_PER_MINUTE = 0.08"), "billed usage rate is $0.08/min");
assert.ok(voiceRateSrc.includes("usdToVoiceSeconds"), "usd → seconds helper");
assert.ok(voiceRateSrc.includes("every signed-in account"), "rate is global");
assert.ok(!voiceRateSrc.includes("isAdminUserId"), "rate is not admin-gated");
assert.ok(!voiceRateSrc.includes("ADMIN_USER_IDS"), "rate is not admin-gated");

const allotmentSrc = readFileSync(new URL("../lib/wallet/allotment.ts", import.meta.url), "utf8");
assert.ok(allotmentSrc.includes("readAllottedVoiceSeconds"), "allotment helper");
assert.ok(allotmentSrc.includes("readXaiPrepaidRemainingUsd"), "allotment reads team prepaid");
assert.ok(allotmentSrc.includes("allottedVoiceSeconds"), "allotment uses $0.08/min math");
assert.ok(!allotmentSrc.includes("isAdminUserId"), "allotment is not admin-gated");

assert.equal(TEXT_FAST_MODEL, "grok-4-1-fast-reasoning");
assert.equal(TEXT_FAST_MAX_TOKENS, 800);
assert.equal(DEFAULT_CHAT_MODEL, "grok-4-1-fast-reasoning");
assert.equal(VIDEO_CONTEXT_MODEL, "grok-4-1-fast-reasoning");
assert.equal(VIDEO_CONTEXT_MAX_TOKENS, 800);
assert.equal(chatModelFromEnv({}), DEFAULT_CHAT_MODEL);
assert.equal(chatModelFromEnv({ XAI_CHAT_MODEL: "grok-voice-latest" }), DEFAULT_CHAT_MODEL);
assert.equal(textFastModelFromEnv({ XAI_CHAT_MODEL: "grok-4-1-fast-reasoning" }), "grok-4-1-fast-reasoning");

assert.equal(VOICE_PACKS[0].seconds, 600);
assert.equal(VOICE_PACKS[0].id, "whisper");
assert.equal(VOICE_PACKS[0].priceLabel, "$2");
assert.equal(VOICE_PACKS[0].minutes, 10);
assert.equal(VOICE_PACKS[1].id, "murmur");
assert.equal(VOICE_PACKS[1].priceLabel, "$5");
assert.equal(VOICE_PACKS[1].minutes, 30);
assert.equal(VOICE_PACKS[2].id, "echo");
assert.equal(VOICE_PACKS[2].priceLabel, "$9");
assert.equal(VOICE_PACKS[2].minutes, 60);
assert.equal(VOICE_PACKS[2].seconds, 3600);
assert.equal(voicePackById("pack_30")?.seconds, 1800);
assert.equal(voicePackById("murmur")?.seconds, 1800);
assert.equal(voicePackById("nope"), null);
assert.ok(publicPacks({}).every((p) => typeof p.seconds === "number"));
assert.equal(
  STRIPE_WEBHOOK_URL,
  "https://www.talktolexi.app/api/billing/webhook",
  "Stripe webhook must be www with no trailing slash",
);
assert.ok(!STRIPE_WEBHOOK_URL.includes("://talktolexi.app/"), "never apex host");
assert.ok(!STRIPE_WEBHOOK_URL.endsWith("/"), "no trailing slash");

const packsSrc = readFileSync(new URL("../lib/wallet/packs.ts", import.meta.url), "utf8");
assert.ok(packsSrc.includes("BUY_SUCCESS_URL"), "buy success url");
assert.ok(packsSrc.includes("/buy/success"), "buy success path");
assert.ok(packsSrc.includes("SUBSCRIBE_SUCCESS_URL"), "subscribe success url");
assert.ok(packsSrc.includes("/subscribe/success"), "subscribe success path");
assert.ok(packsSrc.includes("SUBSCRIBE_CANCEL_URL"), "subscribe cancel url");
assert.ok(packsSrc.includes("STRIPE_PRICE_PACK_10"), "whisper price env");
assert.ok(packsSrc.includes('id: "whisper"'), "whisper pack");
assert.ok(packsSrc.includes('id: "murmur"'), "murmur pack");
assert.ok(packsSrc.includes('id: "echo"'), "echo pack");
assert.ok(packsSrc.includes("thumbnail"), "packs declare thumbnail paths");
assert.ok(packsSrc.includes("/buy/whisper.jpg"), "whisper thumbnail path");
assert.ok(packsSrc.includes("/buy/murmur.jpg"), "murmur thumbnail path");
assert.ok(packsSrc.includes("/buy/echo.jpg"), "echo thumbnail path");
assert.ok(!packsSrc.includes("existsSync"), "pack thumbs are not fs.stat'd at render");
assert.ok(packsSrc.includes("packThumbnailSrc"), "pack thumbs resolve without node:fs");
assert.ok(!packsSrc.includes("IOS_BILLING"), "no iOS billing return URLs");
assert.ok(!packsSrc.includes("billing-return"), "no billing-return path");
assert.ok(!existsSync(new URL("../app/ios/billing-return/page.tsx", import.meta.url)), "no billing-return page");

const buyPage = readFileSync(new URL("../app/buy/page.tsx", import.meta.url), "utf8");
assert.ok(!buyPage.includes("redirect"), "buy catalog is public");
assert.ok(buyPage.includes("buyPagePacks"), "buy always loads packs");
assert.ok(buyPage.includes("BuyClient"), "buy renders pack client");
assert.ok(buyPage.includes("readIncomingAuthSession"), "buy HTML uses shared session helper");
assert.ok(buyPage.includes("await connection()"), "buy page reads live Stripe price env");

const buyClient = readFileSync(new URL("../app/buy/buy-client.tsx", import.meta.url), "utf8");
assert.ok(buyClient.includes("Talk To Lexi"), "buy brand hero");
assert.ok(buyClient.includes("Choose Your AI Companion Plan"), "buy subtitle");
assert.ok(buyClient.includes("/lexi.jpg"), "buy uses Lexi portrait");
assert.ok(buyClient.includes("Whisper") || buyPage.includes("buyPagePacks"), "buy loads named packs");
assert.ok(buyClient.includes("BuyPacks"), "buy page uses shared pack cards");
assert.ok(buyClient.includes("signedIn"), "buy passes sign-in to cards");
assert.ok(buyClient.includes("stripeReady"), "buy surfaces billing status");
assert.ok(!buyClient.includes("existsSync"), "buy client does not restat pack thumbs");
assert.ok(!buyClient.includes("Date.now"), "buy client does not clock-render");
assert.ok(!buyClient.includes("document.cookie"), "buy client does not re-read session cookies");
assert.ok(!buyClient.includes("@/lib/wallet/packs"), "buy client uses server-computed pack props");

const buyPacks = readFileSync(new URL("../components/buy-packs.tsx", import.meta.url), "utf8");
assert.ok(buyPacks.includes("pack.thumbnail"), "buy cards render thumbnails when present");
assert.ok(buyPacks.includes("/api/checkout"), "buy posts checkout");
assert.ok(buyPacks.includes('credentials: "include"'), "buy checkout sends session cookie");
assert.ok(buyPacks.includes("priceId"), "buy sends priceId");
assert.ok(buyPacks.includes("Buy"), "buy buttons");
assert.ok(buyPacks.includes("Sign in to buy"), "unsigned buy asks to sign in");
assert.ok(buyPacks.includes("Checkout is not configured yet"), "unconfigured packs explain why");
assert.ok(!/disabled=\{pendingId != null \|\| !pack\.configured\}/.test(buyPacks), "buy is not silently disabled");

const homeSrc = readFileSync(new URL("../components/voice-home.tsx", import.meta.url), "utf8");
assert.ok(homeSrc.includes('href="/buy"'), "home Buy links to /buy");
assert.ok(homeSrc.includes("BuyPacks"), "home can show pack cards");
assert.ok(homeSrc.includes("Rehearsal"), "rehearsal screen label");
assert.ok(
  homeSrc.includes('process.env.NODE_ENV === "development"') &&
    homeSrc.includes("Rehearsal"),
  "rehearsal badge is development-only",
);
assert.ok(!homeSrc.includes("NEXT_PUBLIC_STRIPE_MODE"), "rehearsal badge ignores Stripe test mode");
assert.ok(!homeSrc.includes("STRIPE_MODE"), "rehearsal badge ignores Stripe mode env");
assert.ok(
  (homeSrc.match(/setRehearsal\(true\)/g) || []).length ===
    (homeSrc.match(/process\.env\.NODE_ENV === "development"\) setRehearsal\(true\)/g) || []).length,
  "setRehearsal(true) is development-only",
);
assert.ok(
  homeSrc.includes('process.env.NODE_ENV === "development" && rehearsal'),
  "rehearsal copy and badge stay behind NODE_ENV",
);
assert.ok(!/setRehearsal\(seconds/.test(homeSrc), "balance refresh does not open rehearsal");
assert.ok(!homeSrc.includes('get("next") === "/buy"'), "home does not auto-open buy from ?next=");
assert.ok(homeSrc.includes("buyIntent && !live"), "buy section is click-intent only");
assert.ok(homeSrc.includes("Manage subscription"), "home shows Manage subscription when subscribed");
assert.ok(homeSrc.includes('href="/account"'), "home manage/account links to /account");
assert.ok(homeSrc.includes('subscribed ? "/account" : "/subscribe"'), "home Subscribe follows billing status");
assert.ok(homeSrc.includes("catalogPacks"), "home can hydrate catalog packs after paint");
assert.ok(homeSrc.includes("afterFirstPaint"), "home defers balance/channels/music until after first paint");
assert.ok(homeSrc.includes("loadVoiceSession"), "home lazy-loads VoiceSession until Connect");
assert.ok(homeSrc.includes("Buy minutes"), "home always offers Buy minutes");
assert.ok(!homeSrc.includes("useState(() => new Date())"), "LiveClock does not SSR a wall clock");
assert.ok(homeSrc.includes("live && music.appleConnected"), "Apple Music search bar only during a live call");

const homePage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
assert.ok(!homePage.includes("buyPagePacks"), "home HTML is not blocked on Stripe pack catalog");
assert.ok(!homePage.includes("await connection()"), "home HTML is not blocked on connection()");
assert.ok(homePage.includes("VoiceHome"), "home still renders VoiceHome");

const balanceSrc = readFileSync(new URL("../app/api/billing/balance/route.ts", import.meta.url), "utf8");
assert.ok(balanceSrc.includes("buyPagePacks"), "balance returns buy packs");
assert.ok(balanceSrc.includes("readAccountSubscribed"), "balance returns subscription status");
assert.ok(balanceSrc.includes("subscribed"), "balance JSON includes subscribed");
assert.ok(balanceSrc.includes("requireAuthSessionUserId"), "balance uses shared session helper");
assert.ok(balanceSrc.includes('force-dynamic'), "balance is not statically cached");
assert.ok(balanceSrc.includes("await connection()"), "balance reads live env and cookies");
assert.ok(balanceSrc.includes("creditPaidCheckoutsForUser"), "balance credits paid packs before showing minutes");
assert.ok(balanceSrc.includes("readAllottedVoiceSeconds"), "balance allots minutes from prepaid at $0.08/min for the session user");
assert.ok(balanceSrc.includes("formatVoiceMinutes"), "balance labels allotted seconds");
assert.ok(!balanceSrc.includes("clampVoiceSecondsToSoldPacks"), "balance must not invent Echo 60 when prepaid is $4.70");
assert.ok(!balanceSrc.includes("MAX_VOICE_PACK_SECONDS"), "balance display is not the Echo 3600 cap");
assert.ok(!balanceSrc.includes("isAdminUserId"), "balance allotment is not admin-gated");
assert.ok(!balanceSrc.includes("ADMIN_USER_IDS"), "balance allotment is not admin-gated");
assert.ok(balanceSrc.includes("no-store"), "balance forbids HTTP cache");
assert.ok(!balanceSrc.includes("searchParams.get(\"userId\")"), "balance does not require a claimed query userId");
assert.ok(!balanceSrc.includes("plan:"), "balance does not add a plan field for iOS");
assert.ok(!balanceSrc.includes("SUBSCRIPTION_PLAN"), "balance does not expand subscription plan");

assert.ok(homeSrc.includes('cache: "no-store"'), "home balance fetch skips HTTP cache");
assert.ok(homeSrc.includes("refreshWhenVisible"), "home refreshes minutes when the tab is shown");
assert.ok(homeSrc.includes("await settled"), "home waits for settle before reading minutes");

const buySuccess = readFileSync(new URL("../app/buy/success/page.tsx", import.meta.url), "utf8");
assert.ok(buySuccess.includes("Minutes added"), "success copy");
assert.ok(buySuccess.includes("creditPaidCheckoutsForUser"), "success credits paid packs before showing minutes");
assert.ok(buySuccess.includes("You now have"), "success shows live allotted minutes");
assert.ok(buySuccess.includes("readAllottedVoiceSeconds"), "success labels prepaid-clamped minutes");
assert.ok(buySuccess.includes('href="/"'), "success links to Call");

const subscribeSuccess = readFileSync(new URL("../app/subscribe/success/page.tsx", import.meta.url), "utf8");
assert.ok(subscribeSuccess.includes("You are subscribed"), "subscribe success copy");
assert.ok(subscribeSuccess.includes('href="/"'), "subscribe success links to Call");

const checkoutApi = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
assert.ok(checkoutApi.includes("priceId"), "checkout takes priceId");
assert.ok(checkoutApi.includes("createCheckoutByPriceId"), "checkout by price");
assert.ok(checkoutApi.includes("await requireAuthSessionUserId"), "checkout uses shared session helper");
assert.ok(checkoutApi.includes("await connection()"), "checkout reads live Stripe price env");
assert.ok(!checkoutApi.includes("body.seconds"), "checkout ignores client seconds");
assert.ok(!checkoutApi.includes("iosReturn"), "checkout route has no iosReturn");
assert.ok(!checkoutApi.includes("client"), "checkout route ignores client:ios");

const resetSrc = readFileSync(new URL("../lib/auth/reset.ts", import.meta.url), "utf8");
assert.ok(resetSrc.includes('hostname === "talktolexi.app"'), "publicAppUrl remaps apex → www");
assert.ok(resetSrc.includes("www.talktolexi.app"), "publicAppUrl prefers www");

const nextConfigSrc = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
assert.ok(/trailingSlash:\s*false/.test(nextConfigSrc), "trailingSlash false avoids webhook 308");

const webhookRoute = readFileSync(new URL("../app/api/billing/webhook/route.ts", import.meta.url), "utf8");
assert.ok(webhookRoute.includes("export async function POST"), "webhook POST handler");
assert.ok(webhookRoute.includes("export async function GET"), "webhook GET probe");
assert.ok(webhookRoute.includes("www.talktolexi.app"), "webhook docs www URL");
assert.ok(webhookRoute.includes("await connection()"), "minutes webhook reads live Stripe env");
assert.ok(webhookRoute.includes("handleXaiStripeWebhook"), "minutes webhook also tops up xAI");

const xaiWebhookRoute = readFileSync(new URL("../app/api/webhooks/stripe/route.ts", import.meta.url), "utf8");
assert.ok(xaiWebhookRoute.includes("export async function POST"), "xAI webhook POST handler");
assert.ok(xaiWebhookRoute.includes("req.text()"), "xAI webhook reads raw body");
assert.ok(!xaiWebhookRoute.includes("req.json()"), "xAI webhook never parses JSON before constructEvent");
assert.ok(xaiWebhookRoute.includes("stripeWebhookSecret"), "xAI webhook uses shared Stripe signing secret");
assert.ok(xaiWebhookRoute.includes("await connection()"), "xAI webhook reads live env at runtime");
assert.ok(!xaiWebhookRoute.includes("STRIPE_XAI_WEBHOOK_SECRET"), "xAI webhook does not use a separate secret name");
assert.ok(xaiWebhookRoute.includes("XAI_MANAGEMENT_API_KEY"), "xAI webhook documents management key");
assert.ok(!/Bearer <XAI_API_KEY>|Bearer \$\{.*XAI_API_KEY/.test(xaiWebhookRoute), "xAI webhook must not use inference key");
assert.ok(xaiWebhookRoute.includes("checkout.session.completed"), "xAI webhook event list");
assert.ok(xaiWebhookRoute.includes("/api/webhooks/stripe"), "xAI webhook URL");
assert.ok(xaiWebhookRoute.includes("www.talktolexi.app"), "xAI webhook docs www URL");
assert.ok(xaiWebhookRoute.includes("handleStripeWebhook"), "xAI webhook credits voice minutes");

const xaiTopupSrc = readFileSync(new URL("../lib/wallet/xai-topup.ts", import.meta.url), "utf8");
assert.ok(xaiTopupSrc.includes("XAI_MANAGEMENT_API_KEY"), "top-up uses management key env");
assert.ok(xaiTopupSrc.includes("XAI_TEAM_ID"), "top-up requires team id env");
assert.ok(xaiTopupSrc.includes("management-api.x.ai"), "top-up hits management API");
assert.ok(xaiTopupSrc.includes("/prepaid/top-up"), "top-up path");
assert.ok(xaiTopupSrc.includes("/prepaid/balance"), "prepaid remaining-balance path");
assert.ok(xaiTopupSrc.includes("readXaiPrepaidRemainingUsd"), "prepaid remaining is readable");
assert.ok(xaiTopupSrc.includes("parsePrepaidRemainingUsd"), "prepaid remaining parser");
assert.ok(!xaiTopupSrc.includes("isAdminUserId"), "prepaid remaining is not admin-gated");
assert.ok(xaiTopupSrc.includes("{ amount: { val: String(amount_total) } }"), "top-up body is amount.val cents string");
assert.ok(xaiTopupSrc.includes("[xai-topup] request body"), "logs full xAI request body");
assert.ok(xaiTopupSrc.includes("[xai-topup] response"), "logs full xAI response");
assert.ok(xaiTopupSrc.includes("response.status"), "logs xAI status");
assert.ok(xaiTopupSrc.includes("xai_credit_topups"), "idempotent top-up table");
assert.ok(xaiTopupSrc.includes("stripe_event_id"), "idempotent on Stripe event id");
assert.ok(!xaiTopupSrc.includes("env.XAI_API_KEY"), "top-up must not fall back to XAI_API_KEY");
assert.ok(xaiTopupSrc.includes("constructEvent"), "xAI webhook verifies Stripe signature");
assert.ok(xaiTopupSrc.includes("stripeWebhookSecret"), "xAI constructEvent uses shared Stripe signing secret");
assert.ok(!xaiTopupSrc.includes("STRIPE_XAI_WEBHOOK_SECRET"), "xAI top-up does not use a separate secret name");

const sessionSrc = readFileSync(new URL("../lib/auth/session.ts", import.meta.url), "utf8");
assert.ok(sessionSrc.includes('export const LEXI_SESSION_COOKIE = "lexi_session"'), "session cookie");
assert.ok(sessionSrc.includes("requireAuthSessionUserId"), "auth helper");
assert.ok(sessionSrc.includes('from "next/headers"'), "auth helper reads Next cookies like /buy");
assert.ok(sessionSrc.includes("readIncomingAuthSession"), "pages share cookies()+verifyAuthSession");
assert.ok(sessionSrc.includes("x-lexi-user-id is not auth") || sessionSrc.includes("not auth"), "docs");

const voiceSrc = readFileSync(new URL("../lib/wallet/voice.ts", import.meta.url), "utf8");
assert.ok(voiceSrc.includes("CREATE TABLE IF NOT EXISTS voice_sessions"), "voice_sessions table");
assert.ok(voiceSrc.includes("voice_seconds"), "voice_seconds column");
assert.ok(voiceSrc.includes("monthly_minutes_reset_at"), "monthly reset column");
assert.ok(voiceSrc.includes("VOICE_HOLD_SECONDS = 90"), "hold 90");
assert.ok(voiceSrc.includes("VOICE_MIN_SECONDS = 30"), "min 30");
assert.ok(voiceSrc.includes("SESSION_LIMIT_CODE"), "session duration/spend limit code");
assert.ok(voiceSrc.includes("voiceSessionRemainingSeconds"), "extend hold is clipped by duration/spend");
assert.ok(voiceSrc.includes("export async function extendVoiceHold"), "extend hold while leftover remains");
assert.ok(voiceSrc.includes("sweepStaleVoiceSessions"), "sweeper");
assert.ok(voiceSrc.includes("stripe_event_id"), "idempotent stripe event");
assert.ok(voiceSrc.includes("voice_credits_stripe_session_uidx"), "idempotent stripe checkout session");
assert.ok(voiceSrc.includes("creditSubscriptionCheckoutMinutes"), "subscription checkout credits 150 minutes");
assert.ok(voiceSrc.includes("reverseReconciledSubscriptionCredits"), "can undo a reloaded subscription grant");
assert.ok(voiceSrc.includes("capAllottedMinutesToPacks"), "wallet can snap down to purchased packs");
assert.ok(voiceSrc.includes("repairVoiceSecondsToPurchasedPacks"), "one-time pack ledger repair drops leftover monthly grants");
assert.ok(voiceSrc.includes("pack ledger repair failed"), "schema ensure still logs if the pack repair throws");
assert.ok(voiceSrc.includes("repaired allotted minutes to purchased packs"), "repair logs when it snaps a wallet down");
assert.ok(
  voiceSrc.includes("SELECT COUNT(*)::int AS count FROM accounts WHERE voice_seconds > 3600"),
  "repair pre/post-check counts every accounts row over Echo",
);
assert.ok(voiceSrc.includes("[stripe-minutes] repair pre-check"), "repair logs the pre-check count");
assert.ok(voiceSrc.includes("[stripe-minutes] repair post-check"), "repair logs the post-check count");
assert.ok(
  voiceSrc.includes("SET voice_seconds = LEAST(voice_seconds, 3600), updated_at = now()"),
  "repair snaps the whole accounts table down to Echo 3600",
);
assert.ok(voiceSrc.includes("WHERE voice_seconds > 3600"), "Echo snap has no user_id predicate");
{
  const repairFn = voiceSrc.slice(
    voiceSrc.indexOf("export async function repairVoiceSecondsToPurchasedPacks"),
    voiceSrc.indexOf("export async function creditSubscriptionCheckoutMinutes"),
  );
  assert.ok(repairFn.includes("repairVoiceSecondsToPurchasedPacks"), "repair function slice");
  assert.ok(!repairFn.includes("WALLET_USER_SQL"), "repair UPDATE is not Ian/Barleezy-filtered");
  assert.ok(!repairFn.includes("isAdminUserId"), "repair is not admin-gated");
  assert.ok(!repairFn.includes("ADMIN_USER_IDS"), "repair is not admin-gated");
  assert.ok(!/WHERE\s+user_id\s*=\s*\$/.test(repairFn), "repair has no WHERE user_id = $n bind");
}
assert.ok(voiceSrc.includes("setToPack"), "pack credit SETS voice_seconds to the purchased pack");
assert.ok(voiceSrc.includes('mode?: "add" | "set"'), "creditVoiceSeconds distinguishes SET packs from ADD subscription");
assert.ok(voiceSrc.includes("hold_seconds = 0"), "hangup settle zeros the reserved hold");
assert.ok(voiceSrc.includes("MAX_VOICE_PACK_SECONDS"), "wallet exports Echo as the largest sold pack");
assert.ok(voiceSrc.includes("clampVoiceSecondsToSoldPacks"), "wallet can clamp displayed minutes to Echo");
assert.ok(voiceSrc.includes("seconds IN ("), "pack cap uses IN (600, 1800, 3600) instead of a JS int[] bind");
assert.ok(voiceSrc.includes("lower(user_id) IN ('ian', 'barleezy')"), "pack cap sums Ian and Barleezy credit rows");
assert.ok(!voiceSrc.includes("ANY($2::int[])"), "pack cap does not bind a JS array as int[]");
assert.ok(voiceSrc.includes("pack credit query failed"), "failed pack lookup is logged and retried");
assert.ok(voiceSrc.includes("keepMonthlyResetInCurrentPeriod"), "do not rewind the monthly clock into a due refill");
assert.ok(voiceSrc.includes("stripe_event_id LIKE 'cs:%'"), "reconcile subscription rows use cs: event ids");
assert.ok(voiceSrc.includes("maybeRefillMonthlyMinutes"), "call start can refill monthly minutes");
assert.ok(voiceSrc.includes("await maybeRefillMonthlyMinutes(accountId)"), "placeVoiceHold refills before debit");
assert.ok(voiceSrc.includes("interval '30 days'"), "monthly refill is a 30-day window");
assert.ok(voiceSrc.includes("SUBSCRIPTION_PLAN.seconds"), "monthly refill uses plan seconds");
assert.ok(!voiceSrc.includes("interval '1 day'"), "no daily subscription grant");

const accountsSrc = readFileSync(new URL("../lib/auth/accounts.ts", import.meta.url), "utf8");
assert.ok(accountsSrc.includes("monthly_minutes_reset_at"), "accounts schema has monthly reset column");

const subscriptionSrc = readFileSync(new URL("../lib/wallet/subscription.ts", import.meta.url), "utf8");
assert.ok(subscriptionSrc.includes("monthly_minutes_reset_at"), "subscription schema has monthly reset column");

const realtimeSrc = readFileSync(new URL("../app/api/realtime/session/route.ts", import.meta.url), "utf8");
assert.ok(realtimeSrc.includes("xaiInferenceKey"), "web mint reads live XAI_API_KEY");
assert.ok(realtimeSrc.includes("await connection()"), "web mint waits for runtime env");
assert.ok(realtimeSrc.includes("mintXaiClientSecret"), "web mint shares the xAI client-secret helper");
assert.ok(realtimeSrc.includes("@/lib/xai/client-secret"), "web mint does not import the iOS session graph");
assert.ok(!realtimeSrc.includes("process.env.XAI_API_KEY"), "web mint does not inline process.env.XAI_API_KEY");
assert.ok(realtimeSrc.includes("requireAuthSessionUserId"), "mint uses signed session");
assert.ok(realtimeSrc.includes("placeVoiceHold"), "mint holds");
assert.ok(realtimeSrc.includes('rehearsal === true') || realtimeSrc.includes("rehearsal === true"), "rehearsal skips mint");
assert.ok(realtimeSrc.includes("402"), "402 out of minutes");
assert.ok(realtimeSrc.includes("requireAuthSessionUserId"), "mint uses signed session");
assert.ok(!/model=grok-4-1-fast/.test(realtimeSrc), "no text model on mint route");

const sessionClient = readFileSync(new URL("../lib/voice/session.ts", import.meta.url), "utf8");
assert.ok(sessionClient.includes('handlers.onError("Out of minutes.")'), "web surfaces Out of minutes.");
assert.ok(sessionClient.includes("/^out of minutes"), "402 copy not wrapped in session id");
assert.ok(sessionClient.includes("extendHoldAndRemint"), "web rolls hold instead of hanging up at 90s");
assert.ok(sessionClient.includes("extend: extend") || sessionClient.includes("extend: true"), "web sends extend");
assert.ok(sessionClient.includes("model=${REALTIME_VOICE_MODEL}"), "web WS pins the versioned voice model");
assert.ok(sessionClient.includes("model: REALTIME_VOICE_MODEL"), "web session.update pins the model");
assert.ok(sessionClient.includes("attempt(4)"), "web settle retries after a failed hangup post");
assert.ok(homeSrc.includes("? error"), "Out of minutes is not hidden by rehearsal copy");
assert.ok(homeSrc.includes("${callLeftSeconds}s left"), "live Call shows remaining time");

const iosClient = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Shared/API/LexiAPIClient.swift", import.meta.url),
  "utf8",
);
assert.ok(iosClient.includes('"Out of minutes."'), "iOS surfaces Out of minutes.");
assert.ok(iosClient.includes("extendRealtimeSession"), "iOS can extend the hold");
assert.ok(iosClient.includes('static let model = "grok-voice-think-fast-1.0"'), "iOS hardcodes the pinned voice model");
assert.ok(iosClient.includes("maxSpendUsd = 5"), "iOS spend guard is $5");
assert.ok(iosClient.includes("maxDuration: TimeInterval = 30 * 60"), "iOS duration guard is 30 minutes");
assert.ok(iosClient.includes("for attempt in 1...5"), "iOS settle retries on disconnect");
assert.ok(iosClient.includes("alreadySettled"), "iOS settle treats a second post as success");
assert.ok(realtimeSrc.includes("extendVoiceHold"), "web mint can extend");
assert.ok(realtimeSrc.includes("SESSION_LIMIT_CODE"), "web extend honors the session limit");

const mintSrc = readFileSync(new URL("../lib/xai/client-secret.ts", import.meta.url), "utf8");
assert.ok(mintSrc.includes("REALTIME_VOICE_MODEL"), "mint binds the pinned voice model");
assert.ok(mintSrc.includes('effort: "none"'), "mint pins reasoning off so the secret cannot default to high");

const iosSessionSrc = readFileSync(new URL("../lib/ios/session.ts", import.meta.url), "utf8");
assert.ok(iosSessionSrc.includes("model: REALTIME_VOICE_MODEL"), "iOS session.update pins the model");

const iosController = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/App/LexiAppController.swift", import.meta.url),
  "utf8",
);
assert.ok(iosController.includes("VoiceRealtimeConfig.url"), "iOS connect ignores a server URL that could escalate");
assert.ok(iosController.includes("pinnedSessionUpdate"), "iOS session start overwrites model");
assert.ok(iosController.includes("settlePendingVoiceSessions"), "iOS settles leftover holds on launch and hangup");
assert.ok(iosController.includes("scheduleLaunchWork"), "iOS defers settle/billing/channels until after first frame");
assert.ok(iosController.includes("launchWorkStarted"), "iOS launch work is one-shot");
assert.ok(iosController.includes("applySessionLimits"), "iOS arms duration and spend guards");
assert.ok(iosController.includes("realtimeDidDisconnect"), "iOS settles on socket death, not only End");
assert.ok(!iosController.includes("grok-voice-latest"), "iOS controller does not fall back to the latest alias");
assert.ok(iosController.includes('openSitePath("/buy")'), "iOS Buy minutes opens /buy");
assert.ok(iosController.includes('openSitePath("/subscribe")'), "iOS Subscribe opens /subscribe");
assert.ok(iosController.includes('openSitePath("/account")'), "iOS Manage account opens /account");
assert.ok(iosController.includes("account.apiHost"), "iOS site URLs use AccountStore.apiHost");
assert.ok(iosController.includes("UIApplication.shared.open"), "iOS opens Safari, not an in-app checkout session");
assert.ok(iosController.includes("refreshBilling"), "iOS refreshes minutes from GET /api/billing/balance");
assert.ok(iosController.includes("settleIfIdle"), "iOS refreshes minutes when returning to the app");
assert.ok(!iosController.includes("startPackCheckout"), "iOS does not create pack Checkout sessions");
assert.ok(!iosController.includes("startSubscribeCheckout"), "iOS does not create subscribe Checkout sessions");
assert.ok(!iosController.includes("openCheckout"), "iOS does not present ASWebAuthenticationSession checkout");
assert.ok(!iosController.includes("Product.purchase"), "iOS buy/subscribe does not call StoreKit IAP");
assert.ok(!iosClient.includes("startPackCheckout"), "iOS API client does not start pack checkout");
assert.ok(!iosClient.includes("startSubscribeCheckout"), "iOS API client does not start subscribe checkout");
assert.ok(!iosClient.includes('"client": "ios"'), "iOS API client does not send client:ios");
assert.ok(iosClient.includes("billingBalance"), "iOS still reads GET /api/billing/balance");
assert.ok(iosClient.includes("/api/billing/balance"), "iOS balance path is the existing API");

const iosSettings = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Settings/SettingsView.swift", import.meta.url),
  "utf8",
);
assert.ok(iosSettings.includes("Buy minutes"), "settings has Buy minutes");
assert.ok(iosSettings.includes("Subscribe"), "settings has Subscribe");
assert.ok(iosSettings.includes("Manage account"), "settings has Manage account");
assert.ok(iosSettings.includes("openBuyMinutes"), "settings Buy minutes opens Safari /buy");
assert.ok(iosSettings.includes("openSubscribe"), "settings Subscribe opens Safari /subscribe");
assert.ok(iosSettings.includes("openManageAccount"), "settings Manage account opens Safari /account");
assert.ok(!iosSettings.includes("buyPack"), "settings is not per-pack native checkout");

const iosSignIn = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Auth/SignInCoordinator.swift", import.meta.url),
  "utf8",
);
assert.ok(!iosSignIn.includes("openCheckout"), "sign-in coordinator does not open checkout");
assert.ok(!iosSignIn.includes("talktolexi://billing"), "no billing callback scheme");

const iosHome = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Voice/VoiceHomeView.swift", import.meta.url),
  "utf8",
);
assert.ok(iosHome.includes("minutesLabel"), "home header can show minutes");
assert.ok(iosHome.includes("showSettings"), "minutes pill opens Settings");
assert.ok(iosHome.includes("scheduleLaunchWork"), "VoiceHomeView kicks launch work after first appearance");

const musicSrc = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Music/MusicController.swift", import.meta.url),
  "utf8",
);
assert.ok(musicSrc.includes("import StoreKit"), "StoreKit stays in the target via MusicController");

const accountSrc = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Auth/AccountStore.swift", import.meta.url),
  "utf8",
);
assert.ok(accountSrc.includes("pendingVoiceSessionIds"), "iOS persists unsettled voice sessions across kills");

const stripeSrc = readFileSync(new URL("../lib/wallet/stripe.ts", import.meta.url), "utf8");
assert.ok(stripeSrc.includes("constructEvent"), "webhook verifies signature");
assert.ok(stripeSrc.includes("voicePackById"), "webhook remaps pack → seconds on server");
assert.ok(stripeSrc.includes("stripeEventId: event.id"), "idempotent on event id");
assert.ok(!/Number\(session\.metadata\?\.seconds\)/.test(stripeSrc), "webhook does not trust metadata seconds alone");
assert.ok(stripeSrc.includes("missing_checkout_metadata"), "test events without metadata return ok");
assert.ok(!stripeSrc.includes("Checkout metadata missing user/pack"), "missing metadata is not a 400");
assert.ok(stripeSrc.includes("user_id"), "checkout metadata user_id");
assert.ok(stripeSrc.includes("pack:"), "checkout metadata pack");
assert.ok(stripeSrc.includes("BUY_SUCCESS_URL"), "checkout success → /buy/success");
assert.ok(stripeSrc.includes("BUY_CANCEL_URL"), "checkout cancel → /buy");
assert.ok(stripeSrc.includes("success_url: SUBSCRIBE_SUCCESS_URL"), "subscription success → /subscribe/success");
assert.ok(stripeSrc.includes("cancel_url: SUBSCRIBE_CANCEL_URL"), "subscription cancel → /subscribe");
assert.ok(!stripeSrc.includes("iosReturn"), "checkout has no iosReturn variant");
assert.ok(!stripeSrc.includes("IOS_BILLING"), "checkout does not use iOS billing-return URLs");
assert.ok(!stripeSrc.includes("billing-return"), "checkout does not return to /ios/billing-return");
assert.ok(stripeSrc.includes("createCheckoutByPriceId"), "priceId checkout helper");
assert.ok(stripeSrc.includes("createSubscriptionCheckout"), "subscription checkout helper");
assert.ok(stripeSrc.includes('mode: "subscription"'), "subscription checkout is recurring");
assert.ok(stripeSrc.includes("[subscribe-checkout]"), "subscription checkout logs Stripe failures");
assert.ok(stripeSrc.includes("markAccountSubscribed"), "webhook marks monthly subscribers");
assert.ok(stripeSrc.includes("creditSubscriptionCheckoutMinutes"), "subscription checkout adds 150 minutes");
assert.ok(stripeSrc.includes("customer.subscription.deleted"), "webhook clears canceled subscriptions");
assert.ok(stripeSrc.includes("subscription_data"), "subscribe checkout stamps subscription metadata");
assert.ok(stripeSrc.includes("session.metadata?.pack"), "webhook reads metadata.pack");
assert.ok(stripeSrc.includes("resolveVoicePackFromCheckout"), "webhook falls back to Stripe price id");
assert.ok(stripeSrc.includes("price_id: input.priceId"), "checkout stamps price_id metadata");
assert.ok(stripeSrc.includes("creditPaidCheckoutsForUser"), "page load can credit paid Checkout sessions");
assert.ok(stripeSrc.includes('mode: "set"'), "pack checkout SETS allotted minutes to the purchased pack");
assert.ok(stripeSrc.includes("(left.created ?? 0) - (right.created ?? 0)"), "reconcile applies older packs before the latest SET");
assert.ok(stripeSrc.includes("isSubscriptionCheckout(session)) continue"), "page load does not reload subscription minutes");
assert.ok(stripeSrc.includes("reverseReconciledSubscriptionCredits"), "page load undoes a reloaded subscription grant");
assert.ok(stripeSrc.includes("capAllottedMinutesToPacks"), "page load caps allotted minutes to purchased packs");
assert.ok(stripeSrc.includes("cap allotted minutes failed"), "page load still logs if the pack cap throws");
assert.ok(stripeSrc.includes("reconcile paid checkouts failed"), "Stripe list failure does not skip the pack cap");
assert.ok(stripeSrc.includes("reverse reconciled subscription failed"), "reverse failure does not skip the pack cap");
assert.ok(stripeSrc.includes("normalizeUserId(owner)"), "Checkout Barleezy and Ian are the same wallet");

const subscribePage = readFileSync(new URL("../app/subscribe/page.tsx", import.meta.url), "utf8");
assert.ok(subscribePage.includes("await connection()"), "subscribe page reads live Stripe price env");
assert.ok(subscribePage.includes("SubscribeClient"), "subscribe page renders client");
assert.ok(subscribePage.includes("SUBSCRIPTION_PLAN"), "subscribe shows monthly plan");
assert.ok(subscribePage.includes("readIncomingAuthSession"), "subscribe HTML uses shared session helper");

const subscribeClient = readFileSync(new URL("../app/subscribe/subscribe-client.tsx", import.meta.url), "utf8");
assert.ok(subscribeClient.includes("/api/checkout/subscribe"), "subscribe posts subscription checkout");
assert.ok(subscribeClient.includes('credentials: "include"'), "subscribe checkout sends session cookie");
assert.ok(subscribeClient.includes("Subscribe"), "subscribe button");
assert.ok(!subscribeClient.includes("/?next=/subscribe"), "unsigned subscribe stays on /subscribe");
assert.ok(!subscribeClient.includes('window.location.href = "/"'), "subscribe does not send users home");
assert.ok(subscribeClient.includes("Sign in to subscribe"), "unsigned subscribe shows sign-in");

const subscribeApi = readFileSync(new URL("../app/api/checkout/subscribe/route.ts", import.meta.url), "utf8");
assert.ok(subscribeApi.includes("createSubscriptionCheckout"), "subscribe route creates subscription");
assert.ok(subscribeApi.includes("await requireAuthSessionUserId"), "subscribe uses shared session helper");
assert.ok(subscribeApi.includes("console.error"), "subscribe route logs checkout failures");
assert.ok(subscribeApi.includes("console.warn"), "subscribe route logs unsigned 401");
assert.ok(!subscribeApi.includes("iosReturn"), "subscribe route has no iosReturn");
assert.ok(!subscribeApi.includes("client"), "subscribe route ignores client:ios");

const headerSrc = readFileSync(new URL("../components/site-header.tsx", import.meta.url), "utf8");
assert.ok(headerSrc.includes("Manage subscription"), "header shows Manage subscription when subscribed");
assert.ok(headerSrc.includes('href={signedIn ? "/account" : "/"}'), "signed-in header Account goes to /account");
assert.ok(headerSrc.includes('subscribed ? "/account" : "/subscribe"'), "header Subscribe follows billing status");

const layoutSrc = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
assert.ok(layoutSrc.includes("readIncomingAuthSession"), "layout reads the session cookie");
assert.ok(!layoutSrc.includes("readStoredSubscribed"), "layout does not wait on a subscription DB read");
assert.ok(!layoutSrc.includes("subscribed={subscribed}"), "layout does not pass subscribed from Neon");

const accountPage = readFileSync(new URL("../app/account/page.tsx", import.meta.url), "utf8");
assert.ok(accountPage.includes("creditPaidCheckoutsForUser"), "account credits paid packs before showing minutes");
assert.ok(accountPage.includes("readIncomingAuthSession"), "account page uses shared session helper");
assert.ok(accountPage.includes("readAccountSubscribed"), "account page loads subscription status");
assert.ok(accountPage.includes("readAllottedVoiceSeconds"), "account page loads allotted minute balance");
assert.ok(accountPage.includes("findAccountRow"), "account page loads email");
assert.ok(accountPage.includes("AccountClient"), "account page renders client");
assert.ok(accountPage.includes("cancelAtPeriodEnd"), "account page passes cancel state");
assert.ok(accountPage.includes('force-dynamic'), "account page is not statically cached");
assert.ok(accountPage.includes("await connection()"), "account page reads live minutes");

const accountClient = readFileSync(new URL("../app/account/account-client.tsx", import.meta.url), "utf8");
assert.ok(accountClient.includes("/api/billing/balance"), "account page refreshes live minutes");
assert.ok(accountClient.includes("liveMinutes"), "account shows the live minute label");
assert.ok(accountClient.includes("Cancel subscription"), "account has cancel button");
assert.ok(accountClient.includes("/api/billing/cancel"), "account cancel posts to billing cancel");
assert.ok(accountClient.includes("active") && accountClient.includes("none"), "account shows active or none");
assert.ok(accountClient.includes("Sign in"), "unsigned account shows sign-in");
assert.ok(accountClient.includes('href="/"'), "unsigned account can go home");

const cancelApi = readFileSync(new URL("../app/api/billing/cancel/route.ts", import.meta.url), "utf8");
assert.ok(cancelApi.includes("requireAuthSessionUserId"), "cancel uses shared session helper");
assert.ok(cancelApi.includes("cancelAccountSubscriptionAtPeriodEnd"), "cancel uses period-end helper");
assert.ok(cancelApi.includes("POST"), "cancel is POST");

assert.ok(stripeSrc.includes("cancel_at_period_end: true"), "Stripe cancel is at period end");
assert.ok(stripeSrc.includes("cancelAccountSubscriptionAtPeriodEnd"), "stripe helper cancels at period end");

assert.equal(SUBSCRIPTION_PLAN.minutes, 150);
assert.equal(SUBSCRIPTION_PLAN.seconds, 9000);
assert.equal(SUBSCRIPTION_PLAN.cadence, "per month");
assert.ok(packsSrc.includes("STRIPE_PRICE_SUBSCRIPTION"), "subscription price env");
assert.ok(packsSrc.includes("minutes: 150"), "Lexi Pro is 150 minutes per month");
assert.ok(packsSrc.includes("seconds: 9000"), "Lexi Pro is 9000 seconds");
assert.ok(!packsSrc.includes("per day"), "subscription is not a daily grant");
assert.ok(homeSrc.includes('href="/subscribe"'), "home nav links to /subscribe");
const footerSrc = readFileSync(new URL("../components/site-footer.tsx", import.meta.url), "utf8");
assert.ok(footerSrc.includes('href: "/refund"') || footerSrc.includes('href="/refund"'), "site footer links to /refund");
assert.ok(footerSrc.includes("Refunds"), "site footer labels Refunds");
assert.ok(footerSrc.includes('href: "/privacy"') || footerSrc.includes('href="/privacy"'), "site footer links to /privacy");
assert.ok(footerSrc.includes("Privacy"), "site footer labels Privacy");
assert.ok(footerSrc.includes('href: "/terms"') || footerSrc.includes('href="/terms"'), "site footer links to /terms");
assert.ok(footerSrc.includes("Terms"), "site footer labels Terms");
assert.ok(footerSrc.includes('href: "/support"') || footerSrc.includes('href="/support"'), "site footer links to /support");
assert.ok(footerSrc.includes("Support"), "site footer labels Support");
assert.ok(footerSrc.includes('href: "/site"') || footerSrc.includes('href="/site"'), "site footer links to /site");
assert.ok(footerSrc.includes("Site"), "site footer labels Site");
assert.ok(headerSrc.includes('href="/subscribe"') || headerSrc.includes('"/subscribe"'), "buy/subscribe chrome links Subscribe");
assert.ok(footerSrc.includes('href: "/refund"') || footerSrc.includes('href="/refund"'), "buy chrome footer links to Refunds");
assert.ok(footerSrc.includes('href: "/privacy"') || footerSrc.includes('href="/privacy"'), "buy chrome footer links to Privacy");
assert.ok(footerSrc.includes('href: "/terms"') || footerSrc.includes('href="/terms"'), "buy chrome footer links to Terms");
assert.ok(footerSrc.includes('href: "/support"') || footerSrc.includes('href="/support"'), "buy chrome footer links to Support");

const refundPage = readFileSync(new URL("../app/refund/page.tsx", import.meta.url), "utf8");
assert.ok(refundPage.includes("Refund and Return Policy"), "refund title");
assert.ok(refundPage.includes("Effective date: September 17, 2026"), "refund effective date");
assert.ok(refundPage.includes("barleezy@talktolexi.app"), "refund support email");
assert.ok(!refundPage.includes("support@talktolexi.app"), "refund does not use old support inbox");
assert.ok(!refundPage.includes("readIncomingAuthSession"), "refund is not behind sign-in");
assert.ok(!refundPage.includes("/api/checkout"), "refund has no checkout");
assert.ok(!refundPage.includes("createCheckout"), "refund has no Stripe checkout");
assert.ok(refundPage.includes("Talk to Lexi sells digital access only"), "refund intro copy");

const refundsAlias = readFileSync(new URL("../app/refunds/page.tsx", import.meta.url), "utf8");
assert.ok(refundsAlias.includes('../refund/page'), " /refunds aliases /refund");
const returnPolicyAlias = readFileSync(new URL("../app/return-policy/page.tsx", import.meta.url), "utf8");
assert.ok(returnPolicyAlias.includes('../refund/page'), "/return-policy aliases /refund");

assert.ok(footerSrc.includes('href: "/refund"') || footerSrc.includes('href="/refund"'), "subscribe chrome footer links to Refunds");
assert.ok(footerSrc.includes('href: "/privacy"') || footerSrc.includes('href="/privacy"'), "subscribe chrome footer links to Privacy");
assert.ok(footerSrc.includes('href: "/terms"') || footerSrc.includes('href="/terms"'), "subscribe chrome footer links to Terms");
assert.ok(footerSrc.includes('href: "/support"') || footerSrc.includes('href="/support"'), "subscribe chrome footer links to Support");
assert.ok(footerSrc.includes('href: "/privacy"') || footerSrc.includes('href="/privacy"'), "refund chrome footer links to Privacy");
assert.ok(footerSrc.includes('href: "/terms"') || footerSrc.includes('href="/terms"'), "refund chrome footer links to Terms");
assert.ok(footerSrc.includes('href: "/support"') || footerSrc.includes('href="/support"'), "refund chrome footer links to Support");

const privacyPage = readFileSync(new URL("../app/privacy/page.tsx", import.meta.url), "utf8");
assert.ok(privacyPage.includes("Privacy Policy"), "privacy title");
assert.ok(privacyPage.includes("Effective date: September 17, 2026"), "privacy effective date");
assert.ok(privacyPage.includes("support@talktolexi.app"), "privacy support email");
assert.ok(!privacyPage.includes("readIncomingAuthSession"), "privacy is not behind sign-in");
assert.ok(!privacyPage.includes("redirect"), "privacy is public");
assert.ok(!privacyPage.includes("/api/checkout"), "privacy has no checkout");
assert.ok(!privacyPage.includes("createCheckout"), "privacy has no Stripe checkout");
assert.ok(privacyPage.includes("Talk to Lexi is operated by Ian Barlow"), "privacy intro copy");

const termsPage = readFileSync(new URL("../app/terms/page.tsx", import.meta.url), "utf8");
assert.ok(termsPage.includes("Terms of Service"), "terms title");
assert.ok(termsPage.includes("Effective date: September 17, 2026"), "terms effective date");
assert.ok(termsPage.includes("support@talktolexi.app"), "terms support email");
assert.ok(termsPage.includes("/refund"), "terms mentions /refund");
assert.ok(termsPage.includes("/privacy"), "terms mentions /privacy");
assert.ok(!termsPage.includes("readIncomingAuthSession"), "terms is not behind sign-in");
assert.ok(!termsPage.includes("redirect"), "terms is public");
assert.ok(!termsPage.includes("/api/checkout"), "terms has no checkout");
assert.ok(!termsPage.includes("createCheckout"), "terms has no Stripe checkout");

const supportPage = readFileSync(new URL("../app/support/page.tsx", import.meta.url), "utf8");
assert.ok(supportPage.includes("Support"), "support title");
assert.ok(supportPage.includes("Questions, billing, or a broken call — email Ian."), "support intro");
assert.ok(supportPage.includes("barleezy@talktolexi.app"), "support email");
assert.ok(!supportPage.includes("support@talktolexi.app"), "support does not use old support inbox");
assert.ok(!supportPage.includes("readIncomingAuthSession"), "support is not behind sign-in");
assert.ok(!supportPage.includes("redirect"), "support is public");
assert.ok(!supportPage.includes("<form"), "support has no form");
assert.ok(!supportPage.includes("fetch("), "support has no fetch");
assert.ok(!/ticket/i.test(supportPage), "support has no ticket");
assert.ok(supportPage.includes('href="/refund"'), "support links to /refund");
assert.ok(supportPage.includes('href="/privacy"'), "support links to /privacy");
assert.ok(supportPage.includes('href="/terms"'), "support links to /terms");
assert.ok(supportPage.includes('href="/buy"'), "support links to /buy");
assert.ok(supportPage.includes('href="/subscribe"'), "support links to /subscribe");

const helpAlias = readFileSync(new URL("../app/help/page.tsx", import.meta.url), "utf8");
assert.ok(helpAlias.includes("../support/page"), "/help aliases /support");
const contactAlias = readFileSync(new URL("../app/contact/page.tsx", import.meta.url), "utf8");
assert.ok(contactAlias.includes("../support/page"), "/contact aliases /support");

const sitePage = readFileSync(new URL("../app/site/page.tsx", import.meta.url), "utf8");
assert.ok(sitePage.includes(">Site<") || sitePage.includes("Site"), "site title");
assert.ok(sitePage.includes("Every public page on Talk to Lexi."), "site intro");
assert.ok(!sitePage.includes("readIncomingAuthSession"), "site is not behind sign-in");
assert.ok(!sitePage.includes("redirect"), "site is public");
assert.ok(!sitePage.includes("/api/checkout"), "site has no checkout");
assert.ok(sitePage.includes('href="/"'), "site links Home /");
assert.ok(sitePage.includes('href="/buy"'), "site links Buy minutes");
assert.ok(sitePage.includes('href="/buy/success"'), "site links Checkout success");
assert.ok(sitePage.includes('href="/subscribe"'), "site links Subscribe");
assert.ok(sitePage.includes('href="/account"'), "site links Account");
assert.ok(sitePage.includes("Account"), "site labels Account");
assert.ok(sitePage.includes('href="/support"'), "site links Support");
assert.ok(sitePage.includes('href="/help"'), "site links Help");
assert.ok(sitePage.includes('href="/contact"'), "site links Contact");
assert.ok(sitePage.includes('href="/refund"'), "site links Refunds");
assert.ok(sitePage.includes('href="/refunds"'), "site links Refunds alias");
assert.ok(sitePage.includes('href="/return-policy"'), "site links Return policy");
assert.ok(sitePage.includes('href="/privacy"'), "site links Privacy");
assert.ok(sitePage.includes('href="/terms"'), "site links Terms");
assert.ok(sitePage.includes('href="/site"'), "site links Site");
assert.ok(sitePage.includes('href="/directory"'), "site links Directory");
assert.ok(sitePage.includes('href="/links"'), "site links Links");
assert.ok(sitePage.includes("Home"), "site labels Home");
assert.ok(sitePage.includes("Buy minutes"), "site labels Buy minutes");
assert.ok(sitePage.includes("Checkout success"), "site labels Checkout success");
assert.ok(sitePage.includes("Subscribe"), "site labels Subscribe");
assert.ok(sitePage.includes("Support"), "site labels Support");
assert.ok(sitePage.includes("Help"), "site labels Help");
assert.ok(sitePage.includes("Contact"), "site labels Contact");
assert.ok(sitePage.includes("Refunds (alias)"), "site labels Refunds alias");
assert.ok(sitePage.includes("Return policy"), "site labels Return policy");
assert.ok(sitePage.includes("Directory"), "site labels Directory");
assert.ok(sitePage.includes("Links"), "site labels Links");

const directoryAlias = readFileSync(new URL("../app/directory/page.tsx", import.meta.url), "utf8");
assert.ok(directoryAlias.includes("../site/page"), "/directory aliases /site");
const linksAlias = readFileSync(new URL("../app/links/page.tsx", import.meta.url), "utf8");
assert.ok(linksAlias.includes("../site/page"), "/links aliases /site");

assert.ok(footerSrc.includes('href: "/site"') || footerSrc.includes('href="/site"'), "site footer links to Site");
assert.ok(footerSrc.includes("Site"), "site footer labels Site");
assert.ok(sitePage.includes("Site"), "site page labels Site");

const checkoutRoute = readFileSync(new URL("../app/api/billing/checkout/route.ts", import.meta.url), "utf8");
assert.ok(checkoutRoute.includes("packId"), "legacy checkout takes packId");
assert.ok(!checkoutRoute.includes("body.seconds"), "checkout ignores client seconds");

// Tiny HMAC session check mirrored from lib/auth/session.ts
function sign(userId, nowMs, secret) {
  const body = Buffer.from(JSON.stringify({ userId, exp: Math.floor(nowMs / 1000) + 100, v: 1 })).toString(
    "base64url",
  );
  const sig = createHmac("sha256", secret).update(`web:${body}`).digest("base64url");
  return `${body}.${sig}`;
}
function verify(token, nowMs, secret) {
  const dot = token.lastIndexOf(".");
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(`web:${payload}`).digest("base64url");
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  if (body.exp * 1000 <= nowMs) return null;
  return body.userId;
}
const tok = sign("Ian", 1000, "secret");
assert.equal(verify(tok, 2000, "secret"), "Ian");
assert.equal(verify(tok, 1_000_000_000_000, "secret"), null);

const memory = {};
const local = {};
globalThis.sessionStorage = {
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  },
  setItem(key, value) {
    memory[key] = String(value);
  },
  removeItem(key) {
    delete memory[key];
  },
};
globalThis.localStorage = {
  getItem(key) {
    return Object.prototype.hasOwnProperty.call(local, key) ? local[key] : null;
  },
  setItem(key, value) {
    local[key] = String(value);
  },
  removeItem(key) {
    delete local[key];
  },
};

assert.equal(VOICE_STORAGE_KEYS.previousSessionId, "lexi.previousSessionId");
writePreviousSessionId("2f1c8a6e-4b0d-4a11-9c3e-7a1b2c3d4e5f");
assert.equal(readPreviousSessionId(), "2f1c8a6e-4b0d-4a11-9c3e-7a1b2c3d4e5f");
assert.equal(local["lexi.previousSessionId"], "2f1c8a6e-4b0d-4a11-9c3e-7a1b2c3d4e5f");
writeVoiceSessionStore({ userId: "Ian", sessionId: "2f1c8a6e-4b0d-4a11-9c3e-7a1b2c3d4e5f", started: true });
clearCallContinuityStore();
assert.equal(readPreviousSessionId(), null);
assert.equal(readVoiceSessionStore().sessionId, null);
assert.equal(readVoiceSessionStore().userId, "Ian", "hangup keeps userId for facts");
assert.equal(readVoiceSessionStore().rows.length, 0);

const chatRoute = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8");
const chatReply = readFileSync(new URL("../lib/chat/reply.ts", import.meta.url), "utf8");
assert.ok(chatRoute.includes("replyInAppChat"), "text chat uses replyInAppChat");
assert.ok(chatRoute.includes("requireAuthSessionUserId"), "text chat requires auth");
assert.ok(!/grok-voice/i.test(chatRoute), "text chat never mentions grok-voice");
assert.ok(!chatRoute.includes("mintXaiClientSecret"), "text chat does not mint a voice client_secret");
assert.ok(!chatRoute.includes("placeVoiceHold"), "text chat does not place a wallet hold");
assert.ok(!chatRoute.includes("wss://"), "text chat does not open the realtime WebSocket");
assert.ok(chatReply.includes("textFastModelFromEnv"), "in-app text uses TEXT_FAST_MODEL");
assert.ok(chatReply.includes("TEXT_FAST_MAX_TOKENS"), "in-app text uses TEXT_FAST_MAX_TOKENS");
assert.ok(chatReply.includes("buildInstructions"), "in-app text uses shared persona instructions");
assert.ok(!/grok-voice/i.test(chatReply), "in-app text never mentions grok-voice");
assert.ok(!chatReply.includes("mintXaiClientSecret"), "in-app text does not mint a voice client_secret");
assert.ok(!chatReply.includes("placeVoiceHold"), "in-app text does not place a wallet hold");
assert.ok(!chatRoute.includes("placeVoiceHold"), "chat route does not place a voice hold");

assert.ok(homeSrc.includes('useState<ChatMode>("voice")'), "home defaults to voice");
assert.ok(homeSrc.includes('setChatMode("text")'), "home can enter text mode");
assert.ok(homeSrc.includes('aria-label="Chat mode"'), "home has a first-class text/voice control");
assert.ok(homeSrc.includes("if (text && !liveSession)"), "idle composer send is text chat");
assert.ok(homeSrc.includes('fetch("/api/chat"'), "home text mode posts /api/chat");
assert.ok(homeSrc.includes("enterTextModeSilently"), "home silently falls back to text");
assert.ok(homeSrc.includes("logVoiceConnectFailure"), "home logs voice connect failures");
assert.ok(homeSrc.includes("onConnectFail"), "home handles connect fail without a user-facing voice error");
assert.ok(!homeSrc.includes("Send and start talking"), "idle send is text, not start talking");
assert.ok(!homeSrc.includes("No reply from Lexi"), "home does not show No reply from Lexi");
assert.ok(!homeSrc.includes("Voice link timed out"), "home does not show Voice link timed out");
assert.ok(!homeSrc.includes("Try Connect again"), "home does not show Try Connect again");

assert.ok(iosController.includes("enum ChatMode"), "iOS has first-class text mode");
assert.ok(iosController.includes("enterTextModeSilently"), "iOS silently falls back to text");
assert.ok(iosController.includes("sendTextChat"), "iOS text send uses the text path");
assert.ok(iosController.includes("sendChat"), "iOS posts the text chat API");
assert.ok(!iosController.includes('lastError = "Voice link did not open."'), "iOS sendText does not dead-end on connect fail");
assert.ok(!iosController.includes('lastError = "Voice auth failed. Try Connect again."'), "iOS does not show auth connect errors");
assert.ok(!iosController.includes('lastError = "Microphone access is required to talk to Lexi."'), "iOS mic denial falls back to text");
assert.ok(!iosController.includes('lastError = "Out of minutes."'), "iOS 402 does not set lastError after fallback");
{
  const sendTextFn = iosController.slice(
    iosController.indexOf("func sendText("),
    iosController.indexOf("private func sendTextChat("),
  );
  assert.ok(sendTextFn.includes("sendTextChat"), "iOS idle send uses text chat");
  assert.ok(!sendTextFn.includes("connectCall()"), "iOS text send does not start voice");
}

assert.ok(iosClient.includes("/api/chat"), "iOS API client posts /api/chat");
assert.ok(iosClient.includes("func sendChat"), "iOS API client has sendChat");
assert.ok(iosClient.includes("/api/voice/log"), "iOS logs voice connect failures server-side");
assert.ok(iosClient.includes("func logVoiceFailure"), "iOS API client has logVoiceFailure");

const voiceLogRoute = readFileSync(new URL("../app/api/voice/log/route.ts", import.meta.url), "utf8");
assert.ok(voiceLogRoute.includes("connect.fail"), "voice log accepts connect failures");
assert.ok(voiceLogRoute.includes("requireAuthSessionUserId"), "connect-fail logs are authenticated");
assert.ok(voiceLogRoute.includes("[voice.connect]"), "connect failures go to server logs");

const connectFailSrc = readFileSync(new URL("../lib/voice/connect-fail.ts", import.meta.url), "utf8");
assert.ok(connectFailSrc.includes("isVoiceConnectFailure"), "shared connect-fail helper");
assert.equal(isVoiceConnectFailure("Out of minutes."), false);
assert.equal(isVoiceConnectFailure("Voice link timed out."), true);

console.log("wallet checks ok");
