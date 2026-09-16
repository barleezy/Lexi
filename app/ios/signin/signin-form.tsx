"use client";

import { useState } from "react";

export function IosSignInForm({
  defaultUserId,
  redirectURI,
  state,
  callbackOk,
}: {
  defaultUserId: string;
  redirectURI: string;
  state: string;
  callbackOk: boolean;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [panel, setPanel] = useState<"auth" | "forgot" | "reset">("auth");
  const [userId, setUserId] = useState(defaultUserId);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);

  const creating = mode === "signup";
  const authReady =
    callbackOk &&
    userId.trim().length > 0 &&
    password.length >= 8 &&
    (!creating || (email.trim().length > 0 && password === confirm));
  const forgotReady = userId.trim().length > 0 && email.trim().length > 0;
  const resetReady = resetToken.trim().length > 0 && password.length >= 8 && password === confirm;
  const ready = panel === "forgot" ? forgotReady : panel === "reset" ? resetReady : authReady;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (panel === "forgot") {
      await submitForgot();
      return;
    }
    if (panel === "reset") {
      await submitReset();
      return;
    }
    if (creating && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (creating && !email.trim()) {
      setError("Enter the email for this account.");
      return;
    }
    setError("");
    setNotice("");
    setPending(true);
    try {
      const response = await fetch("/api/ios/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          userId,
          email,
          password,
          redirect_uri: redirectURI,
          state,
        }),
      });
      const body = (await response.json()) as { error?: string; url?: string };
      if (!response.ok || !body.url) {
        throw new Error(body.error || (creating ? "Could not create account." : "Could not sign in."));
      }
      window.location.assign(body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setPending(false);
    }
  }

  async function submitForgot() {
    if (!userId.trim() || !email.trim()) {
      setError("Enter your username and email.");
      return;
    }
    setError("");
    setNotice("");
    setPending(true);
    try {
      const response = await fetch("/api/ios/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "forgot",
          userId,
          email,
        }),
      });
      const body = (await response.json()) as { error?: string; message?: string };
      if (!response.ok) {
        throw new Error(body.error || "Could not send a reset email.");
      }
      setUserId("");
      setEmail("");
      setPassword("");
      setConfirm("");
      setResetToken("");
      setMode("signin");
      setPanel("reset");
      setNotice("Check your email and return with the reset code.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send a reset email.");
    } finally {
      setPending(false);
    }
  }

  async function submitReset() {
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setNotice("");
    setPending(true);
    try {
      const response = await fetch("/api/ios/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          token: resetToken,
          password,
        }),
      });
      const body = (await response.json()) as { error?: string; reset?: boolean };
      if (!response.ok || !body.reset) {
        throw new Error(body.error || "Could not reset password.");
      }
      setPassword("");
      setConfirm("");
      setResetToken("");
      setPanel("auth");
      setMode("signin");
      setNotice("Password updated. Sign in with your new password.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {panel === "auth" ? (
        <div className="flex rounded-full border border-neutral-300 p-1 text-sm dark:border-neutral-700">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`flex-1 rounded-full px-3 py-2 ${
              !creating ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : ""
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`flex-1 rounded-full px-3 py-2 ${
              creating ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : ""
            }`}
          >
            Create account
          </button>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">
          {panel === "forgot"
            ? "We send a one-time reset link. The current password cannot be emailed."
            : "Check your email and return with the reset code, then choose a new password."}
        </p>
      )}
      {panel !== "reset" ? (
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-neutral-500">Username</span>
          <input
            name="userId"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            placeholder="username"
            autoComplete="username"
            className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-white"
          />
        </label>
      ) : null}
      {panel !== "reset" ? (
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-neutral-500">Email</span>
          <input
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-white"
          />
        </label>
      ) : null}
      {panel === "reset" ? (
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-neutral-500">Reset code</span>
          <input
            name="token"
            value={resetToken}
            onChange={(event) => setResetToken(event.target.value.toUpperCase())}
            placeholder="Reset code from your email"
            autoComplete="one-time-code"
            className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base tracking-[0.12em] outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-white"
          />
        </label>
      ) : null}
      {panel !== "forgot" ? (
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-neutral-500">{panel === "reset" ? "New password" : "Password"}</span>
          <input
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            autoComplete={creating || panel === "reset" ? "new-password" : "current-password"}
            className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-white"
          />
        </label>
      ) : null}
      {panel === "reset" || creating ? (
        <label className="flex flex-col gap-2 text-sm">
          <span className="text-neutral-500">Confirm password</span>
          <input
            name="confirm"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="Type it again"
            autoComplete="new-password"
            className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-white"
          />
        </label>
      ) : null}
      {!callbackOk && panel === "auth" ? (
        <p className="text-sm text-red-500">
          Open this page from the Talk to Lexi iPhone app so it can return with talktolexi://.
        </p>
      ) : null}
      {notice ? <p className="text-sm text-neutral-600 dark:text-neutral-300">{notice}</p> : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || (panel === "auth" ? !ready : panel === "forgot" ? !forgotReady : !resetReady)}
        className="rounded-full bg-neutral-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending
          ? panel === "forgot"
            ? "Sending reset email…"
            : panel === "reset"
              ? "Updating…"
              : creating
                ? "Creating…"
                : "Signing in…"
          : panel === "forgot"
            ? "Send reset email"
            : panel === "reset"
              ? "Set new password"
              : creating
                ? "Create account"
                : "Sign in"}
      </button>
      {panel === "auth" && !creating ? (
        <>
          <button
            type="button"
            onClick={() => {
              setError("");
              setNotice("");
              setPanel("forgot");
            }}
            className="text-center text-sm text-neutral-500 underline-offset-4 hover:underline"
          >
            Forgot password?
          </button>
          <button
            type="button"
            onClick={() => {
              setError("");
              setPanel("reset");
            }}
            className="text-center text-sm text-neutral-500 underline-offset-4 hover:underline"
          >
            I have a reset code
          </button>
        </>
      ) : null}
      {panel === "forgot" ? (
        <button
          type="button"
          onClick={() => {
            setError("");
            setPanel("reset");
          }}
          className="text-center text-sm text-neutral-500 underline-offset-4 hover:underline"
        >
          I already have a reset code
        </button>
      ) : null}
      {panel !== "auth" ? (
        <button
          type="button"
          onClick={() => {
            setError("");
            setNotice("");
            setPanel("auth");
            setMode("signin");
          }}
          className="text-center text-sm text-neutral-500 underline-offset-4 hover:underline"
        >
          Back to sign in
        </button>
      ) : null}
    </form>
  );
}
