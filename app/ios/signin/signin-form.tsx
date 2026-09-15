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
  const [userId, setUserId] = useState(defaultUserId);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const creating = mode === "signup";
  const ready =
    callbackOk &&
    userId.trim().length > 0 &&
    password.length >= 8 &&
    (!creating || password === confirm);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (creating && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/ios/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: mode,
          userId,
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

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
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
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-500">Account</span>
        <input
          name="userId"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="Barleezy"
          autoComplete="username"
          className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-white"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-500">Password</span>
        <input
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          autoComplete={creating ? "new-password" : "current-password"}
          className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-white"
        />
      </label>
      {creating ? (
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
      {!callbackOk ? (
        <p className="text-sm text-red-500">
          Open this page from the Talk to Lexi iPhone app so it can return with talktolexi://.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || !ready}
        className="rounded-full bg-neutral-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending
          ? creating
            ? "Creating…"
            : "Signing in…"
          : creating
            ? "Create account"
            : "Sign in"}
      </button>
    </form>
  );
}
