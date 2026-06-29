import type { Device, DeviceStatus, DeviceState, Firmware, Site } from "../../core/model/device";

export interface DeviceView {
  device: Device;
  status: DeviceStatus | undefined;
}

export interface Filter {
  text: string;
  state: DeviceState | "all";
  firmware: Firmware | "all";
}

export const EMPTY_FILTER: Filter = { text: "", state: "all", firmware: "all" };

export interface Summary {
  siteCount: number;
  total: number;
  online: number;
  offline: number;
  warning: number;
  totalTHs: number;
  avgTempC: number;
}

export function computeSummary(
  sites: Site[],
  devices: Device[],
  statusById: Map<string, DeviceStatus>,
): Summary {
  let online = 0,
    offline = 0,
    warning = 0,
    totalTHs = 0,
    tempSum = 0,
    tempCount = 0;
  for (const d of devices) {
    const s = statusById.get(d.id);
    if (!s || s.state === "offline") offline++;
    else if (s.state === "warning") warning++;
    else online++;
    if (s) totalTHs += s.hashrateTHs;
    if (s && s.maxTempC > 0) {
      tempSum += s.maxTempC;
      tempCount++;
    }
  }
  return {
    siteCount: sites.length,
    total: devices.length,
    online,
    offline,
    warning,
    totalTHs,
    avgTempC: tempCount ? tempSum / tempCount : 0,
  };
}

export function matchesFilter(
  device: Device,
  status: DeviceStatus | undefined,
  filter: Filter,
  siteName = "",
): boolean {
  const text = filter.text.trim().toLowerCase();
  if (text) {
    const hay = `${device.name} ${device.model} ${status?.worker ?? ""} ${siteName}`.toLowerCase();
    if (!hay.includes(text)) return false;
  }
  if (filter.state !== "all") {
    const state: DeviceState = status?.state ?? "offline";
    if (state !== filter.state) return false;
  }
  if (filter.firmware !== "all" && device.firmware !== filter.firmware) return false;
  return true;
}

export type SortKey =
  | "name"
  | "status"
  | "firmware"
  | "hashrate"
  | "temp"
  | "fan"
  | "worker"
  | "uptime";

export interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

export const DEFAULT_SORT: SortState = { key: "name", dir: "asc" };

/** Numeric columns default to descending (highest first) on first click. */
export function isNumericSort(key: SortKey): boolean {
  return key === "hashrate" || key === "temp" || key === "fan" || key === "uptime" || key === "status";
}

const stateRank = (s: DeviceState | undefined): number =>
  s === "online" ? 2 : s === "warning" ? 1 : 0;

function sortValue(v: DeviceView, key: SortKey): number | string {
  const st = v.status;
  switch (key) {
    case "name":
      return v.device.name;
    case "firmware":
      return v.device.firmware;
    case "worker":
      return st?.worker ?? "";
    case "status":
      return stateRank(st?.state);
    case "hashrate":
      return st?.hashrateTHs ?? -1;
    case "temp":
      return st?.maxTempC ?? -1;
    case "fan":
      return st?.fanRpm ?? -1;
    case "uptime":
      return st?.uptimeSec ?? -1;
  }
}

/** Return a new, sorted copy of the views (device names sort numerically so
 *  '…-101' comes before '…-105'). Stable for equal keys (preserves input order). */
export function sortViews(views: DeviceView[], sort: SortState): DeviceView[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  return views
    .map((v, i) => ({ v, i }))
    .sort((a, b) => {
      const av = sortValue(a.v, sort.key);
      const bv = sortValue(b.v, sort.key);
      let cmp: number;
      if (typeof av === "string" || typeof bv === "string") {
        cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      } else {
        cmp = av - bv;
      }
      return cmp !== 0 ? cmp * dir : a.i - b.i; // stable tiebreak
    })
    .map((x) => x.v);
}

export interface SiteGroup {
  site: Site;
  views: DeviceView[];
}

/** Group devices under their sites, applying the filter and dropping empty sites. */
export function groupBySite(
  sites: Site[],
  devices: Device[],
  statusById: Map<string, DeviceStatus>,
  filter: Filter,
): SiteGroup[] {
  return sites
    .map((site) => ({
      site,
      views: devices
        .filter((d) => d.siteId === site.id)
        .map((device) => ({ device, status: statusById.get(device.id) }))
        .filter((v) => matchesFilter(v.device, v.status, filter, site.name)),
    }))
    .filter((g) => g.views.length > 0);
}
