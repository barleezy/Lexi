import Image from "next/image";
import Link from "next/link";

export const metadata = {
  title: "Minutes added · Talk To Lexi",
  description: "Your Lexi voice minutes were added.",
};

export default function BuySuccessPage() {
  return (
    <main className="relative flex min-h-dvh flex-1 flex-col overflow-hidden bg-black font-sans text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0">
        <Image
          src="/lexi.jpg"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-[center_18%] opacity-55"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/45 to-black/90" />
      </div>
      <div className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-sm font-medium tracking-wide text-[#e8a0c0]">Talk To Lexi</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Minutes added</h1>
        <p className="mt-4 text-base leading-7 text-zinc-300">
          Your balance updates when Stripe confirms payment. Start a Call whenever you are ready.
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex rounded-full border border-[#ff4db8] bg-[#ff4db8]/20 px-6 py-3 text-sm font-semibold text-white shadow-[0_0_20px_rgba(255,77,184,0.35)]"
        >
          Back to Call
        </Link>
      </div>
    </main>
  );
}
