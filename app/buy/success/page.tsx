import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Minutes added · Talk To Lexi",
  description: "Your Lexi voice minutes were added.",
};

export default function BuySuccessPage() {
  return (
    <main className="relative flex min-h-dvh flex-1 flex-col overflow-hidden font-sans text-zinc-100">
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-black">
        <Image
          src="/lexi.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_18%] opacity-55 sm:object-[70%_20%]"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/55 to-black/90" />
      </div>
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="w-full max-w-md space-y-4">
          <p className="text-sm font-medium uppercase tracking-[0.22em] text-pink-300/80">Talk To Lexi</p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Minutes added</h1>
          <p className="text-base leading-7 text-zinc-400">
            Your balance updates when Stripe confirms payment. You can start a Call whenever you are
            ready.
          </p>
          <Link
            href="/"
            className="inline-flex rounded-full bg-pink-400 px-6 py-3 text-sm font-semibold text-zinc-950"
          >
            Back to Call
          </Link>
        </div>
        <p className="mt-12 text-sm text-zinc-400">
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
        </p>
      </div>
    </main>
  );
}
