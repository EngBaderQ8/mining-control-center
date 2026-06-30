import type { CommandParams } from "./types";

export interface PoolEntry {
  url: string;
  user: string;
  pass: string;
}

// A pool field must not contain a comma or CR/LF: those are shipped verbatim to
// the miner over the comma-delimited cgminer 4028 protocol (e.g. Braiins/LuxOS
// `addpool` parameter), so an unvalidated value could inject extra positional
// fields — a pool-hijack primitive. The url must also be a real stratum endpoint.
const SAFE = (s: string): boolean => !/[,\r\n]/.test(s);
const VALID_URL = (u: string): boolean => /^stratum\+(tcp|ssl):\/\/[^\s,]+$/i.test(u);

/**
 * Pools for a setPool command. Reads the multi-pool `poolsJson` param (an array
 * of up to 3 {url,user,pass}); falls back to the legacy single url/user/pass.
 * Entries are kept only if the url is a valid `stratum+tcp/ssl://host:port` and no
 * field contains a comma/CRLF (cgminer-protocol injection guard); capped at 3.
 */
export function parsePools(params?: CommandParams): PoolEntry[] {
  const out: PoolEntry[] = [];
  const add = (rawUrl: unknown, rawUser: unknown, rawPass: unknown): void => {
    const url = String(rawUrl ?? "").trim();
    const user = String(rawUser ?? "").trim();
    const pass = String(rawPass ?? "x");
    if (url && user && VALID_URL(url) && SAFE(user) && SAFE(pass)) out.push({ url, user, pass });
  };
  const pj = params?.["poolsJson"];
  if (pj) {
    try {
      const arr = JSON.parse(pj) as Array<Partial<PoolEntry>>;
      if (Array.isArray(arr)) for (const p of arr) add(p?.url, p?.user, p?.pass ?? "x");
    } catch {
      /* ignore malformed */
    }
  }
  if (out.length === 0) add(params?.["url"], params?.["user"], params?.["pass"] ?? "x");
  return out.slice(0, 3);
}

/** The trailing numeric segment of an IPv4 host (e.g. 192.168.0.101 → "101"),
 *  or null for non-numeric/DDNS hosts. Used to give each miner a unique worker. */
export function lastOctet(host: string): string | null {
  const last = host.trim().split(".").pop() ?? "";
  return /^\d+$/.test(last) ? last : null;
}
