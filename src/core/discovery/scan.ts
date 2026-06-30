import type { Transport } from "../drivers/types";
import type { Firmware, Device } from "../model/device";
import { buildRequest } from "../cgminer/protocol";
import { detectFromVersion } from "./detect";

export interface DiscoveredDevice {
  host: string;
  firmware: Firmware;
  model: string;
  hwId?: string; // stable MAC, when the miner exposed one
}

export interface RescanPlan {
  /** A known device that moved to a new IP — update its host in place (no duplicate). */
  relocate: Array<{ deviceId: string; host: string }>;
  /** Genuinely new miners to add to the site. */
  add: DiscoveredDevice[];
}

/**
 * Decide what an auto-discovery sweep should do with the miners it found, WITHOUT
 * ever creating a phantom: a found miner whose MAC matches an existing device is the
 * SAME box on a new IP → relocate (update host); only a truly-new miner is added. A
 * found host that already maps to a device is skipped. Pure + unit-tested.
 */
export function planRescan(found: DiscoveredDevice[], siteDevices: Device[]): RescanPlan {
  const byHwId = new Map(siteDevices.filter((d) => d.hwId).map((d) => [d.hwId!, d]));
  const usedHosts = new Set(siteDevices.map((d) => d.host));
  const relocate: RescanPlan["relocate"] = [];
  const add: DiscoveredDevice[] = [];
  for (const f of found) {
    if (usedHosts.has(f.host)) continue; // a device already lives on this IP
    const existing = f.hwId ? byHwId.get(f.hwId) : undefined;
    if (existing) {
      if (existing.host !== f.host) {
        relocate.push({ deviceId: existing.id, host: f.host });
        byHwId.delete(f.hwId!); // one relocation per device per sweep
        usedHosts.add(f.host);
      }
      // same hwId + same host = already correct → nothing to do
    } else {
      add.push(f);
      usedHosts.add(f.host);
    }
  }
  return { relocate, add };
}

/**
 * All host addresses (.1–.254) on the /24 of the given input. Accepts either a
 * 3-octet base ("192.168.0") or a full IP ("192.168.0.113") — both yield the
 * same /24 host list.
 */
export function subnetHosts(input: string): string[] {
  const parts = input.trim().split(".");
  if (parts.length < 3 || parts.length > 4) return [];
  const oct = parts.slice(0, 3);
  // Strict 0–255 check rejects empty/garbage/out-of-range octets
  // ("192..1", "300.1.1", "1e2.1.1", " 1.2.3" all -> []).
  if (oct.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return [];
  const base = oct.join(".");
  return Array.from({ length: 254 }, (_, i) => `${base}.${i + 1}`);
}

/** Probe one host on the 4028 API; return a discovered device if it's a miner. */
export async function probeHost(
  host: string,
  port: number,
  t: Transport,
): Promise<DiscoveredDevice | null> {
  const probe = async (cmd: string): Promise<DiscoveredDevice | null> => {
    try {
      const d = detectFromVersion(await t.tcp4028(host, port, buildRequest(cmd)));
      return d ? { host, firmware: d.firmware, model: d.model } : null;
    } catch {
      return null;
    }
  };
  // Antminer answers `version`; some Whatsminer firmware answers `get_version`,
  // and a few only reveal themselves via `summary` (MHS/Whatsminer markers).
  return (await probe("version")) ?? (await probe("get_version")) ?? (await probe("summary"));
}

/** Probe many hosts concurrently (capped) and return the miners found. */
export async function scanHosts(
  hosts: string[],
  port: number,
  t: Transport,
  maxConcurrency: number,
): Promise<DiscoveredDevice[]> {
  const found: DiscoveredDevice[] = [];
  let i = 0;
  async function worker(): Promise<void> {
    while (i < hosts.length) {
      const host = hosts[i++]!;
      const d = await probeHost(host, port, t);
      if (d) found.push(d);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, hosts.length) }, worker),
  );
  return found;
}
