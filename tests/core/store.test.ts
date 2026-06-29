import { describe, it, expect } from "vitest";
import {
  computeSummary,
  matchesFilter,
  groupBySite,
  EMPTY_FILTER,
} from "../../src/renderer/state/store";
import type { Device, DeviceStatus, Site } from "../../src/core/model/device";

const site: Site = { id: "s1", name: "الرياض" };
const mk = (id: string, firmware: Device["firmware"] = "stock"): Device => ({
  id,
  siteId: "s1",
  name: id,
  model: "S19",
  firmware,
  host: "h",
  apiPort: 4028,
  controlPort: 80,
});
const st = (id: string, state: DeviceStatus["state"], ths: number): DeviceStatus => ({
  deviceId: id,
  state,
  hashrateTHs: ths,
  avgHashrateTHs: ths,
  maxTempC: 60,
  fanRpm: 4000,
  pool: "p",
  worker: `w-${id}`,
  hwErrorRate: 0,
  uptimeSec: 1,
  lastSeen: 1,
});

describe("store helpers", () => {
  it("computes a summary across statuses", () => {
    const devices = [mk("a"), mk("b"), mk("c")];
    const map = new Map([
      ["a", st("a", "online", 95)],
      ["b", st("b", "warning", 100)],
      // c has no status -> counted offline
    ]);
    const s = computeSummary([site], devices, map);
    expect(s).toMatchObject({ siteCount: 1, total: 3, online: 1, warning: 1, offline: 1 });
    expect(s.totalTHs).toBeCloseTo(195, 0);
  });

  it("filters by text, state, and firmware", () => {
    const d = mk("rig-01", "vnish");
    const s = st("rig-01", "online", 95);
    expect(matchesFilter(d, s, { ...EMPTY_FILTER, text: "rig-01" })).toBe(true);
    expect(matchesFilter(d, s, { ...EMPTY_FILTER, text: "zzz" })).toBe(false);
    expect(matchesFilter(d, s, { ...EMPTY_FILTER, state: "offline" })).toBe(false);
    expect(matchesFilter(d, s, { ...EMPTY_FILTER, firmware: "vnish" })).toBe(true);
    expect(matchesFilter(d, s, { ...EMPTY_FILTER, firmware: "stock" })).toBe(false);
  });

  it("matches by site name so an operator can narrow to one of many sites", () => {
    const d = mk("rig-01");
    const s = st("rig-01", "online", 95);
    // The text doesn't match the device but does match the site name passed in.
    expect(matchesFilter(d, s, { ...EMPTY_FILTER, text: "الرياض" })).toBe(false);
    expect(matchesFilter(d, s, { ...EMPTY_FILTER, text: "الرياض" }, "الرياض — المستودع")).toBe(true);
    // groupBySite threads site.name through, so filtering by site name keeps it.
    const groups = groupBySite([site], [d], new Map([["rig-01", s]]), {
      ...EMPTY_FILTER,
      text: "الرياض",
    });
    expect(groups).toHaveLength(1);
  });

  it("groups by site and drops empty sites after filtering", () => {
    const devices = [mk("a"), mk("b")];
    const map = new Map([["a", st("a", "online", 95)]]);
    const groups = groupBySite([site], devices, map, { ...EMPTY_FILTER, state: "online" });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.views).toHaveLength(1);
    expect(groups[0]?.views[0]?.device.id).toBe("a");
  });
});
