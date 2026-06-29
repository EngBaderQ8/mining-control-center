import { describe, it, expect } from "vitest";
import { evaluateRecovery, DEFAULT_RECOVERY } from "../../../src/core/recovery/rules";
import type { DeviceStatus } from "../../../src/core/model/device";

const st = (over: Partial<DeviceStatus>): DeviceStatus => ({
  deviceId: "d",
  state: "online",
  hashrateTHs: 100,
  avgHashrateTHs: 100,
  maxTempC: 65,
  fanRpm: 4000,
  pool: "p",
  worker: "w",
  hwErrorRate: 0,
  uptimeSec: 1,
  lastSeen: 0,
  ...over,
});
const S = { ...DEFAULT_RECOVERY, enabled: true, rebootOfflineMin: 10, overheatStopC: 90, cooldownMin: 20 };
const NOW = 1_000_000_000;

describe("evaluateRecovery", () => {
  it("does nothing when disabled", () => {
    expect(evaluateRecovery(st({}), null, null, { ...S, enabled: false }, NOW).action).toBeNull();
  });

  it("stops an overheating device", () => {
    const d = evaluateRecovery(st({ maxTempC: 92 }), null, null, S, NOW);
    expect(d.action).toBe("stopMining");
    expect(d.reason).toContain("92");
  });

  it("reboots a device offline longer than the threshold", () => {
    const offlineSince = NOW - 11 * 60_000;
    const d = evaluateRecovery(st({ state: "offline" }), offlineSince, null, S, NOW);
    expect(d.action).toBe("reboot");
  });

  it("does NOT reboot a device offline less than the threshold", () => {
    const offlineSince = NOW - 5 * 60_000;
    expect(evaluateRecovery(st({ state: "offline" }), offlineSince, null, S, NOW).action).toBeNull();
  });

  it("respects the per-device cooldown", () => {
    const offlineSince = NOW - 30 * 60_000;
    const lastAction = NOW - 5 * 60_000; // acted 5 min ago, cooldown 20 min
    expect(evaluateRecovery(st({ state: "offline" }), offlineSince, lastAction, S, NOW).action).toBeNull();
  });

  it("acts again after the cooldown elapses", () => {
    const offlineSince = NOW - 30 * 60_000;
    const lastAction = NOW - 21 * 60_000;
    expect(evaluateRecovery(st({ state: "offline" }), offlineSince, lastAction, S, NOW).action).toBe("reboot");
  });

  it("overheat takes priority over offline", () => {
    const d = evaluateRecovery(st({ maxTempC: 95 }), NOW - 60 * 60_000, null, S, NOW);
    expect(d.action).toBe("stopMining");
  });
});
