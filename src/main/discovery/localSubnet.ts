import { networkInterfaces } from "node:os";

function isPrivate(ip: string): boolean {
  return (
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

/** The machine's primary private IPv4 address, or null if none is found. */
export function localIpv4(): string | null {
  return localIpv4s()[0] ?? null;
}

/** All connected private IPv4 addresses on the machine (any adapter). */
export function localIpv4s(): string[] {
  const out: string[] = [];
  const ifaces = networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && isPrivate(a.address)) out.push(a.address);
    }
  }
  return out;
}

/** Unique /24 bases (e.g. "192.168.0") for every connected private network. */
export function localPrivateBases(): string[] {
  const bases = new Set<string>();
  for (const ip of localIpv4s()) bases.add(ip.split(".").slice(0, 3).join("."));
  return [...bases];
}
