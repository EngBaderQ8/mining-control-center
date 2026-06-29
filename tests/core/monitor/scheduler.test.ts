import { describe, it, expect } from "vitest";
import { pollAll } from "../../../src/core/monitor/scheduler";
import type { Device } from "../../../src/core/model/device";

const mk = (id: string): Device => ({
  id,
  siteId: "s",
  name: id,
  model: "S19",
  firmware: "stock",
  host: "h",
  apiPort: 4028,
  controlPort: 80,
});

describe("pollAll", () => {
  it("respects concurrency cap and applies warning overlay", async () => {
    let active = 0,
      peak = 0;
    const devices = [mk("a"), mk("b"), mk("c"), mk("d")];
    const statuses = await pollAll(
      devices,
      { maxConcurrency: 2, warnTempC: 80, now: 1 },
      async (d) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return {
          deviceId: d.id,
          state: "online",
          hashrateTHs: 90,
          avgHashrateTHs: 90,
          maxTempC: d.id === "c" ? 85 : 60,
          fanRpm: 4000,
          pool: "p",
          worker: "w",
          hwErrorRate: 0,
          uptimeSec: 1,
          lastSeen: 1,
        };
      },
    );
    expect(peak).toBeLessThanOrEqual(2);
    expect(statuses.find((s) => s.deviceId === "c")?.state).toBe("warning");
    expect(statuses.find((s) => s.deviceId === "a")?.state).toBe("online");
  });
});
