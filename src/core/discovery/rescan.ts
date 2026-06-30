import type { Device } from "../model/device";

const isIpv4 = (h: string): boolean => /^(\d{1,3}\.){3}\d{1,3}$/.test(h);

/** Unique /24 subnet bases (e.g. "192.168.0") that a site's IPv4 devices live on.
 *  Non-IPv4 hosts (e.g. Tailscale names) can't yield a subnet, so they're ignored. */
export function siteSubnetBases(siteId: string, devices: Device[]): string[] {
  const bases = devices
    .filter((d) => d.siteId === siteId && isIpv4(d.host))
    .map((d) => d.host.split(".").slice(0, 3).join("."));
  return [...new Set(bases)];
}

/**
 * IPs in a site's subnet(s) that are NOT already a registered device — the only
 * hosts worth probing on a periodic re-scan. Excluding registered IPs means the
 * auto-discovery sweep never re-connects to a working miner (important: Whatsminer
 * tolerates few 4028 connections), it only looks for newly-online ones.
 */
export function hostsToRescan(
  siteId: string,
  devices: Device[],
  subnetHostsFn: (base: string) => string[],
): string[] {
  const known = new Set(devices.map((d) => d.host));
  const all = siteSubnetBases(siteId, devices).flatMap(subnetHostsFn);
  return [...new Set(all)].filter((h) => !known.has(h));
}
