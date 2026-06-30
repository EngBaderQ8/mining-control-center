import { describe, it, expect } from "vitest";
import { parseDeviceHealth } from "../../../src/core/diagnose/parse";

// A realistic S19 stats reply: board 3 is dead, fan3 stopped.
const STATS =
  '{"STATS":[{"GHS 5s":"200350","fan_num":4,"fan1":4200,"fan2":4080,"fan3":0,"fan4":4110,' +
  '"temp1":61,"temp2":66,"temp3":59,"temp2_1":75,"temp2_2":78,"temp2_3":0,"chain_num":3,' +
  '"chain_acn1":76,"chain_acn2":76,"chain_acn3":0,' +
  '"chain_rate1":"100200.5","chain_rate2":"100150.2","chain_rate3":"0.00",' +
  '"chain_hw1":12,"chain_hw2":8,"chain_hw3":0}]}';

describe("parseDeviceHealth", () => {
  it("parses the per-board data", () => {
    const h = parseDeviceHealth(STATS);
    expect(h.boards).toHaveLength(3);
    expect(h.boards[0]).toMatchObject({ board: 1, chips: 76, hwErrors: 12 });
    expect(h.boards[0]!.rateGhs).toBeCloseTo(100200.5, 0);
    expect(h.fans).toEqual([4200, 4080, 0, 4110]);
  });

  it("detects a dead board", () => {
    const h = parseDeviceHealth(STATS);
    expect(h.issues.some((i) => i.code === "boardDown" && i.values.board === 3)).toBe(true);
  });

  it("detects a stopped fan", () => {
    const h = parseDeviceHealth(STATS);
    expect(h.issues.some((i) => i.code === "fanDead" && i.values.fan === 3)).toBe(true);
  });

  it("detects missing chips on a working board", () => {
    const s = STATS.replace('"chain_acn2":76', '"chain_acn2":60').replace('"chain_rate2":"100150.2"', '"chain_rate2":"80000"');
    const h = parseDeviceHealth(s);
    expect(h.issues.some((i) => i.code === "chipsMissing" && i.values.board === 2)).toBe(true);
  });

  it("reports no issues for a fully healthy device", () => {
    const ok =
      '{"chain_acn1":76,"chain_acn2":76,"chain_acn3":76,' +
      '"chain_rate1":"100000","chain_rate2":"100000","chain_rate3":"100000",' +
      '"chain_hw1":2,"chain_hw2":1,"chain_hw3":3,"fan1":4000,"fan2":4000,"temp1":65,"temp2":66}';
    const h = parseDeviceHealth(ok);
    expect(h.issues).toHaveLength(0);
  });
});
