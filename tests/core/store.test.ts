import { describe, it, expect } from "vitest";
import {
  computeSummary,
  matchesFilter,
  groupBySite,
  sortViews,
  agedStatus,
  STATUS_STALE_MS,
  EMPTY_FILTER,
  type DeviceView,
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
    const s = computeSummary([site], devices, map, 1);
    expect(s).toMatchObject({ siteCount: 1, total: 3, online: 1, warning: 1, offline: 1 });
    expect(s.totalTHs).toBeCloseTo(195, 0);
  });

  it("ages a stale device to OFFLINE — a laptop that stopped reporting isn't 'online'", () => {
    const devices = [mk("a"), mk("b")];
    const map = new Map([
      ["a", st("a", "online", 95)], // lastSeen: 1
      ["b", st("b", "online", 100)],
    ]);
    // 'now' far past lastSeen ⇒ both stale ⇒ offline, and their hashrate drops out of the total.
    const s = computeSummary([site], devices, map, STATUS_STALE_MS + 1000);
    expect(s).toMatchObject({ online: 0, offline: 2, warning: 0 });
    expect(s.totalTHs).toBe(0);
  });

  it("agedStatus: fresh stays, stale becomes offline with zeroed live metrics", () => {
    const fresh = st("a", "online", 95); // lastSeen: 1
    expect(agedStatus(fresh, 1)).toBe(fresh); // within window → same object
    const aged = agedStatus(fresh, STATUS_STALE_MS + 2);
    expect(aged?.state).toBe("offline");
    expect(aged?.hashrateTHs).toBe(0);
    expect(aged?.maxTempC).toBe(0);
    expect(agedStatus(undefined, 999)).toBeUndefined();
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
    const groups = groupBySite(
      [site],
      [d],
      new Map([["rig-01", s]]),
      { ...EMPTY_FILTER, text: "الرياض" },
      1,
    );
    expect(groups).toHaveLength(1);
  });

  it("sorts views by hashrate (desc/asc) and device name numerically", () => {
    const mkV = (id: string, ths: number): DeviceView => ({ device: mk(id), status: st(id, "online", ths) });
    const views = [mkV("S19-105", 300), mkV("S19-101", 250), mkV("S19-2", 310)];
    const byHashDesc = sortViews(views, { key: "hashrate", dir: "desc" }).map((v) => v.status?.hashrateTHs);
    expect(byHashDesc).toEqual([310, 300, 250]);
    const byHashAsc = sortViews(views, { key: "hashrate", dir: "asc" }).map((v) => v.status?.hashrateTHs);
    expect(byHashAsc).toEqual([250, 300, 310]);
    // Numeric name sort: "S19-2" before "S19-101" before "S19-105".
    const byName = sortViews(views, { key: "name", dir: "asc" }).map((v) => v.device.name);
    expect(byName).toEqual(["S19-2", "S19-101", "S19-105"]);
  });

  it("sortViews does not mutate the input array", () => {
    const mkV = (id: string, ths: number): DeviceView => ({ device: mk(id), status: st(id, "online", ths) });
    const views = [mkV("a", 1), mkV("b", 2)];
    const copy = [...views];
    sortViews(views, { key: "hashrate", dir: "desc" });
    expect(views).toEqual(copy);
  });

  it("groups by site and drops empty sites after filtering", () => {
    const devices = [mk("a"), mk("b")];
    const map = new Map([["a", st("a", "online", 95)]]);
    const groups = groupBySite([site], devices, map, { ...EMPTY_FILTER, state: "online" }, 1);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.views).toHaveLength(1);
    expect(groups[0]?.views[0]?.device.id).toBe("a");
  });
});
