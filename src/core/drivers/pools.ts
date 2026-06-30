import type { CommandParams } from "./types";

export interface PoolEntry {
  url: string;
  user: string;
  pass: string;
}

/**
 * Pools for a setPool command. Reads the multi-pool `poolsJson` param (an array
 * of up to 3 {url,user,pass}); falls back to the legacy single url/user/pass.
 * Only entries with both a url and a user are kept; capped at 3 (miner limit).
 */
export function parsePools(params?: CommandParams): PoolEntry[] {
  const out: PoolEntry[] = [];
  const pj = params?.["poolsJson"];
  if (pj) {
    try {
      const arr = JSON.parse(pj) as Array<Partial<PoolEntry>>;
      if (Array.isArray(arr)) {
        for (const p of arr) {
          const url = (p?.url ?? "").trim();
          const user = (p?.user ?? "").trim();
          if (url && user) out.push({ url, user, pass: p?.pass ?? "x" });
        }
      }
    } catch {
      /* ignore malformed */
    }
  }
  if (out.length === 0) {
    const url = (params?.["url"] ?? "").trim();
    const user = (params?.["user"] ?? "").trim();
    if (url && user) out.push({ url, user, pass: params?.["pass"] ?? "x" });
  }
  return out.slice(0, 3);
}

/** The trailing numeric segment of an IPv4 host (e.g. 192.168.0.101 → "101"),
 *  or null for non-numeric/DDNS hosts. Used to give each miner a unique worker. */
export function lastOctet(host: string): string | null {
  const last = host.trim().split(".").pop() ?? "";
  return /^\d+$/.test(last) ? last : null;
}
