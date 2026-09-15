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
  const [userId, setUserId] = useState(defaultUserId);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function continueAsAccount(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/ios/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          redirect_uri: redirectURI,
          state,
        }),
      });
      const body = (await response.json()) as { error?: string; url?: string };
      if (!response.ok || !body.url) {
        throw new Error(body.error || "Could not sign in.");
      }
      window.location.assign(body.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={continueAsAccount} className="flex flex-col gap-4">
      <label className="flex flex-col gap-2 text-sm">
        <span className="text-neutral-500">Account</span>
        <input
          name="userId"
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="Your account"
          autoComplete="username"
          className="rounded-xl border border-neutral-300 bg-transparent px-4 py-3 text-base outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-white"
        />
      </label>
      {!callbackOk ? (
        <p className="text-sm text-red-500">
          Open this page from the Talk to Lexi iPhone app so it can return with talktolexi://.
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      <button
        type="submit"
        disabled={pending || !callbackOk || !userId.trim()}
        className="rounded-full bg-neutral-900 px-5 py-3 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
      >
        {pending ? "Continuing…" : userId.trim() ? `Continue as ${userId.trim()}` : "Continue"}
      </button>
    </form>
  );
}
