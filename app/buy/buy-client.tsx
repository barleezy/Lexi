"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

export type BuyPackCard = {
  id: string;
  label: string;
  minutes: number;
  priceLabel: string;
  thumbnail: string;
  priceId: string;
  configured: boolean;
};

export function BuyClient({ packs }: { packs: BuyPackCard[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function buy(pack: BuyPackCard) {
    if (!pack.configured || !pack.priceId) {
      setError("That pack is not for sale yet.");
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
    <div className="buy-page relative flex min-h-dvh flex-1 flex-col overflow-hidden">
      <style>{`
        .buy-page {
          --buy-pink: #f472b6;
          --buy-pink-muted: #e8a0c0;
          --buy-pink-glow: rgba(244, 114, 182, 0.55);
          --buy-card: rgba(12, 8, 14, 0.55);
          --buy-ink: #f5f5f5;
          --buy-muted: #a3a3a3;
        }
        @keyframes buy-card-in {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes buy-title-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .buy-title { animation: buy-title-in 0.7s ease-out both; }
        .buy-subtitle { animation: buy-title-in 0.7s ease-out 0.12s both; }
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
          <p className="buy-subtitle text-base tracking-wide sm:text-lg" style={{ color: "var(--buy-pink-muted)" }}>
            Choose Your AI Companion Plan
          </p>
        </header>

        <ul className="mt-12 grid w-full max-w-5xl gap-5 sm:mt-16 sm:grid-cols-3 sm:gap-6">
          {packs.map((pack) => (
            <li key={pack.id} className="buy-card flex flex-col overflow-hidden rounded-[1.75rem]">
              <div className="relative aspect-[16/10] w-full overflow-hidden">
                <Image
                  src={pack.thumbnail}
                  alt={`${pack.label} — ${pack.minutes} minutes for ${pack.priceLabel}`}
                  fill
                  sizes="(max-width: 640px) 100vw, 33vw"
                  className="object-cover object-center"
                  priority={pack.id === "whisper"}
                />
              </div>
              <div className="flex flex-col items-center px-5 py-5 text-center">
                <p className="text-lg font-medium tracking-wide" style={{ color: "var(--buy-pink)" }}>
                  {pack.label}
                </p>
                <p className="mt-2 text-4xl font-semibold tracking-tight text-white">{pack.priceLabel}</p>
                <p className="mt-1 text-sm" style={{ color: "var(--buy-muted)" }}>
                  {pack.minutes} minutes
                </p>
                <button
                  type="button"
                  disabled={pendingId != null || !pack.configured}
                  onClick={() => void buy(pack)}
                  className="buy-buy-btn mt-5 w-full rounded-full px-5 py-3 text-sm font-semibold"
                >
                  {pendingId === pack.id ? "Starting…" : "Buy"}
                </button>
                {!pack.configured ? (
                  <p className="mt-3 text-xs" style={{ color: "var(--buy-muted)" }}>
                    Not configured yet.
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {error ? (
          <p className="mt-8 text-sm text-zinc-300" role="alert">
            {error}
          </p>
        ) : null}

        <p className="mt-auto pt-12 text-sm" style={{ color: "var(--buy-muted)" }}>
          <Link href="/" className="underline-offset-4 hover:underline hover:text-white">
            Back to Call
          </Link>
        </p>
      </div>
    </div>
  );
}
