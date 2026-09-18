import { allottedVoiceSeconds } from "./voice-rate";
import { computeLedgerVoiceSeconds } from "./voice";
import { readXaiPrepaidRemainingUsd } from "./xai-topup";

/**
 * Display/usable allotted seconds for any signed-in account.
 * Wallet is ledger remaining (earned packs − settled usage − holds).
 * min(wallet, prepaid USD / $0.08) when team prepaid is known.
 * Not gated on admin / Ian / Barleezy.
 */
export async function readAllottedVoiceSeconds(userId: string) {
  const wallet = await computeLedgerVoiceSeconds(userId);
  if (wallet == null) return null;
  const prepaid = await readXaiPrepaidRemainingUsd();
  return allottedVoiceSeconds(wallet, prepaid?.usd ?? null);
}
