import type { DeviceStatus } from "../model/device";
import type { CgminerSection } from "./parse";

interface RawBundle {
  summary: CgminerSection;
  stats: CgminerSection;
  pools: CgminerSection;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

/**
 * Build a DeviceStatus by extracting fields with regex straight from the raw
 * 4028 reply strings. Robust to the slightly-malformed JSON some Antminer
 * firmware emits (where strict JSON.parse fails) — like BTC Tools.
 */
export function extractStatusFromRaw(
  deviceId: string,
  sumRaw: string,
  statRaw: string,
  poolRaw: string,
  now: number,
): DeviceStatus {
  const one = (raw: string, key: string): number => {
    const m = new RegExp(`"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"?(-?[\\d.]+)`, "i").exec(raw);
    return m ? Number(m[1]) || 0 : 0;
  };
  const many = (raw: string, src: string): number[] => {
    const out: number[] = [];
    const re = new RegExp(src, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) out.push(Number(m[1]) || 0);
    return out;
  };

  const ghs5 = one(sumRaw, "GHS 5s") || one(statRaw, "GHS 5s");
  const ghsAv = one(sumRaw, "GHS av") || one(statRaw, "GHS av");
  const temps = many(statRaw, '"temp[^"]*"\\s*:\\s*"?(-?[\\d.]+)');
  const fans = many(statRaw, '"fan\\d+"\\s*:\\s*"?(\\d+)').filter((f) => f > 0);
  const userM = /"User"\s*:\s*"([^"]+)"/i.exec(poolRaw);
  const user = userM ? userM[1]! : "";
  const worker = user.includes(".") ? user.slice(user.indexOf(".") + 1) : user;
  const urlM = /"URL"\s*:\s*"([^"]+)"/i.exec(poolRaw);
  const pool = urlM ? urlM[1]!.replace(/^.*:\/\//, "") : "";

  return {
    deviceId,
    state: ghs5 > 0 ? "online" : "offline",
    hashrateTHs: ghs5 / 1000,
    avgHashrateTHs: ghsAv / 1000,
    maxTempC: temps.length ? Math.max(...temps) : 0,
    fanRpm: fans.length ? fans[0]! : 0,
    pool,
    worker,
    hwErrorRate: one(sumRaw, "Device Hardware%") / 100,
    uptimeSec: one(sumRaw, "Elapsed") || one(statRaw, "Elapsed"),
    lastSeen: now,
  };
}

export function normalizeStatus(deviceId: string, raw: RawBundle, now: number): DeviceStatus {
  const ghs5 = num(raw.summary["GHS 5s"]);
  const ghsAv = num(raw.summary["GHS av"]);
  const temps = Object.entries(raw.stats)
    .filter(([k]) => /^temp/i.test(k))
    .map(([, v]) => num(v));
  const fans = Object.entries(raw.stats)
    .filter(([k]) => /^fan/i.test(k))
    .map(([, v]) => num(v))
    .filter((f) => f > 0);
  const user = String(raw.pools["User"] ?? "");
  const worker = user.includes(".") ? user.slice(user.indexOf(".") + 1) : user;
  const url = String(raw.pools["URL"] ?? "").replace(/^.*:\/\//, "");
  return {
    deviceId,
    state: ghs5 > 0 ? "online" : "offline",
    hashrateTHs: ghs5 / 1000,
    avgHashrateTHs: ghsAv / 1000,
    maxTempC: temps.length ? Math.max(...temps) : 0,
    fanRpm: fans.length ? fans[0]! : 0,
    pool: url,
    worker,
    hwErrorRate: num(raw.summary["Device Hardware%"]) / 100,
    uptimeSec: num(raw.summary["Elapsed"]),
    lastSeen: now,
  };
}
