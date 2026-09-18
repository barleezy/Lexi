import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteChrome } from "@/components/site-chrome";
import { readIncomingAuthSession } from "@/lib/auth/session";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "optional",
  preload: false,
});

export const metadata: Metadata = {
  title: "Lexi",
  description: "A voice-first companion.",
  icons: {
    icon: "/lexi-icon.png",
    apple: "/apple-touch-icon.png",
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Cookie HMAC only — no Neon/Stripe. Home hides SiteHeader; other routes
  // can treat subscribed as unknown until their own pages load wallet state.
  const session = await readIncomingAuthSession();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        <SiteChrome signedIn={Boolean(session)}>
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
