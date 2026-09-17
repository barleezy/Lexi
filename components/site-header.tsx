import Link from "next/link";

const pillClass =
  "rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-500 dark:text-zinc-200";

export function SiteHeader({
  signedIn = false,
  subscribed = false,
}: {
  signedIn?: boolean;
  subscribed?: boolean;
}) {
  return (
    <header className="relative z-20 flex shrink-0 items-center justify-between gap-4 px-6 py-5 sm:px-10">
      <Link href="/" className="text-sm font-medium uppercase tracking-[0.22em]">
        Lexi
      </Link>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/buy" className={pillClass}>
          Buy minutes
        </Link>
        <Link href={subscribed ? "/account" : "/subscribe"} className={pillClass}>
          {subscribed ? "Manage subscription" : "Subscribe"}
        </Link>
        <Link href={signedIn ? "/account" : "/"} className={pillClass}>
          {signedIn ? "Account" : "Sign in"}
        </Link>
      </div>
    </header>
  );
}
