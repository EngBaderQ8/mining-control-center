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
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function one(raw: string, key: string): number {
  const m = new RegExp(`"${esc(key)}"\\s*:\\s*"?(-?[\\d.]+)`, "i").exec(raw);
  return m ? Number(m[1]) || 0 : 0;
}
function many(raw: string, src: string): number[] {
  const out: number[] = [];
  const re = new RegExp(src, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out.push(Number(m[1]) || 0);
  return out;
}

/**
 * Hashrate in TH/s, trying every common firmware key/unit (Antminer GHS, some
 * report MHS/THS, Vnish/Braiins use rate_*). Returns the first non-zero match.
 */
function hashTHs(raw: string, which: "5s" | "av"): number {
  const ghsKeys = which === "5s" ? ["GHS 5s", "GHS 30m", "GHS 1m"] : ["GHS av", "GHS 5m"];
  const mhsKeys = which === "5s" ? ["MHS 5s", "MHS 30m"] : ["MHS av"];
  const thsKeys = which === "5s" ? ["THS 5s"] : ["THS av"];
  const rateKeys = which === "5s" ? ["rate_5s", "rate_30m"] : ["rate_avg", "rate_ideal"];
  for (const k of ghsKeys) if (one(raw, k)) return one(raw, k) / 1000;
  for (const k of mhsKeys) if (one(raw, k)) return one(raw, k) / 1_000_000;
  for (const k of thsKeys) if (one(raw, k)) return one(raw, k);
  // rate_* values are usually GH/s on modded firmware.
  for (const k of rateKeys) if (one(raw, k)) return one(raw, k) / 1000;
  return 0;
}

/**
 * Build a DeviceStatus by extracting fields with regex straight from the raw
 * 4028 reply strings. Robust to the slightly-malformed JSON some Antminer
 * firmware emits (where strict JSON.parse fails), to multiple hashrate
 * key/units, and to combined responses — like BTC Tools.
 */
export function extractStatusFromRaw(
  deviceId: string,
  sumRaw: string,
  statRaw: string,
  poolRaw: string,
  now: number,
): DeviceStatus {
  const hash5 = hashTHs(sumRaw, "5s") || hashTHs(statRaw, "5s");
  const hashAv = hashTHs(sumRaw, "av") || hashTHs(statRaw, "av");
  const temps = many(statRaw, '"temp[^"]*"\\s*:\\s*"?(-?[\\d.]+)').filter((x) => x > 0 && x < 200);
  const fans = many(statRaw, '"fan[_ ]?\\d+"\\s*:\\s*"?(\\d+)').filter((f) => f > 0);
  const userM = /"User"\s*:\s*"([^"]+)"/i.exec(poolRaw);
  const user = userM ? userM[1]! : "";
  const worker = user.includes(".") ? user.slice(user.indexOf(".") + 1) : user;
  const urlM = /"URL"\s*:\s*"([^"]+)"/i.exec(poolRaw);
  const pool = urlM ? urlM[1]!.replace(/^.*:\/\//, "") : "";

  return {
    deviceId,
    state: hash5 > 0 ? "online" : "offline",
    hashrateTHs: hash5,
    avgHashrateTHs: hashAv,
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
