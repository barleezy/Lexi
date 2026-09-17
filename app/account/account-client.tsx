"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";

export function AccountClient({
  signedIn = false,
  email = "",
  subscribed = false,
  minutesLabel = "0s",
  cancelAtPeriodEnd = false,
}: {
  signedIn?: boolean;
  email?: string;
  subscribed?: boolean;
  minutesLabel?: string;
  voiceSeconds?: number;
  cancelAtPeriodEnd?: boolean;
}) {
  const [accountMode, setAccountMode] = useState<"signin" | "signup">("signin");
  const [accountDraft, setAccountDraft] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountPending, setAccountPending] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduled, setScheduled] = useState(cancelAtPeriodEnd);
  const [ends, setEnds] = useState("");

  async function submitAccount(event: FormEvent) {
    event.preventDefault();
    if (!accountDraft.trim()) {
      setError("Enter a username.");
      return;
    }
    if (accountMode === "signup" && !accountEmail.trim()) {
      setError("Enter the email for this account.");
      return;
    }
    if (accountPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setError(null);
    setAccountPending(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: accountMode,
          userId: accountDraft,
          email: accountEmail,
          password: accountPassword,
        }),
      });
      const body = (await response.json()) as { error?: string; userId?: string };
      if (!response.ok || !body.userId) {
        throw new Error(
          body.error || (accountMode === "signup" ? "Could not create account." : "Could not sign in."),
        );
      }
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
      setAccountPending(false);
    }
  }

  async function cancel() {
    if (scheduled) return;
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/billing/cancel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body = (await response.json()) as {
        error?: string;
        cancelAtPeriodEnd?: boolean;
        currentPeriodEnd?: number | null;
      };
      if (!response.ok) {
        throw new Error(body.error || "Could not cancel subscription.");
      }
      setScheduled(true);
      if (typeof body.currentPeriodEnd === "number" && body.currentPeriodEnd > 0) {
        setEnds(
          new Date(body.currentPeriodEnd * 1000).toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel subscription.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="buy-page relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <style>{`
        .buy-page {
          --buy-pink: #f472b6;
          --buy-pink-muted: #e8a0c0;
          --buy-pink-glow: rgba(244, 114, 182, 0.55);
          --buy-card: rgba(12, 8, 14, 0.55);
          --buy-muted: #a3a3a3;
        }
        @keyframes buy-title-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes buy-card-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .buy-title { animation: buy-title-in 0.7s ease-out both; }
        .buy-subtitle { animation: buy-title-in 0.7s ease-out 0.12s both; }
        .buy-card {
          animation: buy-card-in 0.65s ease-out 0.18s both;
          background: var(--buy-card);
          border: 1px solid var(--buy-pink);
          box-shadow:
            0 0 0 1px rgba(244, 114, 182, 0.15),
            0 0 24px var(--buy-pink-glow),
            inset 0 0 24px rgba(244, 114, 182, 0.06);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        .buy-buy-btn {
          background: var(--buy-pink);
          color: #140810;
          transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
        }
        .buy-buy-btn:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 0 18px var(--buy-pink-glow);
        }
        .buy-buy-btn:disabled { opacity: 0.45; }
      `}</style>

      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black">
        <Image
          src="/lexi.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_18%] opacity-70 sm:object-[70%_20%] sm:opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/75 via-black/45 to-black/90" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,rgba(190,60,140,0.22),transparent_55%)]" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 py-14 sm:px-10 sm:py-20">
        <header className="buy-title space-y-3 text-center">
          <h1 className="text-5xl font-semibold tracking-tight text-white sm:text-6xl md:text-7xl">
            Account
          </h1>
          <p
            className="buy-subtitle text-base tracking-wide sm:text-lg"
            style={{ color: "var(--buy-pink-muted)" }}
          >
            Email, minutes, and your monthly plan
          </p>
        </header>

        {signedIn ? (
          <div className="buy-card mt-12 flex w-full max-w-sm flex-col items-center overflow-hidden rounded-[1.75rem] px-8 py-10 text-center sm:mt-16">
            <dl className="w-full space-y-5 text-left">
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-400">Email</dt>
                <dd className="mt-1 text-base text-white">{email || "None on file"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-400">Subscription</dt>
                <dd className="mt-1 text-base text-white">{subscribed ? "active" : "none"}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-[0.18em] text-zinc-400">Minutes</dt>
                <dd className="mt-1 text-base text-white">{minutesLabel}</dd>
              </div>
            </dl>
            {subscribed ? (
              <div className="mt-8 w-full">
                {scheduled ? (
                  <p className="text-sm text-zinc-300" role="status">
                    Cancellation is scheduled
                    {ends ? ` — access stays through ${ends}` : " at the end of the billing period"}.
                  </p>
                ) : (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void cancel()}
                    className="w-full rounded-full border border-zinc-400 px-5 py-3 text-sm font-semibold text-zinc-100 disabled:opacity-45"
                  >
                    {pending ? "Canceling…" : "Cancel subscription"}
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <p className="mt-8 max-w-xl text-center text-sm text-zinc-300" role="status">
              Sign in to see your email, minutes, and subscription. You can also sign in on the{" "}
              <Link href="/" className="text-pink-300 underline-offset-4 hover:underline">
                homepage
              </Link>
              .
            </p>
            <form
              noValidate
              onSubmit={(event) => void submitAccount(event)}
              className="mt-8 w-full max-w-sm rounded-[1.75rem] border border-pink-400/50 bg-black/50 px-6 py-6 text-left"
            >
              <div className="grid grid-cols-2 rounded-full bg-zinc-900/80 p-1 text-sm font-medium">
                <button
                  type="button"
                  onClick={() => setAccountMode("signin")}
                  className={`rounded-full px-3 py-2 ${
                    accountMode === "signin" ? "bg-pink-400 text-zinc-950" : "text-zinc-300"
                  }`}
                >
                  Sign in
                </button>
                <button
                  type="button"
                  onClick={() => setAccountMode("signup")}
                  className={`rounded-full px-3 py-2 ${
                    accountMode === "signup" ? "bg-pink-400 text-zinc-950" : "text-zinc-300"
                  }`}
                >
                  Create account
                </button>
              </div>
              <label className="mt-4 flex flex-col gap-1.5 text-sm font-medium text-zinc-200">
                Username
                <input
                  value={accountDraft}
                  onChange={(event) => setAccountDraft(event.target.value)}
                  placeholder="username"
                  autoComplete="username"
                  className="rounded-2xl border border-zinc-500 bg-transparent px-4 py-3 text-base font-normal text-white outline-none focus:border-pink-400"
                />
              </label>
              {accountMode === "signup" ? (
                <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium text-zinc-200">
                  Email
                  <input
                    type="text"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    value={accountEmail}
                    onChange={(event) => setAccountEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className="rounded-2xl border border-zinc-500 bg-transparent px-4 py-3 text-base font-normal text-white outline-none focus:border-pink-400"
                  />
                </label>
              ) : null}
              <label className="mt-3 flex flex-col gap-1.5 text-sm font-medium text-zinc-200">
                Password
                <input
                  type="password"
                  value={accountPassword}
                  onChange={(event) => setAccountPassword(event.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete={accountMode === "signup" ? "new-password" : "current-password"}
                  className="rounded-2xl border border-zinc-500 bg-transparent px-4 py-3 text-base font-normal text-white outline-none focus:border-pink-400"
                />
              </label>
              <button
                type="submit"
                disabled={accountPending}
                className="buy-buy-btn mt-5 w-full rounded-full px-5 py-3 text-sm font-semibold disabled:opacity-45"
              >
                {accountPending
                  ? accountMode === "signup"
                    ? "Creating account…"
                    : "Signing in…"
                  : accountMode === "signup"
                    ? "Create account"
                    : "Sign in"}
              </button>
            </form>
          </>
        )}

        {error ? (
          <p className="mt-8 text-center text-sm text-zinc-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
