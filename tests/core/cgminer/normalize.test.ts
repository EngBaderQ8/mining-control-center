import { describe, it, expect } from "vitest";
import { normalizeStatus } from "../../../src/core/cgminer/normalize";

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
