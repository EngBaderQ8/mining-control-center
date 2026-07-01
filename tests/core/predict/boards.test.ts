import { describe, it, expect } from "vitest";
import { analyzeBoards } from "../../../src/core/predict/boards";
import type { DeviceSample, BoardSnap } from "../../../src/core/predict/analyze";

const T0 = 1_700_000_000_000;
const STEP_H = 2;

/** Build online samples at 2h spacing from per-sample board arrays. */
function mk(perSample: Array<BoardSnap[] | undefined>): DeviceSample[] {
  return perSample.map((boards, i) => ({
    t: T0 + i * STEP_H * 3_600_000,
    temp: 60,
    ths: 100,
    online: true,
    ...(boards ? { boards } : {}),
  }));
}

const b = (bn: number, chips: number, ghs: number, hwErr: number): BoardSnap => ({ b: bn, chips, ghs, hwErr });

describe("analyzeBoards", () => {
  it("returns [] for a steady, healthy fleet", () => {
    const steady = Array.from({ length: 8 }, (_, i) => [b(0, 76, 20000, 100 + i * 5), b(1, 76, 20000, 100 + i * 5)]);
    expect(analyzeBoards(mk(steady))).toEqual([]);
  });

  it("needs enough history — returns [] under 5 board samples", () => {
    const few = Array.from({ length: 4 }, () => [b(0, 76, 20000, 100)]);
    expect(analyzeBoards(mk(few))).toEqual([]);
  });

  it("ignores samples with no board data", () => {
    expect(analyzeBoards(mk([undefined, undefined, undefined, undefined, undefined, undefined]))).toEqual([]);
  });

  it("flags chips silently dropping on a board", () => {
    const specs = [76, 76, 76, 76, 60, 60, 60, 60].map((chips) => [b(0, chips, 20000, 100)]);
    const res = analyzeBoards(mk(specs));
    expect(res).toHaveLength(1);
    expect(res[0]!.board).toBe(0);
    expect(res[0]!.reasons.some((r) => r.code === "chipsLost")).toBe(true);
    const chip = res[0]!.reasons.find((r) => r.code === "chipsLost")!;
    expect(chip.values.from).toBe(76);
    expect(chip.values.to).toBe(60);
  });

  it("flags a declining board hashrate and forecasts an ETA", () => {
    const ghs = [20000, 20000, 20000, 20000, 18500, 17000, 15500, 15000];
    const res = analyzeBoards(mk(ghs.map((g) => [b(0, 76, g, 100)])));
    expect(res).toHaveLength(1);
    const decline = res[0]!.reasons.find((r) => r.code === "boardRateDecline");
    expect(decline).toBeTruthy();
    expect(res[0]!.etaDays).toBeGreaterThanOrEqual(1);
    expect(res[0]!.severity).toBe("warn"); // 15000 is above the 0.65×baseline "high" line
  });

  it("ignores raw HW-error counts entirely (steady chips+hashrate → healthy)", () => {
    // Even a fast-climbing HW-error counter is NOT a fault: healthy high-TH miners log
    // tens of thousands/day. Chips and hashrate are steady → no warning.
    const hw = [1000, 12000, 24000, 40000, 60000, 90000, 130000, 180000];
    const res = analyzeBoards(mk(hw.map((e) => [b(0, 76, 20000, e)])));
    expect(res).toEqual([]);
  });

  it("flags a board that dropped out and stays gone (high)", () => {
    const specs: BoardSnap[][] = [
      [b(0, 76, 20000, 100), b(1, 76, 20000, 100)],
      [b(0, 76, 20000, 100), b(1, 76, 20000, 100)],
      [b(0, 76, 20000, 100), b(1, 76, 20000, 100)],
      [b(0, 76, 20000, 100), b(1, 76, 20000, 100)],
      [b(0, 76, 20000, 100)],
      [b(0, 76, 20000, 100)],
      [b(0, 76, 20000, 100)],
      [b(0, 76, 20000, 100)],
    ];
    const res = analyzeBoards(mk(specs));
    const gone = res.find((p) => p.board === 1);
    expect(gone).toBeTruthy();
    expect(gone!.severity).toBe("high");
    expect(gone!.reasons[0]!.values.to).toBe(0);
  });
});
