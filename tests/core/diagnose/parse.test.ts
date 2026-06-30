import { describe, it, expect } from "vitest";
import { parseDeviceHealth } from "../../../src/core/diagnose/parse";

// Healthy 3-board hydro miner: 3 populated boards, a 4th empty slot (0/0), all
// fans 0 (water-cooled), high CUMULATIVE hw counts (normal). Must show NO faults.
const HEALTHY_HYDRO =
  '{"STATS":[{"GHS 5s":"300000","fan1":0,"fan2":0,"fan3":0,"fan4":0,' +
  '"temp1":61,"temp2":66,"temp3":59,"chain_num":4,' +
  '"chain_acn1":180,"chain_acn2":180,"chain_acn3":180,"chain_acn4":0,' +
  '"chain_rate1":"99900","chain_rate2":"99700","chain_rate3":"101400","chain_rate4":"0",' +
  '"chain_hw1":1210,"chain_hw2":910,"chain_hw3":1746,"chain_hw4":0}]}';

describe("parseDeviceHealth", () => {
  it("treats empty 0/0 slots as absent (not failed) and reports a healthy hydro device clean", () => {
    const h = parseDeviceHealth(HEALTHY_HYDRO);
    expect(h.boards).toHaveLength(3); // the empty 4th slot is dropped
    expect(h.hasFans).toBe(false); // all fans 0 ⇒ water-cooled
    expect(h.issues).toHaveLength(0); // no false alarms: cumulative hw counts ignored, no phantom board
  });

  it("does NOT flag high cumulative HW-error counts as a fault", () => {
    const h = parseDeviceHealth(HEALTHY_HYDRO);
    expect(h.issues.some((i) => i.code === ("highHwErrors" as never))).toBe(false);
    expect(h.boards[0]!.hwErrors).toBe(1210); // still surfaced for info
  });

  it("flags a real board failure: chips present but no hashrate", () => {
    const s = HEALTHY_HYDRO.replace('"chain_rate3":"101400"', '"chain_rate3":"0"');
    const h = parseDeviceHealth(s);
    expect(h.issues.some((i) => i.code === "boardDown" && i.values.board === 3)).toBe(true);
  });

  it("flags a stopped fan only on an air-cooled device that has fans", () => {
    const air =
      '{"fan1":4200,"fan2":4080,"fan3":0,"fan4":4110,' +
      '"chain_acn1":76,"chain_acn2":76,"chain_acn3":76,' +
      '"chain_rate1":"100000","chain_rate2":"100000","chain_rate3":"100000"}';
    const h = parseDeviceHealth(air);
    expect(h.hasFans).toBe(true);
    expect(h.issues.some((i) => i.code === "fanDead" && i.values.fan === 3)).toBe(true);
  });

  it("detects missing chips on a working board", () => {
    const s =
      '{"fan1":4000,"chain_acn1":76,"chain_acn2":60,"chain_acn3":76,' +
      '"chain_rate1":"100000","chain_rate2":"80000","chain_rate3":"100000"}';
    const h = parseDeviceHealth(s);
    expect(h.issues.some((i) => i.code === "chipsMissing" && i.values.board === 2)).toBe(true);
  });
});
