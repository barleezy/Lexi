export type ToyControlIntent = "grant" | "revoke";

const GRANT_RE =
  /\b(?:take control|you have (?:full )?control|control the toys?|you can use the toys?|you (?:can|may) (?:have |take )?(?:full )?control|take over the toys?|give (?:you|lexi) (?:full )?(?:toy )?control|lexi,? take (?:control|over))\b/i;
const REVOKE_RE =
  /\b(?:stop controlling|no more toy control|take your hands off|hands off(?: the toys?)?|revoke(?: (?:toy )?control)?|(?:take|taking)(?: the)? control back|don'?t control(?: the)? toys?)\b/i;
const NEGATED_GRANT_RE =
  /\b(?:don'?t|do not|never|not)\b.{0,40}\b(?:take control|control the toys?|take over|give (?:you|lexi) (?:full )?(?:toy )?control)\b/i;

export function parseToyControlIntent(text: unknown): ToyControlIntent | null {
  if (typeof text !== "string") return null;
  const line = text.trim();
  if (!line) return null;
  if (REVOKE_RE.test(line)) return "revoke";
  if (NEGATED_GRANT_RE.test(line)) return null;
  if (GRANT_RE.test(line)) return "grant";
  return null;
}

export function resolveToyControlRequest(input: {
  requested: boolean;
  lastUserUtterance?: unknown;
  alreadyGranted?: boolean;
}) {
  const intent = parseToyControlIntent(input.lastUserUtterance);
  if (input.requested) {
    if (intent === "grant") return { ok: true as const, granted: true };
    if (input.alreadyGranted) return { ok: true as const, granted: true };
    return {
      ok: false as const,
      granted: false,
      error: "Toy control stays denied until the user asks. Wait until they request it.",
    };
  }
  if (intent === "revoke") return { ok: true as const, granted: false };
  if (!input.alreadyGranted) return { ok: true as const, granted: false };
  return {
    ok: false as const,
    granted: true,
    error: "Toy control stays granted until the user asks you to stop.",
  };
}
