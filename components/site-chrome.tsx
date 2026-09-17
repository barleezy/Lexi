"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
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

  return (
    <>
      {isHome || isWatch || isIosAuth ? null : <SiteHeader signedIn={signedIn} />}
      <div className="flex flex-1 flex-col">{children}</div>
      {isIosAuth ? null : <SiteFooter />}
    </>
  );
}
