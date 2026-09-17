import Link from "next/link";

const DIRECTORY_LINKS = [
  { href: "/refund", label: "Refunds" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/support", label: "Support" },
  { href: "/site", label: "Site" },
] as const;

export function SiteFooter() {
  return (
    <footer className="relative z-20 mt-auto w-full shrink-0 px-6 py-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
      <nav aria-label="Directory">
        {DIRECTORY_LINKS.map((link, index) => (
          <span key={link.href}>
            {index > 0 ? <span className="px-2">·</span> : null}
            <Link
              href={link.href}
              className="underline-offset-4 hover:underline hover:text-zinc-900 dark:hover:text-white"
            >
              {link.label}
            </Link>
          </span>
        ))}
      </nav>
    </footer>
  );
}
