import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Terms of Service · Talk To Lexi",
  description: "Terms of Service for Talk to Lexi accounts, minutes, and voice calls.",
};

const SUPPORT_EMAIL = "support@talktolexi.app";

export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p
            className="buy-subtitle text-base tracking-wide sm:text-lg"
            style={{ color: "var(--buy-pink-muted)" }}
          >
            Effective date: September 17, 2026
          </p>
        </header>

        <article className="buy-card mt-12 w-full space-y-8 rounded-[1.75rem] px-6 py-8 text-sm leading-7 text-zinc-200 sm:mt-16 sm:px-10 sm:py-10 sm:text-base sm:leading-8">
          <p>By creating an account or using Talk to Lexi you agree to these terms.</p>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">The product</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Talk to Lexi is software. Lexi is not a person, not a licensed therapist, not a doctor,
              not a lawyer, and not emergency services. If you are in danger, call 911 or local
              emergency services.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Age</h2>
            <p style={{ color: "var(--buy-muted)" }}>You must be 18 or older.</p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Account</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              You are responsible for the username and password. Email is optional on sign-in but
              required for password reset and receipts. Do not share the account.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Plans and minutes</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>
                Minute packs are prepaid voice seconds. They are consumed when a live call is minted
                and settled
              </li>
              <li>The monthly plan is $9.99 per month until you cancel</li>
              <li>Rehearsal / on-device speech does not spend live minutes</li>
              <li>
                If the wallet is under 30 seconds, live Call is refused until you buy more or{" "}
                <Link href="/subscribe" className="text-pink-300 underline-offset-4 hover:underline">
                  subscribe
                </Link>
              </li>
              <li>Prices can change. The price at checkout is the price you pay</li>
            </ul>
            <p style={{ color: "var(--buy-muted)" }}>
              Refunds:{" "}
              <Link href="/refund" className="text-pink-300 underline-offset-4 hover:underline">
                https://www.talktolexi.app/refund
              </Link>
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">CarPlay</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Hands-free only. You stay responsible for the vehicle. Do not watch video on the head
              unit. Do not use the app in a way that distracts you from driving.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Acceptable use</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Do not break the law, steal accounts or minutes, probe or overload the service, resell
              access, or present Lexi’s output as an unaided human where the law requires disclosure.
            </p>
            <p style={{ color: "var(--buy-muted)" }}>
              We can suspend an account for abuse, chargebacks, or fraud.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Your content</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              You keep what you say. You give us a license to process it so Lexi can answer, remember
              what you asked her to remember, and meter the call.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Our content</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              The name Talk to Lexi, the site, the app, and Lexi’s voice/persona are ours or our
              licensors’. You get a personal, non-transferable license to use the service. You do not
              buy Lexi.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Third parties</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Voice runs on xAI. Payments run on Stripe. Hosting, email, and Apple services are
              described in the{" "}
              <Link href="/privacy" className="text-pink-300 underline-offset-4 hover:underline">
                Privacy Policy
              </Link>
              . Their outages can take Lexi down and are not a refund by themselves.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Disclaimer</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              The service is provided “as is.” We do not promise she will always hear you, always
              remember, or always be available. Our total liability for a claim is the amount you
              paid us in the 30 days before the claim. We are not liable for indirect or
              consequential damages.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Termination</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Email{" "}
              <a className="text-pink-300 underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              to close the account. We can close it for violation of these terms. Unused minutes
              follow the{" "}
              <Link href="/refund" className="text-pink-300 underline-offset-4 hover:underline">
                Refund Policy
              </Link>
              .
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Law</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Governed by the laws of the State of New Jersey, excluding conflict-of-law rules.
              Courts in New Jersey have venue except where a consumer law in your state says
              otherwise.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Changes</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              We can update these terms. The version on the site when you use the service applies.
            </p>
          </section>

          <p>
            Contact:{" "}
            <a className="text-pink-300 underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </p>
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
