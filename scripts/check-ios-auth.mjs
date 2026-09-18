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
expect(IOS_REALTIME_URL === "wss://api.x.ai/v1/realtime?model=grok-voice-think-fast-1.0", "realtime url");
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
expect(chrome.includes("{isHome || isWatch || isIosAuth || isAndroidAuth ? null : <SiteFooter />}"), "home and native sign-in have no website footer");
expect(chrome.includes("isHome || isWatch || isIosAuth || isAndroidAuth"), "ios and android sign-in have no website header");

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
expect(iosSession.includes("SESSION_LIMIT_CODE"), "iOS session extend honors duration/spend limits");
expect(iosSession.includes("maxDurationSeconds"), "iOS session returns the 30-minute cap");

const mintSrc = readFileSync(new URL("../lib/xai/client-secret.ts", import.meta.url), "utf8");
expect(mintSrc.includes("REALTIME_VOICE_MODEL"), "client secret binds the pinned voice model");
expect(mintSrc.includes('effort: "none"'), "client secret pins reasoning off");

const iosClient = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Shared/API/LexiAPIClient.swift", import.meta.url),
  "utf8",
);
expect(iosClient.includes('static let model = "grok-voice-think-fast-1.0"'), "iOS hardcodes the pinned model");
expect(iosClient.includes("for attempt in 1...5"), "iOS settle retries");
expect(iosClient.includes("billingBalance"), "iOS reads GET /api/billing/balance");
expect(iosClient.includes("/api/billing/balance"), "iOS balance uses the existing path");
expect(!iosClient.includes("startPackCheckout"), "iOS does not create pack Checkout sessions");
expect(!iosClient.includes("startSubscribeCheckout"), "iOS does not create subscribe Checkout sessions");
expect(!iosClient.includes('"client": "ios"'), "iOS does not send client:ios");
expect(!iosClient.includes("/api/checkout"), "iOS does not POST /api/checkout");

const iosController = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/App/LexiAppController.swift", import.meta.url),
  "utf8",
);
expect(iosController.includes('openSitePath("/buy")'), "iOS Buy minutes opens /buy");
expect(iosController.includes('openSitePath("/subscribe")'), "iOS Subscribe opens /subscribe");
expect(iosController.includes('openSitePath("/account")'), "iOS Manage account opens /account");
expect(iosController.includes("account.apiHost"), "iOS site URLs use AccountStore.apiHost");
expect(iosController.includes("UIApplication.shared.open"), "iOS opens Safari");
expect(iosController.includes("refreshBilling"), "iOS refreshes minutes after return");
expect(iosController.includes("scheduleLaunchWork"), "iOS defers billing/channels until after first frame");
expect(!iosController.includes("openCheckout"), "iOS does not start in-app Stripe checkout");
expect(!iosController.includes("Product.purchase"), "iOS does not call StoreKit IAP");

const iosSettings = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Settings/SettingsView.swift", import.meta.url),
  "utf8",
);
expect(iosSettings.includes("Buy minutes"), "settings Buy minutes button");
expect(iosSettings.includes("Subscribe"), "settings Subscribe button");
expect(iosSettings.includes("Manage account"), "settings Manage account button");

expect(!signIn.includes("openCheckout"), "sign-in coordinator does not open checkout");
expect(!signIn.includes("talktolexi://billing"), "no billing callback scheme");

const musicSrc = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Music/MusicController.swift", import.meta.url),
  "utf8",
);
expect(!musicSrc.includes("import StoreKit"), "iOS MusicController does not import StoreKit");
expect(!musicSrc.includes("import MusicKit"), "iOS MusicController does not import MusicKit");
expect(!musicSrc.includes("ApplicationMusicPlayer"), "iOS MusicController does not use MusicKit playback");

const iosHome = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Voice/VoiceHomeView.swift", import.meta.url),
  "utf8",
);
expect(iosHome.includes("ComposerBar("), "iOS home always shows ComposerBar");
expect(!iosHome.includes("WatchURLField"), "iOS home has no WatchURLField");
expect(!iosHome.includes("paste a video URL"), "iOS home has no video URL paste field");
expect(iosHome.includes("Share screen"), "iOS home has Share screen on the composer chrome");
expect(iosController.includes("toggleScreenShare"), "iOS Share screen starts ReplayKit capture");
const screenSrc = readFileSync(
  new URL("../ios/TalkToLexi/TalkToLexi/Features/Vision/ScreenCaptureController.swift", import.meta.url),
  "utf8",
);
expect(screenSrc.includes("import ReplayKit"), "iOS screen share uses ReplayKit");
expect(screenSrc.includes("RPScreenRecorder"), "iOS screen share starts RPScreenRecorder");
expect(screenSrc.includes("sendVisionFrame") || iosController.includes('source: "screen"'), "screen frames go out on the voice socket");
expect(!iosHome.includes("Connect Apple Music"), "iOS home has no Connect Apple Music pill");
expect(!iosHome.includes("MusicBarView"), "iOS home has no Apple Music bar");
expect(!iosHome.includes("routeThroughPS5PartyChat"), "iOS home has no PS5 party-chat status");
expect(!iosSettings.includes("Route through PS5"), "settings has no PS5 party-chat toggle");
expect(!iosSettings.includes("partyChat"), "settings has no party-chat card");
expect(!iosSettings.includes("psnOnlineId"), "settings has no PSN account fields");
expect(!iosController.includes("routeThroughPS5PartyChat"), "iOS controller has no PS5 routing");
expect(!iosController.includes("psnOnlineId"), "iOS controller has no PSN identity");
expect(iosController.includes("chatMode: ChatMode = .text"), "iOS defaults to text mode");

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

const sendTextFn = iosController.slice(
  iosController.indexOf("func sendText("),
  iosController.indexOf("private func sendTextChat("),
);
expect(sendTextFn.includes("sendTextChat"), "idle send uses text chat");
expect(!sendTextFn.includes("connectCall()"), "text send does not start voice");
expect(iosController.includes("enterTextModeSilently"), "voice failure falls back to text");
expect(iosController.includes("lastError = \"\""), "fallback clears lastError");
expect(!iosController.includes('lastError = "Voice link did not open."'), "no blocking voice-link copy");
expect(!iosController.includes('lastError = "Out of minutes."'), "402 does not set lastError after fallback");
expect(iosClient.includes("/api/chat"), "iOS text chat path");
expect(iosClient.includes("logVoiceFailure"), "iOS logs voice fallback server-side");
expect(!iosClient.includes("mintXaiClientSecret"), "iOS text chat does not mint realtime tokens");

expect(iosController.includes("enum ChatMode"), "iOS has first-class text mode");
expect(iosController.includes("sendTextChat"), "iOS text send uses the text path");
expect(!iosController.includes('lastError = "Voice auth failed. Try Connect again."'), "iOS does not show auth connect errors");
expect(iosClient.includes("func sendChat"), "iOS API client has sendChat");
expect(iosClient.includes("/api/voice/log"), "iOS logs voice connect failures");
expect(!realtimeSwift.includes("No reply from Lexi. Try again."), "iOS does not surface No reply from Lexi");
expect(realtimeSwift.includes("func appendLocal") || iosController.includes("appendTextRow"), "iOS can append text-mode rows without a live socket");

console.log("ios auth ok");
