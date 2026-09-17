import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Support · Talk To Lexi",
  description: "Questions, billing, or a broken call — email Ian at Talk to Lexi.",
};

const SUPPORT_EMAIL = "barleezy@talktolexi.app";

export default function SupportPage() {
  return (
    <main className="buy-page relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto font-sans text-zinc-100">
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
            Support
          </h1>
          <p
            className="buy-subtitle text-base tracking-wide sm:text-lg"
            style={{ color: "var(--buy-pink-muted)" }}
          >
            Questions, billing, or a broken call — email Ian.
          </p>
        </header>

        <article className="buy-card mt-12 w-full space-y-8 rounded-[1.75rem] px-6 py-8 text-sm leading-7 text-zinc-200 sm:mt-16 sm:px-10 sm:py-10 sm:text-base sm:leading-8">
          <p>
            Email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{" "}
            from the email on your account if you have one. Include your username. For billing, include the date of the charge and whether it was Whisper, Murmur, Echo, or Monthly.
          </p>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">What I can help with</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>• Sign-in, password reset, account delete</li>
              <li>• Minute packs and the $9.99 monthly plan</li>
              <li>
                • Refunds (see{" "}
                <Link href="/refund">/refund</Link>)
              </li>
              <li>• Live Call vs rehearsal / no-spend</li>
              <li>• Memory delete</li>
              <li>• CarPlay and the iPhone app</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Typical reply time</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              3 business days. Same-day if I am at the laptop.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Before you email</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>• Rehearsal / no-spend does not use live minutes and will not charge</li>
              <li>
                • Live Call needs a signed-in account and at least 30 seconds in the wallet, or an active monthly plan once billing is live
              </li>
              <li>
                • Packs are one-time minutes. Monthly is recurring until you cancel on{" "}
                <Link href="/subscribe">/subscribe</Link>
              </li>
              <li>
                • Refunds:{" "}
                <Link href="/refund">/refund</Link>
              </li>
              <li>
                • Privacy:{" "}
                <Link href="/privacy">/privacy</Link>
              </li>
              <li>
                • Terms:{" "}
                <Link href="/terms">/terms</Link>
              </li>
            </ul>
          </section>
        </article>
      </div>
    </main>
  );
}
