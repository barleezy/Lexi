import { createHmac, timingSafeEqual } from "crypto";

export const IOS_REALTIME_URL = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
export const IOS_TARGET_RATE = 48_000;
export const IOS_VOICE = "aria";
export const IOS_AUTH_PATH = "/ios/signin";
export const IOS_CALLBACK_SCHEMES = ["talktolexi", "app.talktolexi.ios"] as const;

type SecretBody = {
  value?: unknown;
  client_secret?: { value?: unknown } | string;
};

export const IOS_TOKEN_TTL_SEC = 60 * 60 * 24 * 30;

export function iosSigningSecret(env: NodeJS.ProcessEnv = process.env) {
  return env.IOS_SESSION_SECRET?.trim() || env.XAI_API_KEY?.trim() || "";
}

/** Same rule as lib/memory/user: blank stays blank; ian/Ian/IAN stay Ian. */
export function iosNormalizeUserId(raw?: string | null) {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "ian" || trimmed.toLowerCase() === "barleezy") return "Ian";
  return trimmed;
}

export function parseCallbackURI(raw: unknown) {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    const scheme = url.protocol.replace(/:$/, "");
    if (!(IOS_CALLBACK_SCHEMES as readonly string[]).includes(scheme)) return null;
    if (url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

export function callbackURLWithToken(
  redirectURI: string,
  token: string,
  userId: string,
  state?: string | null,
) {
  const url = parseCallbackURI(redirectURI);
  if (!url) return null;
  url.searchParams.set("token", token);
  url.searchParams.set("userId", userId);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

type TokenBody = {
  userId: string;
  exp: number;
  v: number;
};

export function signIosToken(
  userId: string,
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const secret = iosSigningSecret(env);
  if (!secret) return null;
  const signedUserId = iosNormalizeUserId(userId);
  if (!signedUserId) return null;
  const body: TokenBody = {
    userId: signedUserId,
    exp: Math.floor(nowMs / 1000) + IOS_TOKEN_TTL_SEC,
    v: 1,
  };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyIosToken(
  token: string,
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const secret = iosSigningSecret(env);
  if (!secret) return null;
  const trimmed = token.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  let body: TokenBody;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenBody;
  } catch {
    return null;
  }
  if (body.v !== 1 || typeof body.exp !== "number" || body.exp * 1000 <= nowMs) return null;
  if (typeof body.userId !== "string" || !iosNormalizeUserId(body.userId)) return null;
  return { userId: iosNormalizeUserId(body.userId), exp: body.exp };
}

export function readXaiClientSecret(data: SecretBody) {
  if (typeof data.value === "string" && data.value) return data.value;
  if (typeof data.client_secret === "string" && data.client_secret) {
    return data.client_secret;
  }
  if (
    data.client_secret &&
    typeof data.client_secret === "object" &&
    typeof data.client_secret.value === "string"
  ) {
    return data.client_secret.value;
  }
  return null;
}
