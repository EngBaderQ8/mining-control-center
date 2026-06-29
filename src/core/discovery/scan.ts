import type { Transport } from "../drivers/types";
import type { Firmware } from "../model/device";
import { buildRequest } from "../cgminer/protocol";
import { detectFromVersion } from "./detect";

export interface DiscoveredDevice {
  host: string;
  firmware: Firmware;
  model: string;
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
  try {
    const raw = await t.tcp4028(host, port, buildRequest("version"));
    const d = detectFromVersion(raw);
    return d ? { host, firmware: d.firmware, model: d.model } : null;
  } catch {
    return null;
  }
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
