"use client";

import Image from "next/image";
import { BuyPacks, type BuyPackCard } from "@/components/buy-packs";

export type { BuyPackCard };

export function BuyClient({
  packs,
  signedIn,
  stripeReady,
}: {
  packs: BuyPackCard[];
  signedIn: boolean;
  stripeReady: boolean;
}) {
  return (
    <div className="buy-page relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto">
      <style>{`
        .buy-page {
          --buy-pink: #f472b6;
          --buy-pink-muted: #e8a0c0;
        }
        @keyframes buy-title-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .buy-title { animation: buy-title-in 0.7s ease-out both; }
        .buy-subtitle { animation: buy-title-in 0.7s ease-out 0.12s both; }
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
            Choose Your AI Companion Plan
          </p>
        </header>

        {!stripeReady ? (
          <p className="mt-8 max-w-xl text-center text-sm text-zinc-300" role="status">
            Checkout is not configured on this server yet. Whisper, Murmur, and Echo are listed
            below — payment will not start until billing is set up.
          </p>
        ) : !signedIn ? (
          <p className="mt-8 max-w-xl text-center text-sm text-zinc-300" role="status">
            Sign in to buy minutes. Your packs stay on this page after you come back.
          </p>
        ) : null}

        <BuyPacks packs={packs} signedIn={signedIn} className="mt-12 w-full max-w-4xl sm:mt-16" />
      </div>
    </div>
  );
}
