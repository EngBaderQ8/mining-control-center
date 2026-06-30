import { describe, it, expect } from "vitest";
import { extractMac } from "../../../src/core/discovery/detect";
import { planRescan } from "../../../src/core/discovery/scan";
import type { Device } from "../../../src/core/model/device";
import type { DiscoveredDevice } from "../../../src/core/discovery/scan";

const dev = (id: string, host: string, hwId?: string): Device => ({
  id,
  siteId: "s1",
  name: `n-${id}`,
  model: "S19",
  firmware: "whatsminer",
  host,
  apiPort: 4028,
  controlPort: 4028,
  ...(hwId ? { hwId } : {}),
});
const found = (host: string, hwId?: string): DiscoveredDevice => ({
  host,
  firmware: "whatsminer",
  model: "S19",
  ...(hwId ? { hwId } : {}),
});

describe("extractMac", () => {
  it("finds a MAC anywhere in the reply and lowercases it", () => {
    expect(extractMac('{"Msg":{"mac":"AA:BB:CC:11:22:33","ip":"192.168.0.5"}}')).toBe("aa:bb:cc:11:22:33");
  });
  it("normalises a dash-separated MAC to colons", () => {
    expect(extractMac("mac=00-11-22-33-44-55")).toBe("00:11:22:33:44:55");
  });
  it("ignores the all-zero and broadcast placeholders", () => {
    expect(extractMac('"mac":"00:00:00:00:00:00"')).toBeNull();
    expect(extractMac("ff:ff:ff:ff:ff:ff")).toBeNull();
  });
  it("returns null when there is no MAC", () => {
    expect(extractMac('{"SUMMARY":[{"MHS av":21000000}]}')).toBeNull();
    expect(extractMac("")).toBeNull();
  });
});

describe("planRescan (no phantom devices)", () => {
  it("RELOCATES a known miner that moved IP (matches by MAC) instead of adding a duplicate", () => {
    const existing = [dev("d1", "192.168.0.10", "aa:bb:cc:00:00:01")];
    const plan = planRescan([found("192.168.0.55", "aa:bb:cc:00:00:01")], existing);
    expect(plan.relocate).toEqual([{ deviceId: "d1", host: "192.168.0.55" }]);
    expect(plan.add).toHaveLength(0); // NOT added as a new phantom
  });

  it("ADDS a genuinely new miner (unknown MAC)", () => {
    const existing = [dev("d1", "192.168.0.10", "aa:bb:cc:00:00:01")];
    const plan = planRescan([found("192.168.0.77", "aa:bb:cc:00:00:09")], existing);
    expect(plan.add.map((f) => f.host)).toEqual(["192.168.0.77"]);
    expect(plan.relocate).toHaveLength(0);
  });

  it("does nothing for a host that already maps to a device", () => {
    const existing = [dev("d1", "192.168.0.10", "aa:bb:cc:00:00:01")];
    const plan = planRescan([found("192.168.0.10", "aa:bb:cc:00:00:01")], existing);
    expect(plan.add).toHaveLength(0);
    expect(plan.relocate).toHaveLength(0);
  });

  it("falls back to ADD when the found miner exposes no MAC (can't dedupe)", () => {
    const existing = [dev("d1", "192.168.0.10", "aa:bb:cc:00:00:01")];
    const plan = planRescan([found("192.168.0.88")], existing);
    expect(plan.add).toHaveLength(1);
    expect(plan.relocate).toHaveLength(0);
  });

  it("relocates each device only once even if its MAC appears on two new IPs", () => {
    const existing = [dev("d1", "192.168.0.10", "aa:bb:cc:00:00:01")];
    const plan = planRescan(
      [found("192.168.0.20", "aa:bb:cc:00:00:01"), found("192.168.0.21", "aa:bb:cc:00:00:01")],
      existing,
    );
    expect(plan.relocate).toHaveLength(1);
    // the second sighting becomes an add (a distinct device on a distinct IP)
    expect(plan.add).toHaveLength(1);
  });
});
