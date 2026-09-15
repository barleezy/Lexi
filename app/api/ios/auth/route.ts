import { cookies } from "next/headers";
import {
  LEXI_USER_COOKIE,
  LEXI_USER_COOKIE_MAX_AGE,
  callbackURLWithToken,
  defaultIosUserId,
  iosSigningSecret,
  parseCallbackURI,
  signIosToken,
} from "@/lib/ios/auth";
import { normalizeUserId, resolveUserId } from "@/lib/memory/user";

export const maxDuration = 15;

function cookieOptions() {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LEXI_USER_COOKIE_MAX_AGE,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = resolveUserId(request, url.searchParams.get("userId"));
  return Response.json({
    ok: true,
    host: "talktolexi.app",
    userId,
    defaultUserId: defaultIosUserId(),
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

  const userId = normalizeUserId(
    typeof body.userId === "string" ? body.userId : resolveUserId(request, null),
  );
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
  jar.set(LEXI_USER_COOKIE, userId, cookieOptions());

  return Response.json({
    ok: true,
    userId,
    token,
    expiresIn: 60 * 60 * 24 * 30,
    url: callback,
  });
}
