import { describe, it, expect } from "vitest";
import { normalizeStatus, extractStatusFromRaw } from "../../../src/core/cgminer/normalize";

const summary = { "GHS 5s": 95200, "GHS av": 94800, "Device Hardware%": 0.21, "Elapsed": 7200 };
const stats = { temp2_1: 64, temp2_2: 81, temp2_3: 70, fan1: 4200, fan2: 0 };
const pools = { URL: "stratum+tcp://pool:3333", "User": "acct.rig02", "Stratum Active": true };

describe("Whatsminer (MicroBT) summary", () => {
  // Real-device shape: MHS only (no GHS, no MHS 5s), data nested in Msg,
  // Temperature + Fan Speed In/Out, stats command unsupported (error).
  const wmSummary =
    '{"STATUS":"S","Code":131,"Msg":{"Elapsed":11367,"MHS av":122942400,"MHS 1m":123107336,' +
    '"MHS 15m":122913336,"HS RT":123107336,"Temperature":80.00,"Env Temp":32.00,' +
    '"Chip Temp Max":101.25,"Fan Speed In":4530,"Fan Speed Out":4540}}';
  const wmStatsErr = '{"STATUS":"E","Code":14,"Msg":"invalid cmd"}';

  it("reads hashrate from MHS (no GHS/5s) → online, correct TH/s", () => {
    const s = extractStatusFromRaw("wm", wmSummary, wmStatsErr, "{}", Date.now());
    expect(s.state).toBe("online");
    expect(s.hashrateTHs).toBeCloseTo(123.1, 0); // HS RT / MHS 1m ÷ 1e6
    expect(s.avgHashrateTHs).toBeCloseTo(122.9, 0); // MHS av ÷ 1e6
  });

  it("reads Temperature + Fan Speed from the summary (not from the bad stats)", () => {
    const s = extractStatusFromRaw("wm", wmSummary, wmStatsErr, "{}", Date.now());
    expect(s.maxTempC).toBe(80); // "Temperature" (board), not Chip Temp Max
    expect(s.fanRpm).toBeGreaterThan(4000); // "Fan Speed In"
  });

  it("prefers the per-board hashboard Temperature (from edevs, the WhatsMinerTool value) over chip temps", () => {
    // Whatsminer `edevs` carries per-board "Temperature" (~70-74, the value the
    // official tool shows); `summary` only has chip temps (~86-95). Must show the
    // board temp so healthy miners don't trip a false overheat warning.
    const sum = '{"Msg":{"MHS av":123000000,"Chip Temp Avg":86,"Chip Temp Max":95}}';
    const edevs = '{"DEVS":[{"Temperature":73.5,"Chip Temp Avg":86},{"Temperature":74.1,"Chip Temp Avg":88}]}';
    const s = extractStatusFromRaw("wm", sum, `${edevs} ${sum}`, "{}", Date.now());
    expect(s.state).toBe("online");
    expect(s.maxTempC).toBeCloseTo(74.1, 1); // board temp, NOT chip 86/95
  });

  it("uses Chip Temp Avg (not Max, not ambient Env Temp) when a Whatsminer has no board Temperature", () => {
    // Real device 192.168.0.47: no "Temperature" field at all — only Env Temp
    // (ambient) and Chip Temp Min/Max/Avg. Must read ~76 (avg), not 0, not 87
    // (max — would false-alarm in heat), not 34 (ambient).
    const noBoardTemp =
      '{"STATUS":"S","Code":131,"Msg":{"Elapsed":20096,"MHS av":123307112,"HS RT":123211912,' +
      '"Fan Speed In":5073,"Fan Speed Out":5337,"Env Temp":33.937,' +
      '"Chip Temp Min":67.92,"Chip Temp Max":87.359,"Chip Temp Avg":76.333}}';
    const s = extractStatusFromRaw("wm47", noBoardTemp, "", "{}", Date.now());
    expect(s.state).toBe("online");
    expect(s.maxTempC).toBeCloseTo(76.33, 1); // Chip Temp Avg
    expect(s.maxTempC).toBeLessThan(80); // not Chip Temp Max (87)
    expect(s.fanRpm).toBeGreaterThan(4000); // Fan Speed In
  });

  it("handles a Whatsminer that reports cgminer-style SUMMARY with MHS av already in TH/s", () => {
    // Real device 192.168.0.54: SUMMARY array, MHS av = 111.77 (the value IS the
    // TH/s, not MH/s) and NO current-metric key — must read ~111 TH, not ~0.
    const alt =
      '{"STATUS":[{"STATUS":"S","Msg":"Summary"}],"SUMMARY":[{"Elapsed":14759,"MHS av":111.77,"Accepted":711,"Rejected":1}],"id":1}';
    const s = extractStatusFromRaw("wm54", alt, "", "{}", Date.now());
    expect(s.state).toBe("online");
    expect(s.hashrateTHs).toBeCloseTo(111.77, 1);
    expect(s.avgHashrateTHs).toBeCloseTo(111.77, 1);
  });
});

describe("normalizeStatus", () => {
  it("converts GH/s to TH/s and picks hottest temp + active fan", () => {
    const s = normalizeStatus("dev1", { summary, stats, pools }, Date.now());
    expect(s.hashrateTHs).toBeCloseTo(95.2, 1);
    expect(s.avgHashrateTHs).toBeCloseTo(94.8, 1);
    expect(s.maxTempC).toBe(81);
    expect(s.fanRpm).toBe(4200);
    expect(s.worker).toBe("rig02");
    expect(s.pool).toBe("pool:3333");
    expect(s.hwErrorRate).toBeCloseTo(0.0021, 4);
    expect(s.uptimeSec).toBe(7200);
    expect(s.state).toBe("online");
  });
});

describe("extractStatusFromRaw (robust, regex-based)", () => {
  it("extracts hashrate/temp/worker even from spaced/malformed JSON", () => {
    // spaces after colons + trailing junk (no closing brace) like real bmminer.
    const sum = '{"SUMMARY": [{"GHS 5s": 300597.03, "GHS av": 302887.84, "Device Hardware%": 0.0021, "Elapsed": 246000,';
    const stat = '{"STATS": [{"temp2_1": 60, "temp2_2": 66, "temp2_3": 59, "fan1": 4200, "fan2": 0, "fan3": 3900}],';
    const pool = '{"POOLS": [{"URL": "stratum+tcp://btc.f2pool.com:1314", "User": "albader333.hydromega00"}]}';
    const s = extractStatusFromRaw("d1", sum, stat, pool, 1000);
    expect(s.state).toBe("online");
    expect(s.hashrateTHs).toBeCloseTo(300.6, 1);
    expect(s.maxTempC).toBe(66);
    expect(s.fanRpm).toBe(4200);
    expect(s.worker).toBe("hydromega00");
    expect(s.pool).toBe("btc.f2pool.com:1314");
    expect(s.uptimeSec).toBe(246000);
  });

  it("is offline when there's no hashrate in the response", () => {
    expect(extractStatusFromRaw("d", "", "", "", 1).state).toBe("offline");
  });

  it("handles a single combined summary+stats+pools blob", () => {
    const blob =
      '{"summary":[{"SUMMARY":[{"GHS 5s":300000,"GHS av":301000,"Elapsed":1000}]}],"stats":[{"STATS":[{"temp2_1":61,"temp2_2":68,"fan1":4100,"fan2":3900}]}],"pools":[{"POOLS":[{"URL":"stratum+tcp://p:3333","User":"acct.w9"}]}]}';
    const s = extractStatusFromRaw("d", blob, blob, blob, 1);
    expect(s.state).toBe("online");
    expect(s.hashrateTHs).toBeCloseTo(300, 0);
    expect(s.maxTempC).toBe(68);
    expect(s.fanRpm).toBe(4100);
    expect(s.worker).toBe("w9");
  });

  it("supports MHS and THS hashrate units", () => {
    const mhs = extractStatusFromRaw("d", '{"SUMMARY":[{"MHS 5s":300000000}]}', "", "", 1);
    expect(mhs.hashrateTHs).toBeCloseTo(300, 0);
    const ths = extractStatusFromRaw("d", '{"SUMMARY":[{"THS 5s":110.5}]}', "", "", 1);
    expect(ths.hashrateTHs).toBeCloseTo(110.5, 1);
  });

  it("supports modded-firmware rate_ keys and fan_num naming", () => {
    const s = extractStatusFromRaw(
      "d",
      '{"rate_5s": 95000, "rate_avg": 94000}',
      '{"temp_chip2_1": 70, "fan_1": 3800}',
      '{"URL":"x://p:1","User":"a.b"}',
      1,
    );
    expect(s.hashrateTHs).toBeCloseTo(95, 0);
    expect(s.maxTempC).toBe(70);
    expect(s.fanRpm).toBe(3800);
  });
});
