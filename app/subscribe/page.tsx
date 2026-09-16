const STRIPE_PAYMENT_LINK = "https://buy.stripe.com/3cIfZgeEkbjgbI91aA6Vq00";

export const metadata = {
  title: "Subscribe · Lexi",
  description: "Subscribe to Lexi.",
  robots: { index: false, follow: false },
};

export default function SubscribePage() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-500">Lexi</p>
        <h1 className="text-3xl font-semibold tracking-tight">Subscribe</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Complete checkout with Stripe. Use the same email as your Lexi account.
        </p>
      </div>
      <a
        href={STRIPE_PAYMENT_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center justify-center rounded-md bg-neutral-900 px-4 py-3 text-sm font-medium text-white dark:bg-neutral-100 dark:text-neutral-900"
      >
        Subscribe with Stripe
      </a>
    </main>
  );
}
