import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Site · Talk To Lexi",
  description: "Every public page on Talk to Lexi.",
};

export default function SitePage() {
  return (
    <main className="buy-page relative flex min-h-dvh flex-1 flex-col overflow-hidden font-sans text-zinc-100">
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
        .buy-card h2 {
          color: var(--buy-pink);
        }
        .buy-card ul {
          list-style: none;
          padding-left: 0;
        }
        .buy-card a {
          color: #f9a8d4;
          text-underline-offset: 4px;
        }
        .buy-card a:hover {
          text-decoration: underline;
        }
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

      <div className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center px-6 py-14 sm:px-10 sm:py-20">
        <header className="buy-title space-y-3 text-center">
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-pink-300/80">Talk To Lexi</p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl md:text-6xl">
            Site
          </h1>
          <p
            className="buy-subtitle text-base tracking-wide sm:text-lg"
            style={{ color: "var(--buy-pink-muted)" }}
          >
            Every public page on Talk to Lexi.
          </p>
        </header>

        <article className="buy-card mt-12 w-full space-y-8 rounded-[1.75rem] px-6 py-8 text-sm leading-7 text-zinc-200 sm:mt-16 sm:px-10 sm:py-10 sm:text-base sm:leading-8">
          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Talk</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>
                • <Link href="/">Home</Link> — /
              </li>
              <li>
                • <Link href="/buy">Buy minutes</Link> — /buy
              </li>
              <li>
                • <Link href="/buy/success">Checkout success</Link> — /buy/success
              </li>
              <li>
                • <Link href="/subscribe">Subscribe</Link> — /subscribe
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Account help</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>
                • <Link href="/support">Support</Link> — /support
              </li>
              <li>
                • <Link href="/help">Help</Link> — /help
              </li>
              <li>
                • <Link href="/contact">Contact</Link> — /contact
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Money and legal</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>
                • <Link href="/refund">Refunds</Link> — /refund
              </li>
              <li>
                • <Link href="/refunds">Refunds (alias)</Link> — /refunds
              </li>
              <li>
                • <Link href="/return-policy">Return policy</Link> — /return-policy
              </li>
              <li>
                • <Link href="/privacy">Privacy</Link> — /privacy
              </li>
              <li>
                • <Link href="/terms">Terms</Link> — /terms
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">This directory</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>
                • <Link href="/site">Site</Link> — /site
              </li>
              <li>
                • <Link href="/directory">Directory</Link> — /directory
              </li>
              <li>
                • <Link href="/links">Links</Link> — /links
              </li>
            </ul>
          </section>
        </article>

        <p className="mt-auto pt-12 text-sm text-zinc-400">
          <Link href="/buy" className="underline-offset-4 hover:underline hover:text-white">
            Buy minutes
          </Link>
          <span className="px-2">·</span>
          <Link href="/subscribe" className="underline-offset-4 hover:underline hover:text-white">
            Subscribe
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
    </main>
  );
}
