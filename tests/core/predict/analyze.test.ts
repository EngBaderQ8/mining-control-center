import { describe, it, expect } from "vitest";
import { analyzeTrend, tempSlopePerHour, type DeviceSample } from "../../../src/core/predict/analyze";

const minute = 60_000;
const sample = (i: number, temp: number, ths: number, online = true): DeviceSample => ({
  t: i * minute,
  temp,
  ths,
  online,
});

describe("predict.analyzeTrend", () => {
  it("returns null for a healthy, stable device", () => {
    const s = Array.from({ length: 10 }, (_, i) => sample(i, 65, 300));
    expect(analyzeTrend(s, { overheatC: 90 })).toBeNull();
  });

  it("needs at least 5 samples", () => {
    expect(analyzeTrend([sample(0, 88, 300)], { overheatC: 90 })).toBeNull();
  });

  it("flags a rising temperature heading toward the limit", () => {
    // climbs from 78 to ~88 over 9 minutes, overheat 90
    const s = Array.from({ length: 10 }, (_, i) => sample(i, 78 + i * 1.2, 300));
    const p = analyzeTrend(s, { overheatC: 90 });
    expect(p).not.toBeNull();
    expect(p!.reasons.some((r) => r.code === "tempRising")).toBe(true);
    expect(p!.severity).toBe("high"); // latest ~88.8 >= 90-5
  });

  it("flags a gradual hashrate decline vs the device's baseline", () => {
    const s = [
      ...Array.from({ length: 5 }, (_, i) => sample(i, 65, 300)),
      ...Array.from({ length: 5 }, (_, i) => sample(5 + i, 65, 180)),
    ];
    const p = analyzeTrend(s, { overheatC: 90 });
    expect(p).not.toBeNull();
    expect(p!.reasons.some((r) => r.code === "hashDrop")).toBe(true);
  });

  it("flags repeated disconnects (flapping)", () => {
    const s = [
      sample(0, 65, 300, true),
      sample(1, 0, 0, false),
      sample(2, 65, 300, true),
      sample(3, 0, 0, false),
      sample(4, 65, 300, true),
      sample(5, 0, 0, false),
      sample(6, 65, 300, true),
    ];
    const p = analyzeTrend(s, { overheatC: 90 });
    expect(p).not.toBeNull();
    expect(p!.reasons.some((r) => r.code === "flapping")).toBe(true);
  });

  it("computes a positive temp slope per hour", () => {
    const s = Array.from({ length: 7 }, (_, i) => sample(i * 10, 60 + i * 2, 300)); // +2°/10min
    expect(tempSlopePerHour(s)).toBeCloseTo(12, 0); // ~12°/hour
  });
});
