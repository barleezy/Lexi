"use client";

import { useState } from "react";
import Image from "next/image";

export type BuyPackCard = {
  id: string;
  label: string;
  minutes: number;
  priceLabel: string;
  thumbnail: string;
  priceId: string;
  configured: boolean;
};

export function BuyPacks({
  packs,
  signedIn,
  className = "",
}: {
  packs: BuyPackCard[];
  signedIn: boolean;
  className?: string;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(pack: BuyPackCard) {
    if (!signedIn) {
      window.location.href = "/?next=/buy";
      return;
    }
    if (!pack.configured || !pack.priceId) {
      setError("Checkout is not configured yet, so this pack cannot be purchased.");
      return;
    }
    setError(null);
    setPendingId(pack.id);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "1",
        },
        body: JSON.stringify({ priceId: pack.priceId }),
      });
      const body = (await response.json()) as { url?: string; error?: string };
      if (response.status === 401) {
        window.location.href = "/?next=/buy";
        return;
      }
      if (!response.ok || !body.url) {
        throw new Error(body.error || "Could not start Checkout.");
      }
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Checkout.");
      setPendingId(null);
    }
  }

  return (
    <div className={`buy-packs ${className}`.trim()}>
      <style>{`
        .buy-packs {
          --buy-pink: #f472b6;
          --buy-pink-muted: #e8a0c0;
          --buy-pink-glow: rgba(244, 114, 182, 0.55);
          --buy-card: rgba(12, 8, 14, 0.55);
          --buy-muted: #a3a3a3;
        }
        @keyframes buy-card-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .buy-card {
          animation: buy-card-in 0.65s ease-out both;
          background: var(--buy-card);
          border: 1px solid var(--buy-pink);
          box-shadow:
            0 0 0 1px rgba(244, 114, 182, 0.15),
            0 0 24px var(--buy-pink-glow),
            inset 0 0 24px rgba(244, 114, 182, 0.06);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
        }
        .buy-card:nth-child(1) { animation-delay: 0.18s; }
        .buy-card:nth-child(2) { animation-delay: 0.28s; }
        .buy-card:nth-child(3) { animation-delay: 0.38s; }
        .buy-card:hover {
          box-shadow:
            0 0 0 1px rgba(244, 114, 182, 0.35),
            0 0 36px rgba(244, 114, 182, 0.7),
            inset 0 0 28px rgba(244, 114, 182, 0.1);
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

      <ul className="grid w-full gap-5 sm:grid-cols-3 sm:gap-6">
        {packs.map((pack) => (
          <li
            key={pack.id}
            className="buy-card flex flex-col items-center overflow-hidden rounded-[1.75rem] text-center"
          >
            {pack.thumbnail ? (
              <div className="relative aspect-[4/3] w-full overflow-hidden">
                <Image
                  src={pack.thumbnail}
                  alt=""
                  fill
                  sizes="(max-width: 640px) 100vw, 33vw"
                  className="object-cover object-center"
                  priority={pack.id === "whisper"}
                />
              </div>
            ) : null}
            <div className="flex w-full flex-col items-center px-6 py-8">
              <p className="text-lg font-medium tracking-wide" style={{ color: "var(--buy-pink)" }}>
                {pack.label}
              </p>
              <p className="mt-4 text-5xl font-semibold tracking-tight text-white sm:text-6xl">
                {pack.priceLabel}
              </p>
              <p className="mt-3 text-sm" style={{ color: "var(--buy-muted)" }}>
                {pack.minutes} minutes
              </p>
              <button
                type="button"
                disabled={pendingId != null}
                onClick={() => void buy(pack)}
                className="buy-buy-btn mt-8 w-full rounded-full px-5 py-3 text-sm font-semibold"
              >
                {pendingId === pack.id
                  ? "Starting…"
                  : !signedIn
                    ? "Sign in to buy"
                    : !pack.configured
                      ? "Unavailable"
                      : "Buy"}
              </button>
              {signedIn && !pack.configured ? (
                <p className="mt-3 text-xs" style={{ color: "var(--buy-muted)" }}>
                  Checkout is not configured yet.
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {error ? (
        <p className="mt-8 text-center text-sm text-zinc-300" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
