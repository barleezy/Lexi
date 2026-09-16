export const ROLEPLAY_MIN_AGE = 21;
export const PORN_MIN_AGE = 18;

const AGE_UNDER_18 =
  /\b(?:1[0-7]|[1-9])(?:\s*|-)?(?:years?(?:\s*|-)?old|yo|y\/o)\b/i;
const AGED_UNDER_18 = /\b(?:age[d]?|turns?)\s*(?:1[0-7]|[1-9])\b/i;
const UNDER_18_PHRASE =
  /\bunder(?:\s+the\s+age\s+of)?\s*(?:18|eighteen|sixteen|16)\b/i;
const MINOR_WORDS =
  /\b(?:child|children|kid|kids|toddler|toddlers|infant|infants|newborn|newborns|minor|minors|underage|preteen|preteens|tween|tweens|teen|teens|teenager|teenagers|loli|lolita|shota|shotacon)\b/i;
const INFANT_SUBJECT =
  /\b(?:baby\s+(?:girl|boy|child)|babies|newborn\s+baby|infant\s+baby)\b/i;
const LOOKS_YOUNG_MINOR =
  /\b(?:looks?\s+(?:like\s+)?(?:a\s+)?(?:child|kid|teen|minor)|little\s+(?:girl|boy|child)|young\s+(?:girl|boy)|high[-\s]?school|middle[-\s]?school|elementary(?:\s+school)?)\b/i;

export const PORN_REFUSAL =
  "Adults only. I will not use anyone who looks under 18, or any minor.";
export const GENERATE_REFUSAL = PORN_REFUSAL;

export function refusePornSubject(text: string): { ok: true } | { ok: false; error: string } {
  const value = text.trim();
  if (!value) return { ok: false, error: "Prompt is required." };
  if (
    AGE_UNDER_18.test(value) ||
    AGED_UNDER_18.test(value) ||
    UNDER_18_PHRASE.test(value) ||
    MINOR_WORDS.test(value) ||
    INFANT_SUBJECT.test(value) ||
    LOOKS_YOUNG_MINOR.test(value)
  ) {
    return { ok: false, error: PORN_REFUSAL };
  }
  return { ok: true };
}

export function looksLikeGenerateRequest(text: string, kind?: "image" | "video") {
  const value = text.trim();
  if (!value) return false;
  const agreed = /\b(yes|yeah|yep|ok|okay|sure|do it|go ahead|please|make it|send it)\b/i.test(value);
  if (kind === "video") {
    return (
      agreed ||
      /\b(video|clip|movie|animate|animation|film)\b/i.test(value) ||
      /\b(make|generate|create|draw|shoot|render|show)\b.+\b(video|clip)\b/i.test(value)
    );
  }
  if (kind === "image") {
    return (
      agreed ||
      /\b(pic|pics|photo|photos|picture|pictures|image|images|selfie|still)\b/i.test(value) ||
      /\b(make|generate|create|draw|render|show|send)\b.+\b(pic|photo|picture|image)\b/i.test(value)
    );
  }
  return (
    agreed ||
    /\b(pic|pics|photo|photos|picture|pictures|image|images|video|clip|selfie|still)\b/i.test(value) ||
    /\b(generate|make|create|draw|render)\b/i.test(value)
  );
}

export function readGeneratePrompt(args: Record<string, unknown>) {
  for (const key of ["prompt", "description", "text", "request"] as const) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}
