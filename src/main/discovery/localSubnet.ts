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
  const ifaces = networkInterfaces();
  for (const addrs of Object.values(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && isPrivate(a.address)) return a.address;
    }
  }
  return null;
}
