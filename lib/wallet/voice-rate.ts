/**
 * Billed Speech-to-Speech usage rate ($/min).
 *
 * Allotted minutes = prepaid USD / VOICE_USD_PER_MINUTE.
 * This is the live xAI voice usage price, not a pack SKU. Pack catalog
 * minutes (Whisper 10 / Murmur 30 / Echo 60) stay on the buy page.
 *
 * Global for every signed-in account — not gated on admin / Ian / Barleezy.
 */

export const VOICE_USD_PER_MINUTE = 0.08;

/** Seconds = round(usd / 0.08 * 60). $4.70 → 3525s (58.75 min / 58m 45s). */
export function usdToVoiceSeconds(usd: number) {
  const dollars = Number(usd);
  if (!Number.isFinite(dollars) || dollars <= 0) return 0;
  return Math.round((dollars / VOICE_USD_PER_MINUTE) * 60);
}

export function voiceSecondsToUsd(seconds: number) {
  const value = Math.max(0, Number(seconds) || 0);
  return (value / 60) * VOICE_USD_PER_MINUTE;
}

/**
 * Display/usable allotment: never more minutes than prepaid buys at $0.08/min.
 * When prepaid is unknown, return the wallet as-is — do not invent Echo 60.
 */
export function allottedVoiceSeconds(walletSeconds: number, prepaidUsd: number | null | undefined) {
  const wallet = Math.max(0, Math.floor(Number(walletSeconds) || 0));
  if (prepaidUsd == null || !Number.isFinite(prepaidUsd)) return wallet;
  return Math.min(wallet, usdToVoiceSeconds(prepaidUsd));
}

/**
 * xAI prepaid `total.val` is USD cents on an inverted ledger:
 * remaining credit is negative (example: "-470" → $4.70).
 */
export function prepaidLedgerCentsToUsd(val: unknown) {
  if (val == null || val === "") return null;
  const cents = typeof val === "number" ? val : Number(String(val).trim());
  if (!Number.isFinite(cents)) return null;
  return Math.max(0, -cents / 100);
}
