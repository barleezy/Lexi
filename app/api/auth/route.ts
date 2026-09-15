import { cookies } from "next/headers";
import { AccountAuthError } from "@/lib/auth/accounts";
import {
  LEXI_USER_COOKIE,
  lexiUserCookieOptions,
  loginAccount,
  parseAuthAction,
  publicAppUrl,
  runPasswordFlow,
} from "@/lib/auth/login";
import { isAdminUserId, resolveUserId } from "@/lib/memory/user";

export const maxDuration = 15;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = resolveUserId(request, url.searchParams.get("userId"));
  return Response.json({
    ok: true,
    userId,
    isAdmin: isAdminUserId(userId),
  });
}

export async function POST(request: Request) {
  let body: {
    userId?: unknown;
    password?: unknown;
    action?: unknown;
    email?: unknown;
    token?: unknown;
    code?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const reset = await runPasswordFlow(body.action, body, publicAppUrl(request));
    if (reset) return Response.json(reset);
    const action = parseAuthAction(body.action);
    const userId = await loginAccount(action, body.userId, body.password, body.email);
    const jar = await cookies();
    jar.set(LEXI_USER_COOKIE, userId, lexiUserCookieOptions());
    return Response.json({ ok: true, userId, isAdmin: isAdminUserId(userId) });
  } catch (error) {
    if (error instanceof AccountAuthError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json({ error: "Could not sign in." }, { status: 500 });
  }
}

export async function DELETE() {
  const jar = await cookies();
  jar.set(LEXI_USER_COOKIE, "", { ...lexiUserCookieOptions(), maxAge: 0 });
  return Response.json({ ok: true, userId: "" });
}
