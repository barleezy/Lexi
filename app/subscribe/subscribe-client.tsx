"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export function SubscribeClient({
  signedIn = false,
  planReady = false,
  label,
  priceLabel,
  cadence,
}: {
  signedIn?: boolean;
  planReady?: boolean;
  label: string;
  priceLabel: string;
  cadence: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function subscribe() {
    if (!signedIn) {
      window.location.href = "/?next=/subscribe";
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
        window.location.href = "/?next=/subscribe";
        return;
      }
      if (!response.ok || !body.url) {
        throw new Error(body.error || "Could not start Checkout.");
      }
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Checkout.");
      setPending(false);
    }
  }

  return (
    <div className="buy-page relative flex min-h-dvh flex-1 flex-col overflow-hidden">
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
        ) : !signedIn ? (
          <p className="mt-8 max-w-xl text-center text-sm text-zinc-300" role="status">
            Sign in to subscribe. This page stays here after you come back.
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
          <button
            type="button"
            disabled={pending}
            onClick={() => void subscribe()}
            className="buy-buy-btn mt-8 w-full rounded-full px-5 py-3 text-sm font-semibold"
          >
            {pending ? "Starting…" : !signedIn ? "Sign in to subscribe" : !planReady ? "Unavailable" : "Subscribe"}
          </button>
        </div>

        {error ? (
          <p className="mt-8 text-center text-sm text-zinc-300" role="alert">
            {error}
          </p>
        ) : null}

        <p className="mt-auto pt-12 text-sm text-zinc-400">
          <Link href="/buy" className="underline-offset-4 hover:underline hover:text-white">
            Buy minutes instead
          </Link>
          <span className="px-2">·</span>
          <Link href="/refund" className="underline-offset-4 hover:underline hover:text-white">
            Refunds
          </Link>
          <span className="px-2">·</span>
          <Link href="/privacy" className="underline-offset-4 hover:underline hover:text-white">
            Privacy
          </Link>
          <span className="px-2">·</span>
          <Link href="/terms" className="underline-offset-4 hover:underline hover:text-white">
            Terms
          </Link>
          <span className="px-2">·</span>
          <Link href="/support" className="underline-offset-4 hover:underline hover:text-white">
            Support
          </Link>
          <span className="px-2">·</span>
          <Link href="/site" className="underline-offset-4 hover:underline hover:text-white">
            Site
          </Link>
          <span className="px-2">·</span>
          <Link href="/" className="underline-offset-4 hover:underline hover:text-white">
            Back to Call
          </Link>
        </p>
      </div>
    </div>
  );
}
