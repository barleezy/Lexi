import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { readIosSession } from "../ios/auth";
import { iosSigningSecret } from "../ios/config";
import {
  isGuestUserId,
  LEXI_USER_COOKIE,
  LEXI_USER_COOKIE_MAX_AGE,
  normalizeUserId,
} from "../memory/user";

/** HttpOnly signed session cookie. Client-sent x-lexi-user-id is not auth. */
export const LEXI_SESSION_COOKIE = "lexi_session";
export const LEXI_SESSION_TTL_SEC = 60 * 60 * 24 * 180;

type SessionBody = {
  userId: string;
  exp: number;
  v: number;
};

function signingSecret(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.AUTH_SESSION_SECRET?.trim() ||
    env.IOS_SESSION_SECRET?.trim() ||
    env.XAI_API_KEY?.trim() ||
    ""
  );
}

export function signAuthSession(
  userId: string,
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const secret = signingSecret(env);
  if (!secret) return null;
  const signedUserId = normalizeUserId(userId);
  if (!signedUserId || isGuestUserId(signedUserId)) return null;
  const body: SessionBody = {
    userId: signedUserId,
    exp: Math.floor(nowMs / 1000) + LEXI_SESSION_TTL_SEC,
    v: 1,
  };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`web:${payload}`).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyAuthSession(
  token: string,
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const secret = signingSecret(env);
  if (!secret) return null;
  const trimmed = token.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(`web:${payload}`).digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null;
  let body: SessionBody;
  try {
    body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionBody;
  } catch {
    return null;
  }
  if (body.v !== 1 || typeof body.exp !== "number" || body.exp * 1000 <= nowMs) return null;
  const userId = normalizeUserId(body.userId);
  if (!userId || isGuestUserId(userId)) return null;
  return { userId, exp: body.exp };
}

export function readCookieValue(cookieHeader: string, name: string) {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1].trim());
  } catch {
    return match[1].trim();
  }
}

function userIdFromSessionToken(
  token: string | undefined | null,
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const raw = token?.trim() ?? "";
  if (!raw) return "";
  return verifyAuthSession(raw, nowMs, env)?.userId ?? "";
}

function tokenFromNextRequestCookies(request: Request) {
  const jar = (
    request as Request & {
      cookies?: { get?: (name: string) => { value?: string } | string | undefined };
    }
  ).cookies;
  const got = jar?.get?.(LEXI_SESSION_COOKIE);
  if (!got) return "";
  return (typeof got === "string" ? got : got.value) ?? "";
}

/** Same cookie read as /buy and /subscribe server HTML. */
export async function readIncomingAuthSession(
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const jar = await cookies();
  const token = jar.get(LEXI_SESSION_COOKIE)?.value ?? "";
  return token ? verifyAuthSession(token, nowMs, env) : null;
}

/** iOS signed bearer / x-lexi-ios-session, or web httpOnly lexi_session cookie. */
export function readAuthSessionUserId(
  request: Request,
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const ios = readIosSession(request, env);
  if (ios?.userId && !isGuestUserId(ios.userId)) return ios.userId;

  const fromNextCookies = userIdFromSessionToken(tokenFromNextRequestCookies(request), nowMs, env);
  if (fromNextCookies) return fromNextCookies;

  const cookie = request.headers.get("cookie") ?? "";
  return userIdFromSessionToken(readCookieValue(cookie, LEXI_SESSION_COOKIE), nowMs, env);
}

/**
 * Authenticate for wallet / checkout / mint.
 * Prefers Next.js cookies() + verifyAuthSession (same as /buy HTML), then iOS bearer,
 * then the request cookie store / Cookie header. Does not trust ?userId or
 * x-lexi-user-id alone. If the client also sends a userId, it must match.
 */
export async function requireAuthSessionUserId(
  request: Request,
  claimedUserId?: string | null,
  nowMs = Date.now(),
  env: NodeJS.ProcessEnv = process.env,
) {
  const ios = readIosSession(request, env);
  const jar = await cookies();
  const rawCookie = jar.get(LEXI_SESSION_COOKIE)?.value ?? "";
  const fromCookies = rawCookie ? verifyAuthSession(rawCookie, nowMs, env) : null;
  console.info("[auth] requireAuthSessionUserId", {
    rawCookie,
    verifyAuthSession: fromCookies,
  });
  const sessionUserId =
    (ios?.userId && !isGuestUserId(ios.userId) ? ios.userId : "") ||
    fromCookies?.userId ||
    readAuthSessionUserId(request, nowMs, env);
  if (!sessionUserId) return null;
  const claimed = normalizeUserId(claimedUserId);
  if (claimed && claimed.toLowerCase() !== sessionUserId.toLowerCase()) return null;
  return sessionUserId;
}

export function lexiSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LEXI_SESSION_TTL_SEC,
  };
}

/** Display cookie only — never used as auth for mint/wallet. */
export function lexiUserDisplayCookieOptions() {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LEXI_USER_COOKIE_MAX_AGE,
  };
}

export { LEXI_USER_COOKIE, iosSigningSecret };
