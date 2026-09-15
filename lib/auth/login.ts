import {
  AccountAuthError,
  authenticateAccount,
  createAccount,
  ensureBootstrapAdmin,
} from "@/lib/auth/accounts";
import { LEXI_USER_COOKIE, LEXI_USER_COOKIE_MAX_AGE } from "@/lib/memory/user";

export type AuthAction = "signin" | "signup";

export function parseAuthAction(raw: unknown): AuthAction {
  const action = typeof raw === "string" ? raw.trim().toLowerCase() : "signin";
  if (action !== "signin" && action !== "signup") {
    throw new AccountAuthError("Use Sign in or Create account.");
  }
  return action;
}

export async function loginAccount(action: AuthAction, userId: unknown, password: unknown) {
  if (typeof password !== "string" || !password) {
    throw new AccountAuthError("Password is required.");
  }
  await ensureBootstrapAdmin();
  return action === "signup"
    ? createAccount(typeof userId === "string" ? userId : "", password)
    : authenticateAccount(typeof userId === "string" ? userId : "", password);
}

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
