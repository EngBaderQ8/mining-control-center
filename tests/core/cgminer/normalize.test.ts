import { describe, it, expect } from "vitest";
import { normalizeStatus, extractStatusFromRaw } from "../../../src/core/cgminer/normalize";

const summary = { "GHS 5s": 95200, "GHS av": 94800, "Device Hardware%": 0.21, "Elapsed": 7200 };
const stats = { temp2_1: 64, temp2_2: 81, temp2_3: 70, fan1: 4200, fan2: 0 };
const pools = { URL: "stratum+tcp://pool:3333", "User": "acct.rig02", "Stratum Active": true };

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
