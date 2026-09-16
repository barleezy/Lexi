export type Band = "low" | "medium" | "high";

export function bandFromStart(startSalience: number): Band {
  if (startSalience <= 3) return "low";
  if (startSalience <= 6) return "medium";
  return "high";
}

export function rateForBand(band: Band): number {
  if (band === "low") return 0.04;
  if (band === "medium") return 0.01;
  return 0.0025;
}

export function daysElapsed(recall: Date, clock: Date): number {
  return (recall.getTime() - clock.getTime()) / 86_400_000;
}

/** new = old × (1 − rate)^days, then max(1, new). Clock is t0; old is start salience. */
export function decaySalience(old: number, rate: number, days: number): number {
  if (!Number.isFinite(old) || !Number.isFinite(rate) || !Number.isFinite(days)) {
    return 1;
  }
  if (days <= 0) return Math.max(1, old);
  return Math.max(1, old * (1 - rate) ** days);
}

export function clampAffect(value: number) {
  if (!Number.isFinite(value)) return 3;
  return Math.min(10, Math.max(1, Math.round(value)));
}

/** Same key again: raise affect, never replace with a lower score. Cap 10. */
export function bumpAffect(current: number, incoming: number) {
  const cur = clampAffect(current);
  const next = clampAffect(incoming);
  return clampAffect(Math.max(cur + 1, next));
}

/**
 * Deterministic 1–10 salience for a completed turn.
 * Bands match the decay law: low 1–3, medium 4–6, high 7–10.
 */
export function scoreSalience(user: string, assistant: string) {
  const u = user.trim();
  const a = assistant.trim();
  if (!u || !a) return 1;
  if (/^(hi|hey|hello|thanks|thank you|ok|okay|yeah|yep|yo|sup)[\s!.]*$/i.test(u) && a.length < 80) {
    return 2;
  }

  let score = 3;
  if (/\b(my name is|i am|i'm|call me|i live|i work)\b/i.test(u)) score += 2;
  if (/\b(i (like|love|hate|prefer|always|never|want|need)|don't want|do not want)\b/i.test(u)) {
    score += 2;
  }
  if (/\b(remember|don't forget|do not forget|keep in mind|my goal|my value)\b/i.test(u)) {
    score += 3;
  }
  if (/\b(love|hate|angry|furious|afraid|scared|grief|devastat|heartbreak|trauma|panic|thrilled)\b/i.test(`${u} ${a}`)) {
    score += 2;
  }
  if (u.length + a.length > 280) score += 1;
  return clampAffect(score);
}
