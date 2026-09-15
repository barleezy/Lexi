export const FACT_KEYS = ["name", "pets", "location", "commitments"] as const;
export type FactKey = (typeof FACT_KEYS)[number];

/** Stable self-identity. Always stored at affect 10; other keys use the scorer. */
export const IDENTITY_KEYS = ["name"] as const satisfies readonly FactKey[];
export type IdentityKey = (typeof IDENTITY_KEYS)[number];

export function isIdentityKey(key: string): key is IdentityKey {
  return (IDENTITY_KEYS as readonly string[]).includes(key);
}

export type ExtractedFact = {
  memoryKey: FactKey;
  value: string;
};

const GREETING = /^(hi|hey|hello|thanks|thank you|ok|okay|yeah|yep|yo|sup|good morning|good night|bye)[\s!.]*$/i;

const NAME_STOP = new Set([
  "a",
  "about",
  "actually",
  "already",
  "also",
  "an",
  "at",
  "back",
  "being",
  "busy",
  "calling",
  "coming",
  "currently",
  "done",
  "down",
  "early",
  "excited",
  "feeling",
  "fine",
  "from",
  "getting",
  "glad",
  "going",
  "good",
  "happy",
  "having",
  "here",
  "home",
  "in",
  "into",
  "just",
  "late",
  "lexi",
  "like",
  "living",
  "looking",
  "making",
  "new",
  "not",
  "off",
  "ok",
  "okay",
  "old",
  "on",
  "out",
  "pretty",
  "quite",
  "ready",
  "really",
  "sad",
  "so",
  "sorry",
  "still",
  "sure",
  "taking",
  "the",
  "there",
  "thinking",
  "tired",
  "to",
  "too",
  "trying",
  "up",
  "very",
  "with",
  "working",
]);

const PLACE_STOP =
  /^(a|an|the|my|this|that|trouble|love|meeting|hurry|middle|bed|school|class|car|traffic|front|charge|debt|pain|shock|luck|denial|call|session|hospital|kitchen|bathroom|office)\b/i;

function titleCase(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[A-Za-z][A-Za-z'-]*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
}

function looksLikeName(token: string) {
  const t = token.trim();
  if (!/^[A-Za-z][A-Za-z'-]{1,20}$/.test(t)) return false;
  return !NAME_STOP.has(t.toLowerCase());
}

function takeName(raw: string) {
  const parts = raw.trim().split(/\s+/).slice(0, 2);
  if (!parts.length || !parts.every(looksLikeName)) return null;
  return titleCase(parts.join(" "));
}

export function isGreeting(text: string) {
  return GREETING.test(text.trim());
}

export function userTextFromBlob(blob: string) {
  const match = blob.match(/User:\s*([\s\S]*?)(?:\n\s*Assistant:|$)/i);
  return (match?.[1] ?? blob).trim();
}

export function assistantTextFromBlob(blob: string) {
  const match = blob.match(/Assistant:\s*([\s\S]*)$/i);
  return (match?.[1] ?? "").trim();
}

export function extractName(text: string) {
  const t = text.trim();
  const explicit = t.match(/\b(?:my name(?:'s| is)|call me)\s+([A-Za-z][A-Za-z' -]{1,40})/i);
  if (explicit) return takeName(explicit[1].replace(/[.,!?;:]+$/g, ""));
  const intro = t.match(/\b(?:i'm|i am)\s+([A-Za-z][A-Za-z'-]{1,20})\b/i);
  if (intro) return takeName(intro[1]);
  return null;
}

export function extractPets(text: string) {
  const t = text.trim();
  const named = t.match(
    /\b(?:i have (?:a|an|two|three|\d+)?\s*)?(?:my\s+)?(dogs?|cats?|pupp(?:y|ies)|kittens?|pets?)(?:'s name)?\s+(?:named|called|is(?: called)?)\s+([A-Za-z][A-Za-z'-]{1,20})\b/i,
  );
  if (named) {
    const kind = named[1].toLowerCase().replace(/s$/, "").replace("puppie", "puppy");
    return `${titleCase(named[2])} (${kind})`;
  }
  const owned = t.match(/\bi have (?:a|an|two|three|\d+)?\s*(dogs?|cats?|pupp(?:y|ies)|kittens?|pets?)\b/i);
  if (owned) return owned[1].toLowerCase();
  return null;
}

function tidyPlace(raw: string) {
  const cut = raw.split(/\s+(?:and|but|so|because|where|which|that)\b/i)[0] ?? "";
  const trimmed = cut.trim().replace(/[.,!?;:]+$/g, "").replace(/\s+/g, " ");
  if (!trimmed || trimmed.length < 2 || trimmed.length > 40) return null;
  if (PLACE_STOP.test(trimmed)) return null;
  if (!/^[A-Za-z][A-Za-z0-9\s.',-]*$/.test(trimmed)) return null;
  if (trimmed === trimmed.toLowerCase()) return titleCase(trimmed);
  return trimmed;
}

export function extractLocation(text: string) {
  const t = text.trim();
  const live = t.match(/\bi live (?:in|near)\s+([^,.!?\n]{2,40})/i);
  if (live) return tidyPlace(live[1]);
  const from = t.match(/\bi(?:'m| am) (?:from|based in)\s+([^,.!?\n]{2,40})/i);
  if (from) return tidyPlace(from[1]);
  const here = t.match(/\bi(?:'m| am) in\s+([^,.!?\n]{2,40})/i);
  if (here) return tidyPlace(here[1]);
  return null;
}

function tidyCommitment(raw: string) {
  const trimmed = raw.trim().replace(/[.,!?;:]+$/g, "").replace(/\s+/g, " ");
  if (trimmed.length < 3 || trimmed.length > 80) return null;
  return trimmed;
}

export function extractCommitments(text: string) {
  const t = text.trim();
  const found: string[] = [];
  const patterns = [
    /\bi will\s+([^.!?\n]{5,80})/gi,
    /\bi promised\s+(?:to\s+)?([^.!?\n]{5,80})/gi,
    /\bi need to\s+([^.!?\n]{5,80})/gi,
    /\bmy goal is\s+(?:to\s+)?([^.!?\n]{5,80})/gi,
    /\bplease remember (?:that )?(?:my goal is\s+(?:to\s+)?)?([^.!?\n]{5,80})/gi,
    /\bremember (?:that )?my goal is\s+(?:to\s+)?([^.!?\n]{5,80})/gi,
    /\bkeep in mind (?:that )?([^.!?\n]{5,80})/gi,
    /\bdon'?t forget (?:to\s+)?([^.!?\n]{5,80})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of t.matchAll(pattern)) {
      const value = tidyCommitment(match[1] ?? "");
      if (value && !found.includes(value)) found.push(value);
    }
  }
  if (!found.length) return null;
  return found.join("; ");
}

export function extractFacts(userText: string, _assistantText = ""): ExtractedFact[] {
  const user = userTextFromBlob(userText);
  if (!user || isGreeting(user)) return [];

  const facts: ExtractedFact[] = [];
  const name = extractName(user);
  if (name) facts.push({ memoryKey: "name", value: name });
  const pets = extractPets(user);
  if (pets) facts.push({ memoryKey: "pets", value: pets });
  const location = extractLocation(user);
  if (location) facts.push({ memoryKey: "location", value: location });
  const commitments = extractCommitments(user);
  if (commitments) facts.push({ memoryKey: "commitments", value: commitments });
  return facts;
}

export function extractNameFromBlob(blob: string) {
  return extractName(userTextFromBlob(blob));
}
