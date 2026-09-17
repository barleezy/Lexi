import { ResetPasswordForm } from "./reset-form";

export const metadata = {
  title: "Reset password · Lexi",
  description: "Set a new Lexi password with a one-time email code.",
  robots: { index: false, follow: false },
};

function firstString(value: string | string[] | undefined) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return "";
}

function safeNext(raw: string) {
  if (raw.startsWith("/ios/signin")) return raw;
  if (raw === "/" || raw === "") return "/";
  return "/";
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const token = firstString(params.token) || firstString(params.code);
  const nextHref = safeNext(firstString(params.next));

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2">
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-500">Lexi</p>
        <h1 className="text-3xl font-semibold tracking-tight">Reset password</h1>
        <p className="text-neutral-600 dark:text-neutral-400">
          Use the one-time code from your email. We cannot send the old password — only a new one
          you choose.
        </p>
      </div>
      <ResetPasswordForm defaultToken={token} nextHref={nextHref} />
    </main>
  );
}
