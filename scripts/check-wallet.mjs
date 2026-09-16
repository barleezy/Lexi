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
assert.equal(voicePackById("pack_30")?.seconds, 1800);
assert.equal(voicePackById("nope"), null);
assert.ok(publicPacks({}).every((p) => typeof p.seconds === "number"));
assert.equal(
  STRIPE_WEBHOOK_URL,
  "https://www.talktolexi.app/api/billing/webhook",
  "Stripe webhook must be www with no trailing slash",
);
assert.ok(!STRIPE_WEBHOOK_URL.includes("://talktolexi.app/"), "never apex host");
assert.ok(!STRIPE_WEBHOOK_URL.endsWith("/"), "no trailing slash");

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
assert.ok(sessionSrc.includes("x-lexi-user-id is not auth") || sessionSrc.includes("not auth"), "docs");

const voiceSrc = readFileSync(new URL("../lib/wallet/voice.ts", import.meta.url), "utf8");
assert.ok(voiceSrc.includes("CREATE TABLE IF NOT EXISTS voice_sessions"), "voice_sessions table");
assert.ok(voiceSrc.includes("voice_seconds"), "voice_seconds column");
assert.ok(voiceSrc.includes("VOICE_HOLD_SECONDS = 90"), "hold 90");
assert.ok(voiceSrc.includes("VOICE_MIN_SECONDS = 30"), "min 30");
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

const iosClient = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Shared/API/LexiAPIClient.swift", import.meta.url),
  "utf8",
);
assert.ok(iosClient.includes('"Out of minutes."'), "iOS surfaces Out of minutes.");

const stripeSrc = readFileSync(new URL("../lib/wallet/stripe.ts", import.meta.url), "utf8");
assert.ok(stripeSrc.includes("constructEvent"), "webhook verifies signature");
assert.ok(stripeSrc.includes("voicePackById"), "webhook remaps pack → seconds on server");
assert.ok(stripeSrc.includes("stripeEventId: event.id"), "idempotent on event id");
assert.ok(!/Number\(session\.metadata\?\.seconds\)/.test(stripeSrc), "webhook does not trust metadata seconds alone");
assert.ok(stripeSrc.includes("missing_checkout_metadata"), "test events without metadata return ok");
assert.ok(!stripeSrc.includes("Checkout metadata missing user/pack"), "missing metadata is not a 400");

const checkoutRoute = readFileSync(new URL("../app/api/billing/checkout/route.ts", import.meta.url), "utf8");
assert.ok(checkoutRoute.includes("packId"), "checkout takes packId");
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
