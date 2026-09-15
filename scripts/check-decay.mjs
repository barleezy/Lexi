import { bandFromStart, daysElapsed, decaySalience, rateForBand } from "../lib/memory/decay.ts";

const cases = [
  { start: 2, days: 10, expectBand: "low", expectRate: 0.08 },
  { start: 5, days: 10, expectBand: "medium", expectRate: 0.02 },
  { start: 8, days: 10, expectBand: "high", expectRate: 0.005 },
];

for (const item of cases) {
  const band = bandFromStart(item.start);
  const rate = rateForBand(band);
  const next = decaySalience(item.start, rate, item.days);
  const expected = Math.max(1, item.start * (1 - item.expectRate) ** item.days);
  if (band !== item.expectBand || rate !== item.expectRate || Math.abs(next - expected) > 1e-9) {
    throw new Error(`decay check failed for start=${item.start}`);
  }
  if (decaySalience(1.2, 0.08, 100) < 1) throw new Error("floor 1 failed");
}

if (decaySalience(10, 0, 365) !== 10) throw new Error("pinned rate 0 must stay 10");
if (decaySalience(10, 0, 0) !== 10) throw new Error("pinned rate 0 at day 0 must stay 10");

const t0 = new Date("2026-09-01T00:00:00Z");
const recall = new Date("2026-09-11T00:00:00Z");
if (Math.abs(daysElapsed(recall, t0) - 10) > 1e-9) throw new Error("daysElapsed failed");

console.log("decay math ok");
