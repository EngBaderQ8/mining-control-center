import { describe, it, expect } from "vitest";
import { runBulk } from "../../../src/core/bulk/engine";
import type { Device } from "../../../src/core/model/device";

const mk = (id: string): Device => ({
  id,
  siteId: "s",
  name: id,
  model: "S19",
  firmware: "braiins",
  host: "h",
  apiPort: 4028,
  controlPort: 4028,
});

describe("runBulk", () => {
  it("returns one outcome per device and isolates failures", async () => {
    const devices = [mk("a"), mk("b"), mk("c")];
    const outcomes = await runBulk(devices, "reboot", { maxConcurrency: 2 }, async (d) => {
      if (d.id === "b") return { deviceId: d.id, ok: false, error: "boom" };
      return { deviceId: d.id, ok: true };
    });
    expect(outcomes).toHaveLength(3);
    expect(outcomes.find((o) => o.deviceId === "b")?.ok).toBe(false);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(2);
  });
});
