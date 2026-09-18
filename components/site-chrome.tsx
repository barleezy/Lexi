"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

export function SiteChrome({
  children,
  signedIn = false,
}: {
  children: ReactNode;
  signedIn?: boolean;
}) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isWatch = pathname === "/watch";
  const isIosAuth = pathname === "/ios/signin" || pathname.startsWith("/ios/");
  const isAndroidAuth = pathname === "/android/signin" || pathname.startsWith("/android/");
  const isNativeAuth = isIosAuth || isAndroidAuth;
  const showHeader = !(isHome || isWatch || isNativeAuth);
  const [subscribed, setSubscribed] = useState(false);

  useEffect(() => {
    if (!signedIn || !showHeader) {
      setSubscribed(false);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/billing/balance", {
          cache: "no-store",
          credentials: "include",
        });
        if (!response.ok) {
          if (!cancelled) setSubscribed(false);
          return;
        }
        const body = (await response.json()) as { subscribed?: boolean };
        if (!cancelled) setSubscribed(body.subscribed === true);
      } catch {
        if (!cancelled) setSubscribed(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [signedIn, showHeader]);

  return (
    <div className="flex min-h-dvh flex-1 flex-col">
      {isHome || isWatch || isIosAuth || isAndroidAuth ? null : (
        <SiteHeader signedIn={signedIn} subscribed={subscribed} />
      )}
      <div className="flex w-full flex-1 flex-col">{children}</div>
      {isHome || isWatch || isIosAuth || isAndroidAuth ? null : <SiteFooter />}
    </div>
  );
}
