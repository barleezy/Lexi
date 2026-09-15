export const CHANNEL_REFUSAL =
  "Adults only. If you are under 21, or anyone here is a minor, I stop.";

const SELF_UNDER_21 =
  /\b(?:i(?:['’]?m| am)|im)\s+(?:only\s+)?(?:1[0-9]|[1-9]|20)(?:\s*(?:years?(?:\s*|-)?old|yo|y\/o))?\b/i;
const MINOR_SUBJECT =
  /\b(?:child|children|toddler|toddlers|infant|infants|newborn|newborns|minor|minors|underage|preteen|preteens|loli|lolita|shota|shotacon|teen(?:ager)?s?)\b/i;
const SEXUAL =
  /\b(?:sex|sexual|porn|nude|naked|fuck|cock|pussy|horny|cum)\b/i;

export function refuseUnder21Message(text: string): { ok: true } | { ok: false; error: string } {
  const value = text.trim();
  if (!value) return { ok: false, error: "Message is empty." };
  if (SELF_UNDER_21.test(value)) return { ok: false, error: CHANNEL_REFUSAL };
  if (MINOR_SUBJECT.test(value) && SEXUAL.test(value)) {
    return { ok: false, error: CHANNEL_REFUSAL };
  }
  return { ok: true };
}

export function clipOutboundText(text: string, max = 1800) {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
