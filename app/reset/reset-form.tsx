"use client";

import { FormEvent, useState } from "react";

export function ResetPasswordForm({
  defaultToken,
  nextHref,
}: {
  defaultToken: string;
  nextHref: string;
}) {
  const [token, setToken] = useState(defaultToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset",
          token,
          password,
        }),
      });
      const body = (await response.json()) as { error?: string; reset?: boolean };
      if (!response.ok || !body.reset) {
        throw new Error(body.error || "Could not reset password.");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Password updated. Sign in with your new password. We never email the old password.
        </p>
        <a
          href={nextHref}
          className="rounded-full bg-neutral-900 px-5 py-3 text-center text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
        >
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-500">Reset code</span>
        <input
          name="token"
          value={token}
          onChange={(event) => setToken(event.target.value.toUpperCase())}
          placeholder="Code from your email"
          autoComplete="one-time-code"
          className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base tracking-[0.12em] outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-white"
        />
      </label>
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-500">New password</span>
        <input
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          autoComplete="new-password"
          className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-white"
        />
      </label>
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
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || !token.trim() || password.length < 8}
        className="rounded-full bg-neutral-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending ? "Updating…" : "Set new password"}
      </button>
    </form>
  );
}
