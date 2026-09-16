import {
  AccountAuthError,
  authenticateAccount,
  createAccount,
  ensureBootstrapAdmin,
} from "@/lib/auth/accounts";
import { completePasswordReset, publicAppUrl, requestPasswordReset } from "@/lib/auth/reset";
import { LEXI_USER_COOKIE, LEXI_USER_COOKIE_MAX_AGE } from "@/lib/memory/user";

export type AuthAction = "signin" | "signup";

export function parseAuthAction(raw: unknown): AuthAction {
  const action = typeof raw === "string" ? raw.trim().toLowerCase() : "signin";
  if (action !== "signin" && action !== "signup") {
    throw new AccountAuthError("Use Sign in or Create account.");
  }
  return action;
}

export async function loginAccount(
  action: AuthAction,
  userId: unknown,
  password: unknown,
  email: unknown,
) {
  if (typeof password !== "string" || !password) {
    throw new AccountAuthError("Password is required.");
  }
  if (typeof email !== "string" || !email.trim()) {
    throw new AccountAuthError("Email is required.");
  }
  await ensureBootstrapAdmin();
  return action === "signup"
    ? createAccount(typeof userId === "string" ? userId : "", password, email)
    : authenticateAccount(typeof userId === "string" ? userId : "", password, email);
}

export async function runPasswordFlow(
  action: unknown,
  body: { userId?: unknown; email?: unknown; password?: unknown; token?: unknown; code?: unknown },
  origin: string,
) {
  const name = typeof action === "string" ? action.trim().toLowerCase() : "";
  if (name === "forgot") {
    const message = await requestPasswordReset(body.userId, body.email, origin);
    return { ok: true as const, sent: true as const, message };
  }
  if (name === "reset") {
    await completePasswordReset(body.token ?? body.code, body.password);
    return { ok: true as const, reset: true as const };
  }
  return null;
}

export { publicAppUrl };

export function lexiUserCookieOptions() {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: LEXI_USER_COOKIE_MAX_AGE,
  };
}

export { LEXI_USER_COOKIE };
