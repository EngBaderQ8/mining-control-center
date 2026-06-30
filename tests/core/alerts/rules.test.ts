import { describe, it, expect } from "vitest";
import { evaluateAlerts } from "../../../src/core/alerts/rules";
import type { DeviceStatus } from "../../../src/core/model/device";

const base: DeviceStatus = {
  deviceId: "d",
  state: "online",
  hashrateTHs: 95,
  avgHashrateTHs: 95,
  maxTempC: 60,
  fanRpm: 4000,
  pool: "p",
  worker: "w",
  hwErrorRate: 0,
  uptimeSec: 1,
  lastSeen: 1,
};

describe("evaluateAlerts", () => {
  it("does NOT fire offline here (the service debounces that to avoid flap-spam)", () => {
    const a = evaluateAlerts(
      base,
      { ...base, state: "offline", hashrateTHs: 0 },
      { overheatC: 80, hashDropFrac: 0.7 },
    );
    expect(a.map((x) => x.kind)).not.toContain("offline");
  });
  it("uses the device name (not the UUID) in the message when provided", () => {
    const prev = { ...base, maxTempC: 70 };
    const now = { ...base, maxTempC: 85 };
    const a = evaluateAlerts(prev, now, { overheatC: 80, hashDropFrac: 0.7 }, "ASIC-47");
    expect(a[0]?.message).toContain("ASIC-47");
  });
  it("fires overheat once on transition", () => {
    const prev = { ...base, maxTempC: 70 };
    const now = { ...base, maxTempC: 85 };
    expect(
      evaluateAlerts(prev, now, { overheatC: 80, hashDropFrac: 0.7 }).map((x) => x.kind),
    ).toContain("overheat");
    expect(evaluateAlerts(now, now, { overheatC: 80, hashDropFrac: 0.7 })).toHaveLength(0);
  });
  it("fires hashrate drop below fraction of average", () => {
    const now = { ...base, hashrateTHs: 50, avgHashrateTHs: 95 };
    expect(
      evaluateAlerts(base, now, { overheatC: 80, hashDropFrac: 0.7 }).map((x) => x.kind),
    ).toContain("hashdrop");
  });
});
