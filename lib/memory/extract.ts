export const FACT_KEYS = [
  "name",
  "transexual",
  "pets",
  "location",
  "commitments",
  "birthday",
  "anniversary",
  "deadline",
  "date",
  "job",
  "age",
  "partner",
  "timezone",
  "food",
  "music",
  "sport",
  "hobby",
  "leisure",
  "vacation",
  "sexual_preference",
  "porn",
  "game",
  "movie",
  "tv",
  "book",
] as const;
export type FactKey = (typeof FACT_KEYS)[number];
export const FACT_KEY_LIST = FACT_KEYS.join(", ");

/** Stable self-identity. Always stored at affect 10; other keys use the scorer. */
export const IDENTITY_KEYS = ["name", "transexual"] as const satisfies readonly FactKey[];
export type IdentityKey = (typeof IDENTITY_KEYS)[number];

export function isIdentityKey(key: string): key is IdentityKey {
  return (IDENTITY_KEYS as readonly string[]).includes(key);
}

export function isFactKey(key: string): key is FactKey {
  return (FACT_KEYS as readonly string[]).includes(key);
}

export function parseFactKey(raw: unknown): FactKey | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return isFactKey(key) ? key : null;
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
  "asexual",
  "at",
  "back",
  "being",
  "bi",
  "bisexual",
  "busy",
  "calling",
  "coming",
  "currently",
  "demisexual",
  "done",
  "down",
  "early",
  "excited",
  "feeling",
  "fine",
  "from",
  "gay",
  "getting",
  "glad",
  "going",
  "good",
  "happy",
  "having",
  "here",
  "heterosexual",
  "home",
  "homosexual",
  "in",
  "into",
  "just",
  "late",
  "lesbian",
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
  "pansexual",
  "pretty",
  "queer",
  "quite",
  "ready",
  "really",
  "sad",
  "so",
  "sorry",
  "still",
  "straight",
  "sure",
  "taking",
  "the",
  "there",
  "thinking",
  "tired",
  "to",
  "too",
  "trans",
  "transexual",
  "transgender",
  "transsexual",
  "trying",
  "up",
  "very",
  "with",
  "working",
]);

const PLACE_STOP =
  /^(a|an|the|my|this|that|trouble|love|meeting|hurry|middle|bed|school|class|car|traffic|front|charge|debt|pain|shock|luck|denial|call|session|hospital|kitchen|bathroom|office|store|work|sleep|gym)\b/i;

const DEST_STOP =
  /^(a|an|the|my|this|that|store|bed|sleep|work|gym|meeting|school|class|home|there|here|town|city|bathroom|kitchen|office|hospital)\b/i;

const MONTHS =
  "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";

const SPORTS =
  "basketball|baseball|soccer|football|hockey|tennis|golf|rugby|volleyball|lacrosse|cricket|swimming|boxing|wrestling|skiing|snowboarding|skateboarding|cycling|pickleball|badminton|squash|softball|karate|judo|taekwondo|mma|climbing";

const INSTRUMENTS = "guitar|piano|drums|bass|violin|ukulele|flute|cello|saxophone|clarinet";

const ORIENTATION =
  "gay|lesbian|bisexual|bi|straight|heterosexual|homosexual|pansexual|asexual|queer|demisexual";

const SEXUAL_OBJECT =
  "men|women|guys|girls|both|bdsm|kink|kinky|doms?|sub(?:missive)?s?|switches?";

const HOBBY_SKIP = /^(eat|eats|eating|listen|listening|watch|watching|go|going|visit|visiting|play|playing|have|fuck|sex)\b/i;

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

function tidyPhrase(raw: string, min = 2, max = 60) {
  const trimmed = raw.trim().replace(/[.,!?;:]+$/g, "").replace(/\s+/g, " ");
  if (trimmed.length < min || trimmed.length > max) return null;
  return trimmed;
}

function looksLikeCalendarDate(value: string) {
  const t = value.trim();
  if (new RegExp(`\\b(?:${MONTHS})\\b`, "i").test(t)) return true;
  if (/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/.test(t)) return true;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(t)) return true;
  if (/\b\d{1,2}(?:st|nd|rd|th)\b/.test(t)) return true;
  return false;
}

function tidyCalendarDate(raw: string) {
  const value = tidyPhrase(raw, 3, 40);
  if (!value || !looksLikeCalendarDate(value)) return null;
  return titleCase(value);
}

function tidyDeadlineWhen(raw: string) {
  const value = tidyPhrase(raw, 3, 40);
  if (!value) return null;
  if (looksLikeCalendarDate(value)) return titleCase(value);
  if (
    /\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|this week|end of (?:the )?month|eod)\b/i.test(
      value,
    )
  ) {
    return value;
  }
  return null;
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

function tidyDestination(raw: string) {
  const place = tidyPlace(raw);
  if (!place || DEST_STOP.test(place)) return null;
  return place;
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

export function extractBirthday(text: string) {
  const t = text.trim();
  const mine = t.match(/\bmy birthday(?:'s| is)\s+([^.!?\n]{3,40})/i);
  if (mine) return tidyCalendarDate(mine[1]);
  const born = t.match(/\bi was born(?: on)?\s+([^.!?\n]{3,40})/i);
  if (born) return tidyCalendarDate(born[1]);
  const turn = t.match(/\bi turn\s+\d{1,3}\s+on\s+([^.!?\n]{3,40})/i);
  if (turn) return tidyCalendarDate(turn[1]);
  return null;
}

export function extractAnniversary(text: string) {
  const t = text.trim();
  const ours = t.match(/\b(?:my|our)(?: wedding)? anniversary(?:'s| is)\s+(?:on\s+)?([^.!?\n]{3,40})/i);
  if (ours) return tidyCalendarDate(ours[1]);
  const bare = t.match(/\banniversary is(?: on)?\s+([^.!?\n]{3,40})/i);
  if (bare) return tidyCalendarDate(bare[1]);
  return null;
}

export function extractDeadline(text: string) {
  const t = text.trim();
  const labeled = t.match(/\b(?:my|the) deadline is(?: on| by)?\s+([^.!?\n]{3,40})/i);
  if (labeled) return tidyDeadlineWhen(labeled[1]);
  const due = t.match(/\b(?:is )?due (?:on|by)\s+([^.!?\n]{3,40})/i);
  if (due) return tidyDeadlineWhen(due[1]);
  const have = t.match(/\bi have a deadline (?:on|of|for)\s+([^.!?\n]{3,40})/i);
  if (have) return tidyDeadlineWhen(have[1]);
  return null;
}

export function extractDate(text: string) {
  const t = text.trim();
  const remember = t.match(/\bremember (?:this|the) date:?\s+([^.!?\n]{3,40})/i);
  if (remember) return tidyCalendarDate(remember[1]) ?? tidyPhrase(remember[1], 3, 40);
  return null;
}

export function extractJob(text: string) {
  const t = text.trim();
  const as = t.match(/\bi work as\s+(?:an?\s+)?([^.!?\n]{2,40})/i);
  if (as) return tidyPhrase(as[1], 2, 40);
  const at = t.match(/\bi work (?:at|for)\s+([^.!?\n]{2,40})/i);
  if (at) return tidyPhrase(at[1], 2, 40);
  const job = t.match(/\bmy job is\s+(?:an?\s+)?([^.!?\n]{2,40})/i);
  if (job) return tidyPhrase(job[1], 2, 40);
  return null;
}

export function extractAge(text: string) {
  const match = text.trim().match(/\bi(?:'m| am)\s+(\d{2,3})(?:\s+years?\s+old)?\b/i);
  if (!match) return null;
  const age = Number(match[1]);
  if (age < 21 || age > 120) return null;
  return String(age);
}

export function extractPartner(text: string) {
  const t = text.trim();
  const labeled = t.match(
    /\bmy (?:wife|husband|girlfriend|boyfriend|partner|spouse|fianc[eé]e?)(?:'s name)? is\s+([A-Za-z][A-Za-z' -]{1,40})/i,
  );
  if (labeled) return takeName(labeled[1].replace(/[.,!?;:]+$/g, ""));
  const married = t.match(/\bi(?:'m| am) married to\s+([A-Za-z][A-Za-z' -]{1,40})/i);
  if (married) return takeName(married[1].replace(/[.,!?;:]+$/g, ""));
  return null;
}

export function extractTimezone(text: string) {
  const t = text.trim();
  const mine = t.match(/\bmy timezone is\s+([A-Za-z_+\-/\s]{2,40})/i);
  if (mine) return tidyPhrase(mine[1], 2, 40);
  const onTime = t.match(/\bi(?:'m| am) on\s+([A-Za-z][A-Za-z\s]{1,30}?)\s+time\b/i);
  if (onTime) return tidyPhrase(`${onTime[1]} time`, 4, 40);
  const use = t.match(/\bi use\s+([A-Za-z_+\-/]{3,40})\s+timezone\b/i);
  if (use) return tidyPhrase(use[1], 3, 40);
  return null;
}

export function extractFood(text: string) {
  const t = text.trim();
  const fav = t.match(/\bmy favorite (?:food|meal|dish|cuisine|drink) is\s+([^.!?\n]{2,40})/i);
  if (fav) return tidyPhrase(fav[1], 2, 40);
  const eat = t.match(/\bi (?:like to eat|love eating)\s+([^.!?\n]{2,40})/i);
  if (eat) return tidyPhrase(eat[1], 2, 40);
  return null;
}

export function extractMusic(text: string) {
  const t = text.trim();
  const fav = t.match(/\bmy favorite (?:music|song|band|artist|genre|album) is\s+([^.!?\n]{2,40})/i);
  if (fav) return tidyPhrase(fav[1], 2, 40);
  const listen = t.match(/\bi listen to\s+([^.!?\n]{2,40})/i);
  if (listen) return tidyPhrase(listen[1], 2, 40);
  const likeListening = t.match(/\bi like(?: to listen| listening) to\s+([^.!?\n]{2,40})/i);
  if (likeListening) return tidyPhrase(likeListening[1], 2, 40);
  const likeMusic = t.match(/\bi like\s+([^.!?\n]{2,40}?)\s+music\b/i);
  if (likeMusic) return tidyPhrase(likeMusic[1], 2, 40);
  const likeAct = t.match(/\bi like (?:the )?(?:band|artist)\s+([^.!?\n]{2,40})/i);
  if (likeAct) return tidyPhrase(likeAct[1], 2, 40);
  return null;
}

export function extractSport(text: string) {
  const t = text.trim();
  const fav = t.match(/\bmy favorite sports?\s+is\s+([^.!?\n]{2,40})/i);
  if (fav) return tidyPhrase(fav[1], 2, 40);
  const play = t.match(new RegExp(`\\bi (?:play|like playing)\\s+(?:the\\s+)?(${SPORTS})\\b`, "i"));
  if (play) return play[1].toLowerCase();
  const like = t.match(new RegExp(`\\bi like\\s+(${SPORTS})\\b`, "i"));
  if (like) return like[1].toLowerCase();
  return null;
}

export function extractHobby(text: string) {
  const t = text.trim();
  const labeled = t.match(/\bmy hobb(?:y is|ies are)\s+([^.!?\n]{3,60})/i);
  if (labeled) return tidyPhrase(labeled[1], 3, 60);
  const instrument = t.match(new RegExp(`\\bi play (?:the\\s+)?(${INSTRUMENTS})\\b`, "i"));
  if (instrument) return `play ${instrument[1].toLowerCase()}`;
  const likeTo = t.match(/\bi like to\s+([^.!?\n]{3,60})/i);
  if (likeTo && !HOBBY_SKIP.test(likeTo[1].trim())) return tidyPhrase(likeTo[1], 3, 60);
  return null;
}

export function extractLeisure(text: string) {
  const t = text.trim();
  const free = t.match(/\bin my (?:free|spare) time i\s+([^.!?\n]{3,60})/i);
  if (free) return tidyPhrase(free[1], 3, 60);
  const relax = t.match(/\bi relax (?:by|with)\s+([^.!?\n]{3,60})/i);
  if (relax) return tidyPhrase(relax[1], 3, 60);
  const fun = t.match(/\bfor fun i\s+([^.!?\n]{3,60})/i);
  if (fun) return tidyPhrase(fun[1], 3, 60);
  const labeled = t.match(/\bmy leisure (?:activity|activities) (?:is|are)\s+([^.!?\n]{3,60})/i);
  if (labeled) return tidyPhrase(labeled[1], 3, 60);
  return null;
}

export function extractVacation(text: string) {
  const t = text.trim();
  const fav = t.match(/\bmy favorite vacation(?:\s+(?:spot|destination|place))?\s+is\s+([^.!?\n]{2,40})/i);
  if (fav) return tidyDestination(fav[1]) ?? tidyPhrase(fav[1], 2, 40);
  const dest = t.match(/\b(?:my )?favorite (?:vacation )?(?:destination|getaway) is\s+([^.!?\n]{2,40})/i);
  if (dest) return tidyDestination(dest[1]) ?? tidyPhrase(dest[1], 2, 40);
  const vacay = t.match(/\bi want to vacation (?:in|at)\s+([^.!?\n]{2,40})/i);
  if (vacay) return tidyDestination(vacay[1]);
  const visit = t.match(/\bi(?:'d| would) love to visit\s+([^.!?\n]{2,40})/i);
  if (visit) return tidyDestination(visit[1]);
  const go = t.match(/\bi want to go to\s+([^.!?\n]{2,40})/i);
  if (go) return tidyDestination(go[1]);
  return null;
}

function mentionsUnder21(text: string) {
  if (/\b(?:under\s+21|minors?|children\b|child\b|kids?\b|teen(?:ager)?s?)\b/i.test(text)) return true;
  if (/\b(?:i(?:'m| am)|they(?:'re| are)|she(?:'s| is)|he(?:'s| is)|who is)\s+(?:1[0-9]|20)\b/i.test(text)) return true;
  return /\b(?:1[0-9]|20)\s+years?\s+old\b/i.test(text);
}

export function extractTransexual(text: string) {
  const t = text.trim();
  if (mentionsUnder21(t)) return null;
  const role = t.match(
    /\bi(?:'m| am)\s+(?:a |an )?(trans(?:gender|sexual|exual)?)\s+(woman|man|female|male)\b/i,
  );
  if (role) {
    const stem = /^(transexual|transsexual)$/i.test(role[1]) ? "transexual" : "trans";
    return `${stem} ${role[2].toLowerCase()}`;
  }
  const ident = t.match(/\bi(?:'m| am)\s+(trans(?:gender|sexual|exual)?)\b/i);
  if (!ident) return null;
  return /^(transexual|transsexual)$/i.test(ident[1]) ? "transexual" : "trans";
}

export function extractPorn(text: string) {
  const t = text.trim();
  if (mentionsUnder21(t)) return null;
  const fav = t.match(/\bmy favorite porn(?:\s+(?:genre|video|videos|to watch))?\s+is\s+([^.!?\n]{2,40})/i);
  if (fav) return tidyPhrase(fav[1], 2, 40);
  const watchGenre = t.match(/\bi watch\s+([^.!?\n]{2,40}?)\s+porn\b/i);
  if (watchGenre) return tidyPhrase(watchGenre[1], 2, 40);
  if (/\bi watch (?:porn|xxx|adult videos?)\b/i.test(t)) return "porn";
  const intoGenre = t.match(/\bi(?:'m| am) into\s+([^.!?\n]{2,40}?)\s+porn\b/i);
  if (intoGenre) return tidyPhrase(intoGenre[1], 2, 40);
  if (/\bi(?:'m| am) into (?:porn|xxx|adult videos?)\b/i.test(t)) return "porn";
  const like = t.match(/\bi like (?:watching )?(?:([^.!?\n]{2,40}?)\s+)?(?:porn|xxx|adult videos?)\b/i);
  if (like) return tidyPhrase(like[1] || "porn", 2, 40);
  return null;
}

export function extractSexualPreference(text: string) {
  const t = text.trim();
  if (mentionsUnder21(t)) return null;
  const labeled = t.match(/\bmy sexual (?:preference|orientation) is\s+([^.!?\n]{2,40})/i);
  if (labeled) return tidyPhrase(labeled[1], 2, 40);
  const ident = t.match(new RegExp(`\\bi(?:'m| am)\\s+(${ORIENTATION})\\b`, "i"));
  if (ident) return ident[1].toLowerCase();
  const into = t.match(new RegExp(`\\bi(?:'m| am) into\\s+((?:${SEXUAL_OBJECT})\\b[^.!?\n]{0,30})`, "i"));
  if (into) return tidyPhrase(into[1], 2, 40);
  const preferSex = t.match(/\bi prefer\s+([^.!?\n]{2,40}?)\s+(?:sexually|in bed|in the bedroom)\b/i);
  if (preferSex) return tidyPhrase(preferSex[1], 2, 40);
  const preferPeople = t.match(/\bi prefer\s+(men|women|guys|girls|both)\b/i);
  if (preferPeople) return preferPeople[1].toLowerCase();
  return null;
}

export function extractGame(text: string) {
  const t = text.trim();
  const fav = t.match(/\bmy favorite (?:video\s*)?games?\s+is\s+([^.!?\n]{2,50})/i);
  if (fav) return tidyPhrase(fav[1], 2, 50);
  const playGame = t.match(/\bi play (?:the )?(?:video )?game\s+([^.!?\n]{2,50})/i);
  if (playGame) return tidyPhrase(playGame[1], 2, 50);
  const onPlatform = t.match(
    /\bi play\s+([^.!?\n]{2,50}?)\s+on\s+(?:pc|steam|switch|nintendo|playstation|ps5|ps4|xbox|game pass)\b/i,
  );
  if (onPlatform && !new RegExp(`^(?:the\\s+)?(?:${SPORTS})$`, "i").test(onPlatform[1].trim())) {
    return tidyPhrase(onPlatform[1], 2, 50);
  }
  const likePlaying = t.match(/\bi like playing\s+([^.!?\n]{2,50})/i);
  if (likePlaying) {
    const value = tidyPhrase(likePlaying[1], 2, 50);
    if (!value || new RegExp(`^(?:${SPORTS})$`, "i").test(value)) return null;
    return value;
  }
  return null;
}

export function extractMovie(text: string) {
  const t = text.trim();
  const fav = t.match(/\bmy favorite (?:movie|film) is\s+([^.!?\n]{2,60})/i);
  if (fav) return tidyPhrase(fav[1], 2, 60);
  const like = t.match(/\bi (?:love|like) the (?:movie|film)\s+([^.!?\n]{2,60})/i);
  if (like) return tidyPhrase(like[1], 2, 60);
  return null;
}

export function extractTv(text: string) {
  const t = text.trim();
  const fav = t.match(/\bmy favorite (?:tv )?(?:show|series) is\s+([^.!?\n]{2,60})/i);
  if (fav) return tidyPhrase(fav[1], 2, 60);
  const watch = t.match(/\bi watch\s+([^.!?\n]{2,50}?)\s+on\s+(?:netflix|hulu|hbo|max|disney|peacock|prime)\b/i);
  if (watch) return tidyPhrase(watch[1], 2, 50);
  return null;
}

export function extractBook(text: string) {
  const t = text.trim();
  const fav = t.match(/\bmy favorite (?:book|novel) is\s+([^.!?\n]{2,60})/i);
  if (fav) return tidyPhrase(fav[1], 2, 60);
  const love = t.match(/\bi (?:love|like) the book\s+([^.!?\n]{2,60})/i);
  if (love) return tidyPhrase(love[1], 2, 60);
  const reading = t.match(/\bi(?:'m| am) reading\s+([^.!?\n]{2,60})/i);
  if (!reading) return null;
  const value = tidyPhrase(reading[1], 2, 60);
  if (!value || /^(a lot|this|that|it|again|now|today|more)$/i.test(value)) return null;
  return value;
}

function pushFact(facts: ExtractedFact[], memoryKey: FactKey, value: string | null) {
  if (value) facts.push({ memoryKey, value });
}

export function extractFacts(userText: string, _assistantText = ""): ExtractedFact[] {
  const user = userTextFromBlob(userText);
  if (!user || isGreeting(user)) return [];

  const facts: ExtractedFact[] = [];
  pushFact(facts, "name", extractName(user));
  pushFact(facts, "transexual", extractTransexual(user));
  pushFact(facts, "pets", extractPets(user));
  pushFact(facts, "location", extractLocation(user));
  pushFact(facts, "commitments", extractCommitments(user));
  pushFact(facts, "birthday", extractBirthday(user));
  pushFact(facts, "anniversary", extractAnniversary(user));
  pushFact(facts, "deadline", extractDeadline(user));
  pushFact(facts, "date", extractDate(user));
  pushFact(facts, "job", extractJob(user));
  pushFact(facts, "age", extractAge(user));
  pushFact(facts, "partner", extractPartner(user));
  pushFact(facts, "timezone", extractTimezone(user));
  pushFact(facts, "food", extractFood(user));
  pushFact(facts, "music", extractMusic(user));
  pushFact(facts, "sport", extractSport(user));
  pushFact(facts, "hobby", extractHobby(user));
  pushFact(facts, "leisure", extractLeisure(user));
  pushFact(facts, "vacation", extractVacation(user));
  pushFact(facts, "sexual_preference", extractSexualPreference(user));
  pushFact(facts, "porn", extractPorn(user));
  pushFact(facts, "game", extractGame(user));
  pushFact(facts, "movie", extractMovie(user));
  pushFact(facts, "tv", extractTv(user));
  pushFact(facts, "book", extractBook(user));
  return facts;
}

export function extractNameFromBlob(blob: string) {
  return extractName(userTextFromBlob(blob));
}
