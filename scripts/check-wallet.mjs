import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { TEXT_FAST_MODEL, TEXT_FAST_MAX_TOKENS, textFastModelFromEnv } from "../lib/wallet/models.ts";
import { VOICE_PACKS, publicPacks, voicePackById, STRIPE_WEBHOOK_URL } from "../lib/wallet/packs.ts";
import { DEFAULT_CHAT_MODEL, chatModelFromEnv } from "../lib/channels/parse.ts";
import { VIDEO_CONTEXT_MODEL, VIDEO_CONTEXT_MAX_TOKENS } from "../lib/voice/video-context.ts";
import { IOS_REALTIME_URL } from "../lib/ios/config.ts";
import {
  clearCallContinuityStore,
  readPreviousSessionId,
  readVoiceSessionStore,
  VOICE_STORAGE_KEYS,
  writePreviousSessionId,
  writeVoiceSessionStore,
} from "../lib/voice/persist.ts";

const REALTIME_VOICE_MODEL = "grok-voice-latest";
const REALTIME_VOICE_URL = `wss://api.x.ai/v1/realtime?model=${REALTIME_VOICE_MODEL}`;

function assertRealtimeVoiceModel(url) {
  if (!url.includes(`model=${REALTIME_VOICE_MODEL}`)) {
    throw new Error(`Realtime URL must use model=${REALTIME_VOICE_MODEL}`);
  }
  if (/grok-4-1-fast|grok-4\.|chat\/completions/i.test(url)) {
    throw new Error("Text models must not be used on the realtime WebSocket URL");
  }
}

assert.equal(REALTIME_VOICE_MODEL, "grok-voice-latest");
assert.equal(REALTIME_VOICE_URL, "wss://api.x.ai/v1/realtime?model=grok-voice-latest");
assert.equal(IOS_REALTIME_URL, "wss://api.x.ai/v1/realtime?model=grok-voice-latest");
assertRealtimeVoiceModel(REALTIME_VOICE_URL);
assertRealtimeVoiceModel(IOS_REALTIME_URL);
assert.throws(() => assertRealtimeVoiceModel("wss://api.x.ai/v1/realtime?model=grok-4-1-fast-reasoning"));
assert.throws(() => assertRealtimeVoiceModel("wss://api.x.ai/v1/realtime?model=grok-4.6"));

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

const buyPage = readFileSync(new URL("../app/buy/page.tsx", import.meta.url), "utf8");
assert.ok(!buyPage.includes("redirect"), "buy catalog is public");
assert.ok(buyPage.includes("buyPagePacks"), "buy always loads packs");
assert.ok(buyPage.includes("BuyClient"), "buy renders pack client");
assert.ok(buyPage.includes("readIncomingAuthSession"), "buy HTML uses shared session helper");

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
assert.ok(homeSrc.includes("catalogPacks"), "home receives public catalog");
assert.ok(homeSrc.includes("Buy minutes"), "home always offers Buy minutes");
assert.ok(!homeSrc.includes("useState(() => new Date())"), "LiveClock does not SSR a wall clock");

const homePage = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
assert.ok(homePage.includes("buyPagePacks"), "home server-renders catalog packs");

const balanceSrc = readFileSync(new URL("../app/api/billing/balance/route.ts", import.meta.url), "utf8");
assert.ok(balanceSrc.includes("buyPagePacks"), "balance returns buy packs");
assert.ok(balanceSrc.includes("requireAuthSessionUserId"), "balance uses shared session helper");
assert.ok(!balanceSrc.includes("searchParams.get(\"userId\")"), "balance does not require a claimed query userId");

const buySuccess = readFileSync(new URL("../app/buy/success/page.tsx", import.meta.url), "utf8");
assert.ok(buySuccess.includes("Minutes added"), "success copy");
assert.ok(buySuccess.includes('href="/"'), "success links to Call");

const checkoutApi = readFileSync(new URL("../app/api/checkout/route.ts", import.meta.url), "utf8");
assert.ok(checkoutApi.includes("priceId"), "checkout takes priceId");
assert.ok(checkoutApi.includes("createCheckoutByPriceId"), "checkout by price");
assert.ok(checkoutApi.includes("await requireAuthSessionUserId"), "checkout uses shared session helper");
assert.ok(!checkoutApi.includes("body.seconds"), "checkout ignores client seconds");

const resetSrc = readFileSync(new URL("../lib/auth/reset.ts", import.meta.url), "utf8");
assert.ok(resetSrc.includes('hostname === "talktolexi.app"'), "publicAppUrl remaps apex → www");
assert.ok(resetSrc.includes("www.talktolexi.app"), "publicAppUrl prefers www");

const nextConfigSrc = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
assert.ok(/trailingSlash:\s*false/.test(nextConfigSrc), "trailingSlash false avoids webhook 308");

const webhookRoute = readFileSync(new URL("../app/api/billing/webhook/route.ts", import.meta.url), "utf8");
assert.ok(webhookRoute.includes("export async function POST"), "webhook POST handler");
assert.ok(webhookRoute.includes("export async function GET"), "webhook GET probe");
assert.ok(webhookRoute.includes("www.talktolexi.app"), "webhook docs www URL");

const sessionSrc = readFileSync(new URL("../lib/auth/session.ts", import.meta.url), "utf8");
assert.ok(sessionSrc.includes('export const LEXI_SESSION_COOKIE = "lexi_session"'), "session cookie");
assert.ok(sessionSrc.includes("requireAuthSessionUserId"), "auth helper");
assert.ok(sessionSrc.includes('from "next/headers"'), "auth helper reads Next cookies like /buy");
assert.ok(sessionSrc.includes("readIncomingAuthSession"), "pages share cookies()+verifyAuthSession");
assert.ok(sessionSrc.includes("x-lexi-user-id is not auth") || sessionSrc.includes("not auth"), "docs");

const voiceSrc = readFileSync(new URL("../lib/wallet/voice.ts", import.meta.url), "utf8");
assert.ok(voiceSrc.includes("CREATE TABLE IF NOT EXISTS voice_sessions"), "voice_sessions table");
assert.ok(voiceSrc.includes("voice_seconds"), "voice_seconds column");
assert.ok(voiceSrc.includes("VOICE_HOLD_SECONDS = 90"), "hold 90");
assert.ok(voiceSrc.includes("VOICE_MIN_SECONDS = 30"), "min 30");
assert.ok(voiceSrc.includes("export async function extendVoiceHold"), "extend hold while leftover remains");
assert.ok(voiceSrc.includes("sweepStaleVoiceSessions"), "sweeper");
assert.ok(voiceSrc.includes("stripe_event_id"), "idempotent stripe event");

const realtimeSrc = readFileSync(new URL("../app/api/realtime/session/route.ts", import.meta.url), "utf8");
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
assert.ok(homeSrc.includes("? error"), "Out of minutes is not hidden by rehearsal copy");
assert.ok(homeSrc.includes("${callLeftSeconds}s left"), "live Call shows remaining time");

const iosClient = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Shared/API/LexiAPIClient.swift", import.meta.url),
  "utf8",
);
assert.ok(iosClient.includes('"Out of minutes."'), "iOS surfaces Out of minutes.");
assert.ok(iosClient.includes("extendRealtimeSession"), "iOS can extend the hold");
assert.ok(realtimeSrc.includes("extendVoiceHold"), "web mint can extend");

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
assert.ok(stripeSrc.includes("createCheckoutByPriceId"), "priceId checkout helper");
assert.ok(stripeSrc.includes("createSubscriptionCheckout"), "subscription checkout helper");
assert.ok(stripeSrc.includes('mode: "subscription"'), "subscription checkout is recurring");
assert.ok(stripeSrc.includes("session.metadata?.pack"), "webhook reads metadata.pack");

const subscribePage = readFileSync(new URL("../app/subscribe/page.tsx", import.meta.url), "utf8");
assert.ok(subscribePage.includes("SubscribeClient"), "subscribe page renders client");
assert.ok(subscribePage.includes("SUBSCRIPTION_PLAN"), "subscribe shows monthly plan");
assert.ok(subscribePage.includes("readIncomingAuthSession"), "subscribe HTML uses shared session helper");

const subscribeClient = readFileSync(new URL("../app/subscribe/subscribe-client.tsx", import.meta.url), "utf8");
assert.ok(subscribeClient.includes("/api/checkout/subscribe"), "subscribe posts subscription checkout");
assert.ok(subscribeClient.includes('credentials: "include"'), "subscribe checkout sends session cookie");
assert.ok(subscribeClient.includes("Subscribe"), "subscribe button");
assert.ok(subscribeClient.includes("/?next=/subscribe"), "unsigned subscribe asks to sign in");

const subscribeApi = readFileSync(new URL("../app/api/checkout/subscribe/route.ts", import.meta.url), "utf8");
assert.ok(subscribeApi.includes("createSubscriptionCheckout"), "subscribe route creates subscription");
assert.ok(subscribeApi.includes("await requireAuthSessionUserId"), "subscribe uses shared session helper");

assert.ok(packsSrc.includes("STRIPE_PRICE_SUBSCRIPTION"), "subscription price env");
assert.ok(homeSrc.includes('href="/subscribe"'), "home nav links to /subscribe");
assert.ok(homeSrc.includes('href="/refund"'), "home nav links to /refund");
assert.ok(homeSrc.includes("Refunds"), "home nav labels Refunds");
assert.ok(homeSrc.includes('href="/privacy"'), "home nav links to /privacy");
assert.ok(homeSrc.includes("Privacy"), "home nav labels Privacy");
assert.ok(homeSrc.includes('href="/terms"'), "home nav links to /terms");
assert.ok(homeSrc.includes("Terms"), "home nav labels Terms");
assert.ok(homeSrc.includes('href="/support"'), "home nav links to /support");
assert.ok(homeSrc.includes("Support"), "home nav labels Support");
assert.ok(buyClient.includes('href="/subscribe"'), "buy page links to /subscribe");
assert.ok(buyClient.includes('href="/refund"'), "buy footer links to Refunds");
assert.ok(buyClient.includes('href="/privacy"'), "buy footer links to Privacy");
assert.ok(buyClient.includes('href="/terms"'), "buy footer links to Terms");
assert.ok(buyClient.includes('href="/support"'), "buy footer links to Support");

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

assert.ok(subscribeClient.includes('href="/refund"'), "subscribe footer links to Refunds");
assert.ok(subscribeClient.includes('href="/privacy"'), "subscribe footer links to Privacy");
assert.ok(subscribeClient.includes('href="/terms"'), "subscribe footer links to Terms");
assert.ok(subscribeClient.includes('href="/support"'), "subscribe footer links to Support");
assert.ok(refundPage.includes('href="/privacy"'), "refund footer links to Privacy");
assert.ok(refundPage.includes('href="/terms"'), "refund footer links to Terms");
assert.ok(refundPage.includes('href="/support"'), "refund footer links to Support");

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

console.log("wallet checks ok");
