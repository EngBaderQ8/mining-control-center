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
}

export function computeSummary(
  sites: Site[],
  devices: Device[],
  statusById: Map<string, DeviceStatus>,
): Summary {
  let online = 0,
    offline = 0,
    warning = 0,
    totalTHs = 0;
  for (const d of devices) {
    const s = statusById.get(d.id);
    if (!s || s.state === "offline") offline++;
    else if (s.state === "warning") warning++;
    else online++;
    if (s) totalTHs += s.hashrateTHs;
  }
  return { siteCount: sites.length, total: devices.length, online, offline, warning, totalTHs };
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
