import type { DeviceStatus } from "../model/device";

interface RawBundle {
  summary: Record<string, number | string>;
  stats: Record<string, number | string>;
  pools: Record<string, number | string>;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

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
