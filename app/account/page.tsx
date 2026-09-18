import { connection } from "next/server";
import { readIncomingAuthSession } from "@/lib/auth/session";
import { findAccountRow } from "@/lib/auth/accounts";
import { creditPaidCheckoutsForUser, readAccountSubscriptionCancelState } from "@/lib/wallet/stripe";
import { readAccountSubscribed } from "@/lib/wallet/subscription";
import { readAllottedVoiceSeconds } from "@/lib/wallet/allotment";
import { maybeRefillMonthlyMinutes, sweepStaleVoiceSessions } from "@/lib/wallet/voice";
import { AccountClient } from "./account-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Account · Talk To Lexi",
  description: "Your Talk To Lexi email, minutes, and subscription.",
};

export default async function AccountPage() {
  await connection();
  let signedIn = false;
  let email = "";
  let subscribed = false;
  let voiceSeconds = 0;
  let cancelAtPeriodEnd = false;

  try {
    const session = await readIncomingAuthSession();
    const userId = session?.userId ?? "";
    signedIn = Boolean(session);
    if (userId) {
      await sweepStaleVoiceSessions(userId);
      await creditPaidCheckoutsForUser(userId);
      await maybeRefillMonthlyMinutes(userId);
      const [account, nextSubscribed, seconds, cancelState] = await Promise.all([
        findAccountRow(userId),
        readAccountSubscribed(userId),
        readAllottedVoiceSeconds(userId),
        readAccountSubscriptionCancelState({ userId }),
      ]);
      email = (account?.email ?? "").trim();
      subscribed = nextSubscribed;
      voiceSeconds = seconds ?? 0;
      cancelAtPeriodEnd = cancelState.cancelAtPeriodEnd;
    }
  } catch {
    // Cookie or wallet failure must not blank the route — unsigned UI still renders.
  }

  return (
    <main className="flex min-h-dvh w-full flex-1 flex-col font-sans text-zinc-100">
      <AccountClient
        signedIn={signedIn}
        email={email}
        subscribed={subscribed}
        voiceSeconds={voiceSeconds}
        cancelAtPeriodEnd={cancelAtPeriodEnd}
      />
    </main>
  );
}
