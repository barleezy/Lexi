import Link from "next/link";
import Image from "next/image";

export const metadata = {
  title: "Subscribed · Talk To Lexi",
  description: "Your Lexi monthly plan is set up.",
};

export default function SubscribeSuccessPage() {
  return (
    <main className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto font-sans text-zinc-100">
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
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">You are subscribed</h1>
          <p className="text-base leading-7 text-zinc-400">
            Stripe confirms the monthly plan when payment completes. You can start a Call whenever
            you are ready.
          </p>
          <Link
            href="/"
            className="inline-flex rounded-full bg-pink-400 px-6 py-3 text-sm font-semibold text-zinc-950"
          >
            Back to Call
          </Link>
        </div>
      </div>
    </main>
  );
}
