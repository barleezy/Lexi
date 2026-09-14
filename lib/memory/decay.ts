export type Band = "low" | "medium" | "high";

export function bandFromStart(startSalience: number): Band {
  if (startSalience <= 3) return "low";
  if (startSalience <= 6) return "medium";
  return "high";
}

export function rateForBand(band: Band): number {
  if (band === "low") return 0.08;
  if (band === "medium") return 0.02;
  return 0.005;
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
