import Image from "next/image";

export const metadata = {
  title: "Refund and Return Policy · Talk To Lexi",
  description: "Refund and return policy for Talk to Lexi minute packs and the monthly plan.",
};

const SUPPORT_EMAIL = "barleezy@talktolexi.app";

export default function RefundPage() {
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
          list-style: disc;
          padding-left: 1.15rem;
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
            Refund and Return Policy
          </h1>
          <p
            className="buy-subtitle text-base tracking-wide sm:text-lg"
            style={{ color: "var(--buy-pink-muted)" }}
          >
            Effective date: September 17, 2026
          </p>
        </header>

        <article className="buy-card mt-12 w-full space-y-8 rounded-[1.75rem] px-6 py-8 text-sm leading-7 text-zinc-200 sm:mt-16 sm:px-10 sm:py-10 sm:text-base sm:leading-8">
          <p>
            Talk to Lexi sells digital access only. There is nothing physical to ship or mail back.
            “Return” means a refund of unused paid access.
          </p>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">What you can buy</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>Minute packs (Whisper, Murmur, Echo): one-time prepaid voice seconds</li>
              <li>Monthly plan: $9.99 / month, recurring until you cancel</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Minute packs</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>Unused packs: request a full refund within 14 days of purchase</li>
              <li>Partly used packs: we refund unused seconds only, same 14-day window</li>
              <li>Used seconds are not refundable</li>
              <li>After 14 days, pack purchases are final</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Monthly plan</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>Cancel anytime. Access stays through the end of the paid period</li>
              <li>
                Full refund if you ask within 7 days of the charge and you have not used live voice
                that period
              </li>
              <li>If you used live voice that period, that charge is not refunded</li>
              <li>We do not prorate leftover days after the 7-day window</li>
              <li>Canceling stops the next charge. It does not automatically refund the current month</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">How to cancel</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Sign in → Subscribe → cancel, or email support. Cancel before the renewal date if you
              do not want the next charge.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">How to request a refund</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Email{" "}
              <a className="text-pink-300 underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              from the account email with username, date of charge, pack name or “Monthly”, and last
              four of the card if available.
            </p>
            <p style={{ color: "var(--buy-muted)" }}>
              We aim to answer in 3 business days. Approved refunds go back to the original payment
              method through Stripe. Bank timing is 5–10 business days.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">What we will not refund</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>Rehearsal / no-spend mode (no charge)</li>
              <li>Minutes or days already used</li>
              <li>Failed calls caused by the user’s network, device, or hanging up</li>
              <li>Chargebacks filed before emailing us</li>
              <li>Taxes and payment-processor fees we cannot recover</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Chargebacks</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Email us first. A chargeback on a valid charge can freeze the account until it is
              resolved.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Changes</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              We can update this page. The version on talktolexi.app on the date of purchase applies
              to that purchase.
            </p>
          </section>

          <p>
            Questions:{" "}
            <a className="text-pink-300 underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </p>
        </article>
      </div>
    </main>
  );
}
