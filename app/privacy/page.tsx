import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy · Talk To Lexi",
  description: "Privacy policy for Talk to Lexi on the web, iPhone, and CarPlay.",
};

const SUPPORT_EMAIL = "support@talktolexi.app";

export default function PrivacyPage() {
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
            Privacy Policy
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
            Talk to Lexi is operated by Ian Barlow. Contact:{" "}
            <a className="text-pink-300 underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
              {SUPPORT_EMAIL}
            </a>
          </p>
          <p>This policy covers talktolexi.app and the Talk to Lexi iPhone / CarPlay app.</p>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">What we collect</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>Account: username, password (hashed), optional email</li>
              <li>Session: signed-in cookie or iOS token</li>
              <li>
                Billing: Stripe customer and checkout IDs, pack and subscription status, voice-second
                balance. We do not store full card numbers
              </li>
              <li>Voice and chat: what you say or type to Lexi, short call summaries, memory facts you want kept</li>
              <li>Optional location: only if you tap Share location, used for local weather</li>
              <li>Optional Apple Music: only if you connect it</li>
              <li>Device basics: app version, iPhone or CarPlay, crash/error logs</li>
              <li>Emails we send: sign-in, password reset, billing receipts</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">What we do not collect</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>Card PAN / CVC (Stripe handles that)</li>
              <li>An xAI key on the phone</li>
              <li>Location in the background</li>
              <li>CarPlay video or photos of the road</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">How we use it</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>Run the product</li>
              <li>Meter live voice minutes and settle the wallet</li>
              <li>Charge packs and the monthly plan through Stripe</li>
              <li>Send reset codes and receipts</li>
              <li>Fix bugs and stop abuse</li>
              <li>Weather, only after you share location</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Who else sees it</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>Stripe — payments</li>
              <li>xAI — voice and text</li>
              <li>Vercel — hosts the site</li>
              <li>Our database host — accounts, balances, memories</li>
              <li>Resend — transactional email</li>
              <li>Apple — App Store, Sign in with Apple, Apple Music, or CarPlay if you use them</li>
            </ul>
          </section>

          <p>We do not sell your personal information. We do not sell voice recordings.</p>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Memory</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Lexi keeps short facts and call summaries so the next call is not a blank slate. Email{" "}
              <a className="text-pink-300 underline-offset-4 hover:underline" href={`mailto:${SUPPORT_EMAIL}`}>
                {SUPPORT_EMAIL}
              </a>{" "}
              to delete stored memory. Deleting the account deletes memory with it.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Retention</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>Account and billing: while open, then as long as tax/fraud rules require</li>
              <li>Voice minutes ledger: while the account is open</li>
              <li>Call summaries / memory: until you delete them or close the account</li>
              <li>Logs: a short window unless needed for security</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Your choices</h2>
            <ul className="space-y-2" style={{ color: "var(--buy-muted)" }}>
              <li>Do not share location</li>
              <li>Do not connect Apple Music</li>
              <li>Stay in rehearsal / no-spend mode</li>
              <li>Email us to export or delete your account</li>
              <li>
                Cancel the monthly plan on{" "}
                <Link href="/account" className="text-pink-300 underline-offset-4 hover:underline">
                  /account
                </Link>
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Kids</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Talk to Lexi is for people 18 or older. We do not knowingly collect data from children.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Security</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              Passwords are hashed. Live voice tokens are short-lived and minted on the server. The xAI
              key never ships in the iPhone app.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium tracking-wide">Changes</h2>
            <p style={{ color: "var(--buy-muted)" }}>
              We will update this page when the product changes. Continued use means you accept the
              current version.
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
