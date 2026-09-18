"use client";

import { useEffect, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";

export function SubscribeClient({
  signedIn = false,
  subscribed: subscribedProp = false,
  planReady = false,
  label,
  priceLabel,
  cadence,
}: {
  signedIn?: boolean;
  subscribed?: boolean;
  planReady?: boolean;
  label: string;
  priceLabel: string;
  cadence: string;
}) {
  const [authed, setAuthed] = useState(signedIn);
  const [subscribed, setSubscribed] = useState(subscribedProp);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accountMode, setAccountMode] = useState<"signin" | "signup">("signin");
  const [accountDraft, setAccountDraft] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [accountPending, setAccountPending] = useState(false);

  useEffect(() => {
    setSubscribed(subscribedProp);
  }, [subscribedProp]);

  useEffect(() => {
    if (!authed) {
      setSubscribed(false);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/billing/balance", {
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) return;
        const body = (await response.json()) as { subscribed?: boolean };
        if (!cancelled) setSubscribed(body.subscribed === true);
      } catch {
        // keep the server-rendered subscribed flag
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  async function subscribe() {
    if (!authed) {
      setError("Sign in to subscribe. Use the form on this page — you stay here.");
      return;
    }
    if (!planReady) {
      setError("Checkout is not configured yet, so this plan cannot be started.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const response = await fetch("/api/checkout/subscribe", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "1",
        },
      });
      const body = (await response.json()) as { url?: string; error?: string };
      if (response.status === 401) {
        console.error("[subscribe-checkout] 401", body.error);
        setAuthed(false);
        setError(body.error || "Sign in first.");
        setPending(false);
        return;
      }
      if (!response.ok || !body.url) {
        console.error("[subscribe-checkout] checkout failed", response.status, body.error);
        throw new Error(body.error || "Could not start Checkout.");
      }
      window.location.href = body.url;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start Checkout.";
      console.error("[subscribe-checkout] client error", err);
      setError(message);
      setPending(false);
    }
  }

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
        throw new Error(body.error || (accountMode === "signup" ? "Could not create account." : "Could not sign in."));
      }
      setAuthed(true);
      setAccountPassword("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      setAccountPending(false);
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
            Talk To Lexi
          </h1>
          <p
            className="buy-subtitle text-base tracking-wide sm:text-lg"
            style={{ color: "var(--buy-pink-muted)" }}
          >
            Keep her every month
          </p>
        </header>

        {!planReady ? (
          <p className="mt-8 max-w-xl text-center text-sm text-zinc-300" role="status">
            Checkout is not configured on this server yet. The monthly plan is listed below —
            payment will not start until billing is set up.
          </p>
        ) : !authed ? (
          <p className="mt-8 max-w-xl text-center text-sm text-zinc-300" role="status">
            Sign in to subscribe. This page stays here after you sign in.
          </p>
        ) : null}

        <div className="buy-card mt-12 flex w-full max-w-sm flex-col items-center overflow-hidden rounded-[1.75rem] px-8 py-10 text-center sm:mt-16">
          <p className="text-lg font-medium tracking-wide" style={{ color: "var(--buy-pink)" }}>
            {label}
          </p>
          <p className="mt-4 text-5xl font-semibold tracking-tight text-white sm:text-6xl">
            {priceLabel}
          </p>
          <p className="mt-3 text-sm" style={{ color: "var(--buy-muted)" }}>
            {cadence}
          </p>
          {subscribed ? (
            <Link
              href="/account"
              className="buy-buy-btn mt-8 inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold no-underline"
            >
              Manage
            </Link>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => void subscribe()}
              className="buy-buy-btn mt-8 w-full rounded-full px-5 py-3 text-sm font-semibold"
            >
              {pending ? "Starting…" : !authed ? "Sign in to subscribe" : !planReady ? "Unavailable" : "Subscribe"}
            </button>
          )}
        </div>

        {!authed ? (
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
        ) : null}

        {error ? (
          <p className="mt-8 text-center text-sm text-zinc-300" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
