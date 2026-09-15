import { cookies } from "next/headers";
import { AccountAuthError } from "@/lib/auth/accounts";
import { LEXI_USER_COOKIE, lexiUserCookieOptions, loginAccount, parseAuthAction } from "@/lib/auth/login";
import {
  callbackURLWithToken,
  iosSigningSecret,
  parseCallbackURI,
  signIosToken,
} from "@/lib/ios/auth";
import { isAdminUserId, resolveUserId } from "@/lib/memory/user";

export const maxDuration = 15;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = resolveUserId(request, url.searchParams.get("userId"));
  return Response.json({
    ok: true,
    host: "talktolexi.app",
    userId,
    isAdmin: isAdminUserId(userId),
    configured: Boolean(iosSigningSecret()),
    callbackSchemes: ["talktolexi", "app.talktolexi.ios"],
  });
}

export async function POST(request: Request) {
  if (!iosSigningSecret()) {
    return Response.json(
      {
        error:
          "iOS sign-in is not configured. Set IOS_SESSION_SECRET (or XAI_API_KEY) on the server.",
      },
      { status: 503 },
    );
  }

  let body: {
    userId?: unknown;
    password?: unknown;
    action?: unknown;
    redirect_uri?: unknown;
    redirectURI?: unknown;
    state?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const redirectURI =
    (typeof body.redirect_uri === "string" && body.redirect_uri) ||
    (typeof body.redirectURI === "string" && body.redirectURI) ||
    "";
  if (!parseCallbackURI(redirectURI)) {
    return Response.json(
      { error: "redirect_uri must be talktolexi:// or app.talktolexi.ios://." },
      { status: 400 },
    );
  }

  let userId: string;
  try {
    userId = await loginAccount(parseAuthAction(body.action), body.userId, body.password);
  } catch (error) {
    if (error instanceof AccountAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Could not sign in." }, { status: 500 });
  }

  const token = signIosToken(userId);
  if (!token) {
    return Response.json({ error: "Could not sign an iOS session." }, { status: 500 });
  }

  const state = typeof body.state === "string" ? body.state.trim() : "";
  const callback = callbackURLWithToken(redirectURI, token, userId, state || null);
  if (!callback) {
    return Response.json({ error: "redirect_uri must be talktolexi:// or app.talktolexi.ios://." }, { status: 400 });
  }

  const jar = await cookies();
  jar.set(LEXI_USER_COOKIE, userId, lexiUserCookieOptions());

  return Response.json({
    ok: true,
    userId,
    token,
    expiresIn: 60 * 60 * 24 * 30,
    url: callback,
  });
}
