import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteChrome } from "@/components/site-chrome";
import { readIncomingAuthSession } from "@/lib/auth/session";
import { readStoredSubscribed } from "@/lib/wallet/subscription";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
  const session = await readIncomingAuthSession();
  const subscribed = session ? await readStoredSubscribed(session.userId) : false;

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} min-h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SiteChrome signedIn={Boolean(session)} subscribed={subscribed}>
          {children}
        </SiteChrome>
      </body>
    </html>
  );
}
