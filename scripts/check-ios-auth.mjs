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
const alex = signIosToken("Alex", 1_000, env);
expect(verifyIosToken(alex, 2_000, env)?.userId === "Alex", "keep other user");
expect(verifyIosToken(token, 1_000 + 60 * 60 * 24 * 31 * 1000, env) === null, "expired");
expect(verifyIosToken(`${token}x`, 2_000, env) === null, "bad sig");
expect(
  callbackURLWithToken("talktolexi://auth", token, "Ian", "s1")?.includes("token="),
  "callback has token",
);

console.log("ios auth ok");
