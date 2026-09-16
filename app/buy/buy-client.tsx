"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

export type BuyPackCard = {
  id: string;
  label: string;
  minutes: number;
  priceLabel: string;
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
    <div className="relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-black font-sans text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <Image
          src="/lexi.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_18%] opacity-70 sm:object-[center_12%]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-black/35 to-black/85" />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 py-14 sm:px-10 sm:py-20">
        <h1 className="text-center text-4xl font-semibold tracking-tight text-white drop-shadow-[0_0_24px_rgba(255,255,255,0.35)] sm:text-6xl">
          Talk To Lexi
        </h1>
        <p className="mt-3 text-center text-base font-medium tracking-wide text-[#e8a0c0] sm:text-lg">
          Choose Your AI Companion Plan
        </p>

        <ul className="mt-12 grid w-full gap-5 sm:mt-16 sm:grid-cols-3 sm:gap-6">
          {packs.map((pack) => (
            <li key={pack.id}>
              <button
                type="button"
                disabled={pendingId != null || !pack.configured}
                onClick={() => void buy(pack)}
                className="group flex w-full flex-col items-center rounded-[1.75rem] border border-[#ff4db8] bg-black/45 px-6 py-8 text-center shadow-[0_0_28px_rgba(255,77,184,0.45)] backdrop-blur-md transition hover:bg-black/55 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="text-xl font-semibold tracking-tight text-[#f0a8c8]">{pack.label}</span>
                <span className="mt-4 text-5xl font-semibold tracking-tight text-white sm:text-6xl">
                  {pack.priceLabel}
                </span>
                <span className="mt-3 text-sm text-zinc-300">{pack.minutes} minutes</span>
                <span className="mt-7 rounded-full border border-[#ff4db8]/40 bg-[#ff4db8]/15 px-5 py-2 text-sm font-semibold text-white group-hover:bg-[#ff4db8]/25">
                  {pendingId === pack.id ? "Starting…" : "Buy"}
                </span>
                {!pack.configured ? (
                  <span className="mt-3 text-xs text-zinc-500">Not configured yet.</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>

        {error ? <p className="mt-8 text-sm text-zinc-200">{error}</p> : null}

        <p className="mt-10 text-sm text-zinc-400">
          <Link href="/" className="underline-offset-4 hover:text-zinc-200 hover:underline">
            Back to Call
          </Link>
        </p>
      </div>
    </div>
  );
}
