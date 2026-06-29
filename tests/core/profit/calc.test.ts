import { describe, it, expect } from "vitest";
import { btcPerDay, computeProfit, powerKwFromHashrate } from "../../../src/core/profit/calc";

const NET = { priceUsd: 60000, difficulty: 8e13, blockRewardBtc: 3.125 };

describe("profit calc", () => {
  it("computes BTC/day from the standard formula", () => {
    // 100 TH/s on the given difficulty — value verified against the formula.
    const v = btcPerDay(100, NET);
    const expected = (100 * 1e12 * 86400 * 3.125) / (8e13 * 2 ** 32);
    expect(v).toBeCloseTo(expected, 12);
    expect(v).toBeGreaterThan(0);
  });

  it("returns 0 BTC for zero/invalid inputs", () => {
    expect(btcPerDay(0, NET)).toBe(0);
    expect(btcPerDay(100, { ...NET, difficulty: 0 })).toBe(0);
  });

  it("revenue minus electricity gives net profit; converts to local currency", () => {
    const r = computeProfit(NET, {
      hashrateTHs: 17000,
      powerKw: 306, // ~57 × 5.3 kW
      electricityPerKwh: 0.05 * 3.75, // 0.05 USD/kWh in SAR
      usdRate: 3.75, // SAR per USD
    });
    expect(r.revenuePerDay).toBeGreaterThan(0);
    expect(r.costPerDay).toBeCloseTo(306 * 24 * 0.05 * 3.75, 6);
    expect(r.profitPerDay).toBeCloseTo(r.revenuePerDay - r.costPerDay, 6);
    expect(r.revenuePerMonth).toBeCloseTo(r.revenuePerDay * 30, 6);
    // revenue scales with the currency rate
    const usd = computeProfit(NET, { hashrateTHs: 17000, powerKw: 306, electricityPerKwh: 0.05, usdRate: 1 });
    expect(r.revenuePerDay).toBeCloseTo(usd.revenuePerDay * 3.75, 4);
  });

  it("margin is profit/revenue as a percentage", () => {
    const r = computeProfit(NET, { hashrateTHs: 1000, powerKw: 1, electricityPerKwh: 0, usdRate: 1 });
    expect(r.marginPct).toBeCloseTo(100, 3); // no electricity cost => 100% margin
  });

  it("estimates power from hashrate × efficiency", () => {
    expect(powerKwFromHashrate(1000, 18.5)).toBeCloseTo(18.5, 6); // 18.5 J/TH × 1000 TH/s = 18.5 kW
    expect(powerKwFromHashrate(17000)).toBeCloseTo((17000 * 18.5) / 1000, 6);
  });
});
