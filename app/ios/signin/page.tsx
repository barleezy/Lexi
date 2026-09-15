import { cookies } from "next/headers";
import { LEXI_USER_COOKIE, parseCallbackURI } from "@/lib/ios/auth";
import { normalizeUserId } from "@/lib/memory/user";
import { IosSignInForm } from "./signin-form";

export const metadata = {
  title: "Sign in · Talk to Lexi",
  description: "Connect the iPhone app to the same Lexi account.",
  robots: { index: false, follow: false },
};

function firstString(value: string | string[] | undefined) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

export default async function IosSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const redirectURI = firstString(params.redirect_uri) || firstString(params.redirectURI) || "talktolexi://auth";
  const state = firstString(params.state);
  const jar = await cookies();
  const fromCookie = jar.get(LEXI_USER_COOKIE)?.value;
  const userId = normalizeUserId(firstString(params.userId) || fromCookie);
  const callbackOk = Boolean(parseCallbackURI(redirectURI));

  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-500">Talk to Lexi</p>
        <h1 className="text-3xl font-semibold tracking-tight">Sign in on iPhone</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Sign in with your account and password, or create an account. This sets the same cookie
          the site uses, then returns a session to the native app.
        </p>
      </div>
      <IosSignInForm
        defaultUserId={userId}
        redirectURI={redirectURI}
        state={state}
        callbackOk={callbackOk}
      />
      <p className="text-xs leading-relaxed text-neutral-500">
        Adults only. Porn 18+, sexual roleplay 21+. Refuse anyone who is a minor. The iPhone app
        holds the Grok voice session natively — this page is only account sign-in.
      </p>
    </main>
  );
}
