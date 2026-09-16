export const DEFAULT_TIME_ZONE = "America/New_York";
export const CLOCK_REFRESH_MS = 45_000;

const ZONE_ALIASES: Record<string, string> = {
  eastern: "America/New_York",
  "eastern time": "America/New_York",
  et: "America/New_York",
  est: "America/New_York",
  edt: "America/New_York",
  "us eastern": "America/New_York",
  central: "America/Chicago",
  "central time": "America/Chicago",
  ct: "America/Chicago",
  cst: "America/Chicago",
  cdt: "America/Chicago",
  mountain: "America/Denver",
  "mountain time": "America/Denver",
  mt: "America/Denver",
  mst: "America/Denver",
  mdt: "America/Denver",
  pacific: "America/Los_Angeles",
  "pacific time": "America/Los_Angeles",
  pt: "America/Los_Angeles",
  pst: "America/Los_Angeles",
  pdt: "America/Los_Angeles",
};

export function isValidTimeZone(zone: string) {
  if (!zone.trim()) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: zone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function detectClientTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    return isValidTimeZone(zone) ? zone : "";
  } catch {
    return "";
  }
}

export function normalizeTimeZone(raw: string) {
  const trimmed = raw.trim().replace(/[.,;]+$/g, "");
  if (!trimmed) return "";
  if (isValidTimeZone(trimmed)) return trimmed;
  const alias = ZONE_ALIASES[trimmed.toLowerCase()];
  return alias && isValidTimeZone(alias) ? alias : "";
}

export function parseTimezoneFact(memoryInstructions: string) {
  const match =
    memoryInstructions.match(/^timezone:\s+(.+?)\s+\(affect/im) ??
    memoryInstructions.match(/^timezone:\s+([^\n]+)/im);
  return match ? normalizeTimeZone(match[1]) : "";
}

export function resolveVoiceTimeZone(memoryInstructions = "", clientTimeZone = "") {
  return (
    parseTimezoneFact(memoryInstructions) ||
    normalizeTimeZone(clientTimeZone) ||
    DEFAULT_TIME_ZONE
  );
}

export function formatCurrentTimeLine(timeZone: string, at = new Date()) {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: zone }).format(at);
  const date = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: zone,
  }).format(at);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: zone,
  }).format(at);
  const tzName =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? zone;
  return `CURRENT TIME: Now is ${weekday}, ${date}, ${time} ${tzName} (${zone}). Use this for now, later, tonight, weekdays, and relative times. Do not invent a different date or hour.`;
}
