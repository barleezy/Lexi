import { readFileSync } from "node:fs";
import {
  describeSecret,
  voiceMintFailureMessage,
  xaiInferenceKey,
  xaiManagementApiKey,
  xaiTeamId,
} from "../lib/xai/env.ts";
import {
  IOS_AUTH_PATH,
  IOS_CALLBACK_SCHEMES,
  IOS_REALTIME_URL,
  IOS_TARGET_RATE,
  IOS_VOICE,
  callbackURLWithToken,
  parseCallbackURI,
  readXaiClientSecret,
  signIosToken,
  verifyIosToken,
} from "../lib/ios/config.ts";

function expect(condition, label) {
  if (!condition) throw new Error(label);
}

expect(IOS_AUTH_PATH === "/ios/signin", "signin path");
expect(IOS_CALLBACK_SCHEMES.includes("talktolexi"), "talktolexi scheme");
expect(IOS_CALLBACK_SCHEMES.includes("app.talktolexi.ios"), "bundle scheme");
expect(parseCallbackURI("talktolexi://auth")?.protocol === "talktolexi:", "parse talktolexi");
expect(parseCallbackURI("https://talktolexi.app/ios/signin") === null, "reject https callback");
expect(parseCallbackURI("talktolexi://user:pass@evil") === null, "reject userinfo");
expect(IOS_REALTIME_URL === "wss://api.x.ai/v1/realtime?model=grok-voice-latest", "realtime url");
expect(IOS_TARGET_RATE === 48_000, "pcm rate");
expect(IOS_VOICE === "aria", "voice");
expect(readXaiClientSecret({ value: "abc" }) === "abc", "secret value");
expect(readXaiClientSecret({ client_secret: { value: "xyz" } }) === "xyz", "nested secret");

const env = { IOS_SESSION_SECRET: "test-ios-secret" };
expect(signIosToken("", 1_000, env) === null, "refuse blank user");
const token = signIosToken("ian", 1_000, env);
expect(typeof token === "string" && token.includes("."), "signed token");
const verified = verifyIosToken(token, 2_000, env);
expect(verified?.userId === "Ian", "normalize Ian");
const barleezy = signIosToken("Barleezy", 1_000, env);
expect(verifyIosToken(barleezy, 2_000, env)?.userId === "Ian", "normalize Barleezy");
const alex = signIosToken("Alex", 1_000, env);
expect(verifyIosToken(alex, 2_000, env)?.userId === "Alex", "keep other user");
expect(verifyIosToken(token, 1_000 + 60 * 60 * 24 * 31 * 1000, env) === null, "expired");
expect(verifyIosToken(`${token}x`, 2_000, env) === null, "bad sig");
expect(
  callbackURLWithToken("talktolexi://auth", token, "Ian", "s1")?.includes("token="),
  "callback has token",
);

const chrome = readFileSync(new URL("../components/site-chrome.tsx", import.meta.url), "utf8");
expect(chrome.includes('pathname.startsWith("/ios/")'), "site chrome skips /ios auth");
expect(chrome.includes("{isIosAuth ? null : <SiteFooter />}"), "ios sign-in has no website footer");
expect(chrome.includes("isHome || isWatch || isIosAuth"), "ios sign-in has no website header");

const signIn = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Auth/SignInCoordinator.swift", import.meta.url),
  "utf8",
);
expect(!signIn.includes("SiteFooter"), "native sign-in does not import web footer");
expect(signIn.includes("ios/signin"), "native sign-in still opens /ios/signin");

const iosSession = readFileSync(new URL("../app/api/ios/session/route.ts", import.meta.url), "utf8");
expect(iosSession.includes("xaiInferenceKey"), "iOS mint reads live XAI_API_KEY");
expect(iosSession.includes("await connection()"), "iOS mint waits for runtime env");
expect(!iosSession.includes("process.env.XAI_API_KEY"), "iOS mint does not inline process.env.XAI_API_KEY");
expect(iosSession.includes("mintXaiClientSecret"), "iOS mint uses shared client-secret helper");
expect(iosSession.includes("@/lib/xai/client-secret"), "iOS mint shares the web client-secret helper");

const realtimeSwift = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Voice/RealtimeSession.swift", import.meta.url),
  "utf8",
);
expect(
  realtimeSwift.includes('webSocketTask(with: url, protocols: ["xai-client-secret.\\(token)"])'),
  "iOS WS uses the same client-secret subprotocol as web",
);
expect(
  !realtimeSwift.includes("setValue(\"xai-client-secret"),
  "iOS does not set the WS protocol as an HTTP header",
);

const envSrc = readFileSync(new URL("../lib/xai/env.ts", import.meta.url), "utf8");
expect(envSrc.includes('env[name]'), "runtime env uses dynamic lookup");
expect(envSrc.includes("XAI_MANAGEMENT_API_KEY"), "management key is named");
expect(envSrc.includes("Never fall back"), "inference and management keys stay separate");

const live = {
  XAI_API_KEY: "xai-live-inference",
  XAI_MANAGEMENT_API_KEY: "xai-mgmt",
  XAI_TEAM_ID: "team-1",
};
expect(xaiInferenceKey(live) === "xai-live-inference", "inference key is XAI_API_KEY");
expect(xaiManagementApiKey(live) === "xai-mgmt", "management key is separate");
expect(xaiTeamId(live) === "team-1", "team id from env");
expect(xaiInferenceKey({ XAI_MANAGEMENT_API_KEY: "xai-mgmt" }) === "", "inference never falls back to management");
expect(describeSecret("STRIPE_SECRET_KEY", "sk_test_abc").kind === "stripe_test", "detect stripe test key");
expect(describeSecret("STRIPE_SECRET_KEY", "sk_live_abc").kind === "stripe_live", "detect stripe live key");
expect(
  voiceMintFailureMessage("An internal error occurred").includes("live inference key"),
  "maps xAI internal error to inference-key hint",
);

console.log("ios auth ok");
