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
  // Accept scientific notation too — Whatsminer MH values can be large/exponent.
  const m = new RegExp(`"${esc(key)}"\\s*:\\s*"?(-?[\\d.]+(?:[eE][+-]?\\d+)?)`, "i").exec(raw);
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
 * Convert a raw hashrate number to TH/s by INFERRING the unit from its magnitude.
 * Firmwares disagree wildly — the same ~110 TH miner is reported as 110 (TH/s),
 * 110000 (GH/s), or 110000000 (MH/s), and even the same key ("MHS av") means MH/s
 * on one Whatsminer and TH/s on another. A single ASIC is well under ~2000 TH, so
 * magnitude unambiguously identifies the unit for real miners.
 */
function toTH(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (v < 2000) return v; // already TH/s
  if (v < 5e7) return v / 1_000; // GH/s
  if (v < 5e10) return v / 1_000_000; // MH/s
  return v / 1e12; // H/s
}

/**
 * Hashrate in TH/s. Tries common keys in preference order (current metrics first,
 * then averages) and infers the unit by magnitude — so it handles Antminer (GHS),
 * both Whatsminer reply shapes (MHS in MH/s OR in TH/s), THS, and Vnish rate_*.
 * The "5s" path falls back to averages (some firmware report only "MHS av").
 */
function hashTHs(raw: string, which: "5s" | "av"): number {
  const keys =
    which === "5s"
      ? [
          "GHS 5s", "MHS 5s", "THS 5s", "HS RT", "GHS 1m", "MHS 1m",
          "GHS 5m", "MHS 5m", "MHS 15m", "rate_5s", "GHS 30m", "MHS 30m",
          // Fallbacks when no current-metric key exists (e.g. Whatsminer that
          // only reports an average): use the average so it isn't read as 0.
          "GHS av", "MHS av", "THS av", "rate_avg",
        ]
      : ["GHS av", "MHS av", "THS av", "MHS 15m", "HS RT", "rate_avg", "rate_ideal"];
  for (const k of keys) {
    const v = one(raw, k);
    if (v) return toTH(v);
  }
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
  // Search stats AND summary: Antminer puts temp*/fan* in stats; Whatsminer puts
  // "Temperature"/"Fan Speed In|Out" in summary (its `stats` cmd is unsupported).
  const hwRaw = `${statRaw} ${sumRaw}`;
  const temps = many(hwRaw, '"temp[^"]*"\\s*:\\s*"?(-?[\\d.]+)').filter((x) => x > 0 && x < 200);
  // Broadened to catch "Fan Speed In/Out"; >100 excludes count fields like fan_num.
  const fans = many(hwRaw, '"fan[^"]*"\\s*:\\s*"?(\\d+)').filter((f) => f > 100);
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
