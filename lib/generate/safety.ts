const AGE_UNDER_21 =
  /\b(?:1[0-9]|[1-9]|20)(?:\s*|-)?(?:years?(?:\s*|-)?old|yo|y\/o)\b/i;
const AGED_UNDER_21 = /\b(?:age[d]?|turns?)\s*(?:1[0-9]|[1-9]|20)\b/i;
const UNDER_21_PHRASE =
  /\bunder(?:\s+the\s+age\s+of)?\s*(?:21|twenty[-\s]?one|18|eighteen|sixteen|16)\b/i;
const MINOR_WORDS =
  /\b(?:child|children|kid|kids|toddler|toddlers|infant|infants|newborn|newborns|minor|minors|underage|preteen|preteens|tween|tweens|teen|teens|teenager|teenagers|loli|lolita|shota|shotacon)\b/i;
const INFANT_SUBJECT =
  /\b(?:baby\s+(?:girl|boy|child)|babies|newborn\s+baby|infant\s+baby)\b/i;
const LOOKS_YOUNG_MINOR =
  /\b(?:looks?\s+(?:like\s+)?(?:a\s+)?(?:child|kid|teen|minor)|little\s+(?:girl|boy|child)|young\s+(?:girl|boy)|high[-\s]?school|middle[-\s]?school|elementary(?:\s+school)?)\b/i;

export const GENERATE_REFUSAL =
  "Adults only. I will not generate anyone who looks under 21, or any minor.";

export function refuseUnder21Prompt(prompt: string): { ok: true } | { ok: false; error: string } {
  const text = prompt.trim();
  if (!text) return { ok: false, error: "Prompt is required." };
  if (
    AGE_UNDER_21.test(text) ||
    AGED_UNDER_21.test(text) ||
    UNDER_21_PHRASE.test(text) ||
    MINOR_WORDS.test(text) ||
    INFANT_SUBJECT.test(text) ||
    LOOKS_YOUNG_MINOR.test(text)
  ) {
    return { ok: false, error: GENERATE_REFUSAL };
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
