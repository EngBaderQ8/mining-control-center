import type { Device, DeviceStatus } from "../model/device";
import type { Transport } from "../drivers/types";
import { buildRequest } from "../cgminer/protocol";
import { parseResponse, type CgminerSection } from "../cgminer/parse";
import { normalizeStatus } from "../cgminer/normalize";

function firstSection(raw: string, key: "SUMMARY" | "STATS" | "POOLS"): CgminerSection {
  const p = parseResponse(raw);
  if (!p.ok) return {};
  const arr = p.value[key];
  return Array.isArray(arr) && arr[0] ? arr[0] : {};
}

export async function pollDevice(
  device: Device,
  t: Transport,
  now: number,
): Promise<DeviceStatus> {
  try {
    const [sumRaw, statRaw, poolRaw] = await Promise.all([
      t.tcp4028(device.host, device.apiPort, buildRequest("summary")),
      t.tcp4028(device.host, device.apiPort, buildRequest("stats")),
      t.tcp4028(device.host, device.apiPort, buildRequest("pools")),
    ]);
    return normalizeStatus(
      device.id,
      {
        summary: firstSection(sumRaw, "SUMMARY"),
        stats: firstSection(statRaw, "STATS"),
        pools: firstSection(poolRaw, "POOLS"),
      },
      now,
    );
  } catch {
    return {
      deviceId: device.id,
      state: "offline",
      hashrateTHs: 0,
      avgHashrateTHs: 0,
      maxTempC: 0,
      fanRpm: 0,
      pool: "",
      worker: "",
      hwErrorRate: 0,
      uptimeSec: 0,
      lastSeen: now,
    };
  }
}
