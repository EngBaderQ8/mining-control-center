import { describe, it, expect } from "vitest";
import { buildDailyReport } from "../../../src/core/report/daily";
import type { Device, DeviceStatus } from "../../../src/core/model/device";

const dev = (id: string): Device => ({
  id,
  siteId: "s",
  name: id,
  model: "S19",
  firmware: "stock",
  host: "h",
  apiPort: 4028,
  controlPort: 80,
});
const st = (id: string, state: DeviceStatus["state"], ths: number, temp = 65): DeviceStatus => ({
  deviceId: id,
  state,
  hashrateTHs: ths,
  avgHashrateTHs: ths,
  maxTempC: temp,
  fanRpm: 4000,
  pool: "p",
  worker: "w",
  hwErrorRate: 0,
  uptimeSec: 1,
  lastSeen: 0,
});
const NET = { priceUsd: 60000, difficulty: 9e13, blockRewardBtc: 3.125 };
const NOW = Date.parse("2026-06-30T00:00:00Z");

describe("buildDailyReport", () => {
  it("summarizes hashrate, online/offline, hot, and BTC/day", () => {
    const devices = [dev("a"), dev("b"), dev("c")];
    const statuses = [st("a", "online", 300, 70), st("b", "online", 300, 85), st("c", "offline", 0)];
    const r = buildDailyReport(devices, statuses, NET, NOW);
    expect(r).toContain("2026-06-30");
    expect(r).toContain("600 TH/s");
    expect(r).toContain("شغّال: 2 / 3");
    expect(r).toContain("غير متصل: 1");
    expect(r).toContain("ساخن"); // b is 85° >= 80
    expect(r).toContain("BTC");
  });

  it("omits offline/hot lines when there are none, and BTC line when price is 0", () => {
    const devices = [dev("a")];
    const statuses = [st("a", "online", 100, 60)];
    const r = buildDailyReport(devices, statuses, { ...NET, priceUsd: 0 }, NOW);
    expect(r).not.toContain("غير متصل");
    expect(r).not.toContain("ساخن");
    expect(r).not.toContain("BTC");
  });
});
