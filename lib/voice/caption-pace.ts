/** Fallback speaking rate when audio duration is unknown. Midpoint of ~3–5 wps. */
export const CAPTION_WORDS_PER_SEC = 4;
const FALLBACK_MS = 1000 / CAPTION_WORDS_PER_SEC;
const MIN_STEP_MS = 80;
const MAX_STEP_MS = 800;

export function wordUnits(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

export function prefixWords(text: string, count: number): string {
  if (count <= 0) return "";
  return wordUnits(text).slice(0, count).join("");
}

/** Word start times in ms, if the realtime event includes them. */
export function readWordStartsMs(event: Record<string, unknown>): number[] | null {
  const nested =
    event.delta && typeof event.delta === "object" && !Array.isArray(event.delta)
      ? (event.delta as Record<string, unknown>)
      : null;
  const stamps =
    event.audio_timestamps && typeof event.audio_timestamps === "object"
      ? (event.audio_timestamps as Record<string, unknown>)
      : null;
  const raw = [event.words, event.word_timestamps, nested?.words, stamps?.words].find(Array.isArray);
  if (!raw?.length) return null;

  const starts: number[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const rec = item as Record<string, unknown>;
    if (typeof rec.start_ms === "number" && Number.isFinite(rec.start_ms)) {
      starts.push(rec.start_ms);
      continue;
    }
    if (typeof rec.startMs === "number" && Number.isFinite(rec.startMs)) {
      starts.push(rec.startMs);
      continue;
    }
    if (typeof rec.start === "number" && Number.isFinite(rec.start)) {
      starts.push(rec.start > 20 ? rec.start : rec.start * 1000);
      continue;
    }
    return null;
  }
  return starts;
}

export class CaptionPacer {
  private full = "";
  private shown = 0;
  private originMs = 0;
  private rateTimer: ReturnType<typeof setTimeout> | null = null;
  private stampTimers: ReturnType<typeof setTimeout>[] = [];
  private emit: (text: string) => void;
  private remainingAudioMs: () => number;

  constructor(emit: (text: string) => void, remainingAudioMs: () => number = () => 0) {
    this.emit = emit;
    this.remainingAudioMs = remainingAudioMs;
  }

  reset() {
    this.clearTimers();
    this.full = "";
    this.shown = 0;
    this.originMs = 0;
  }

  markSpeechStart() {
    if (!this.originMs) this.originMs = Date.now();
  }

  append(fullText: string, wordStartsMs?: number[] | null) {
    const prevUnits = wordUnits(this.full).length;
    this.full = fullText;
    const units = wordUnits(this.full);
    if (this.shown > 0) this.emit(prefixWords(this.full, this.shown));

    if (wordStartsMs && wordStartsMs.length) {
      this.markSpeechStart();
      const startIndex = prevUnits;
      for (let i = 0; i < wordStartsMs.length; i++) {
        const target = startIndex + i + 1;
        if (target <= this.shown) continue;
        const delay = Math.max(0, this.originMs + wordStartsMs[i] - Date.now());
        this.scheduleReveal(target, delay);
      }
      if (units.length > startIndex + wordStartsMs.length) {
        const last = wordStartsMs[wordStartsMs.length - 1] ?? 0;
        const delay = Math.max(0, this.originMs + last - Date.now());
        this.armRateAfter(delay);
      }
      return;
    }

    if (this.shown === 0 && units.length > 0) this.reveal(1);
    this.armRate();
  }

  replaceFull(text: string) {
    this.full = text;
    const total = wordUnits(text).length;
    if (this.shown > total) this.shown = total;
    if (this.shown > 0) this.emit(prefixWords(this.full, this.shown));
    this.armRate();
  }

  flush() {
    this.clearTimers();
    if (!this.full) return;
    this.shown = wordUnits(this.full).length;
    this.emit(this.full);
  }

  stop() {
    this.clearTimers();
  }

  private reveal(count: number) {
    const total = wordUnits(this.full).length;
    this.shown = Math.min(Math.max(count, this.shown), total);
    this.emit(prefixWords(this.full, this.shown));
  }

  private stepMs() {
    const remaining = wordUnits(this.full).length - this.shown;
    const audio = this.remainingAudioMs();
    if (remaining > 0 && audio > 0) {
      return Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, audio / remaining));
    }
    return FALLBACK_MS;
  }

  private armRate() {
    if (this.rateTimer || this.shown >= wordUnits(this.full).length) return;
    this.rateTimer = setTimeout(() => {
      this.rateTimer = null;
      this.reveal(this.shown + 1);
      this.armRate();
    }, this.stepMs());
  }

  private armRateAfter(delayMs: number) {
    const id = setTimeout(() => {
      this.stampTimers = this.stampTimers.filter((item) => item !== id);
      this.armRate();
    }, delayMs);
    this.stampTimers.push(id);
  }

  private scheduleReveal(count: number, delayMs: number) {
    const id = setTimeout(() => {
      this.stampTimers = this.stampTimers.filter((item) => item !== id);
      this.reveal(count);
    }, delayMs);
    this.stampTimers.push(id);
  }

  private clearTimers() {
    if (this.rateTimer) clearTimeout(this.rateTimer);
    this.rateTimer = null;
    for (const id of this.stampTimers) clearTimeout(id);
    this.stampTimers = [];
  }
}
