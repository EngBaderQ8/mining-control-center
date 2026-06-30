import { describe, it, expect } from "vitest";
import { parseDeviceHealth, parseWhatsminerHealth } from "../../../src/core/diagnose/parse";

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

  it("returns nothing for a Whatsminer edevs reply (different schema) — the gap we fixed", () => {
    // A Whatsminer DEVS array has NONE of cgminer's chain_*/fan*/temp* keys.
    const wm =
      '{"STATUS":[{"STATUS":"S"}],"DEVS":[{"ASC":0,"MHS av":21000000,"Temperature":72,"Effective Chips":215}]}';
    expect(parseDeviceHealth(wm).boards).toHaveLength(0); // cgminer parser is blind to it
  });
});

// Whatsminer edevs: per-board DEVS array (MHS av in MH/s, Chip Temp Max, Effective
// Chips) + fans in summary. Board 2 has chips but ~0 hashrate (a real failure).
const WM_EDEVS =
  '{"STATUS":[{"STATUS":"S"}],"DEVS":[' +
  '{"ASC":0,"Slot":0,"Status":"Alive","Temperature":72,"Chip Temp Max":88,"MHS av":21000000,"Effective Chips":215,"Hardware Errors":1200},' +
  '{"ASC":1,"Slot":1,"Status":"Alive","Temperature":70,"Chip Temp Max":86,"MHS av":20500000,"Effective Chips":215},' +
  '{"ASC":2,"Slot":2,"Status":"Alive","Temperature":71,"Chip Temp Max":80,"MHS av":0,"Effective Chips":215}]}';
const WM_SUMMARY = '{"SUMMARY":[{"Fan Speed In":4800,"Fan Speed Out":4750,"Env Temp":34}]}';

describe("parseWhatsminerHealth", () => {
  it("parses Whatsminer per-board hashrate (MHS→GHS), chips, temps and fans", () => {
    const h = parseWhatsminerHealth(WM_EDEVS, WM_SUMMARY);
    expect(h.boards).toHaveLength(3);
    expect(h.boards[0]!.chips).toBe(215);
    expect(h.boards[0]!.rateGhs).toBe(21000); // 21,000,000 MH/s ÷ 1000
    expect(h.hasFans).toBe(true);
    expect(h.fans).toEqual([4800, 4750]);
    expect(h.temps).toContain(88);
  });

  it("flags a Whatsminer board that has chips but isn't hashing", () => {
    const h = parseWhatsminerHealth(WM_EDEVS, WM_SUMMARY);
    expect(h.issues.some((i) => i.code === "boardDown" && i.values.board === 2)).toBe(true);
  });

  it("flags a stopped Whatsminer fan", () => {
    const h = parseWhatsminerHealth(WM_EDEVS, '{"SUMMARY":[{"Fan Speed In":4800,"Fan Speed Out":0}]}');
    expect(h.issues.some((i) => i.code === "fanDead")).toBe(true);
  });

  it("still shows a board from hashrate alone when the chip-count field is unknown (graceful degrade)", () => {
    const odd = '{"DEVS":[{"ASC":0,"MHS av":18000000,"Chip Temp Max":75}]}'; // no chip-count key
    const h = parseWhatsminerHealth(odd, "");
    expect(h.boards).toHaveLength(1);
    expect(h.boards[0]!.rateGhs).toBe(18000);
    expect(h.boards[0]!.chips).toBe(0);
  });

  it("returns empty (no crash) on garbage/empty input", () => {
    expect(parseWhatsminerHealth("", "").boards).toHaveLength(0);
    expect(parseWhatsminerHealth("not json", "{}").boards).toHaveLength(0);
  });
});
