import type { Device, DeviceStatus } from "../model/device";
import type { Transport } from "../drivers/types";
import { buildRequest } from "../cgminer/protocol";
import { extractStatusFromRaw } from "../cgminer/normalize";

function offline(deviceId: string, now: number): DeviceStatus {
  return {
    deviceId,
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

/**
 * Poll one device. Requests summary/stats/pools SEQUENTIALLY (one connection at
 * a time) because Antminer firmware often refuses concurrent 4028 connections,
 * and parses leniently from the raw text.
 */
export async function pollDevice(
  device: Device,
  t: Transport,
  now: number,
): Promise<DeviceStatus> {
  const fetch = async (cmd: string): Promise<string> => {
    try {
      return await t.tcp4028(device.host, device.apiPort, buildRequest(cmd));
    } catch {
      return "";
    }
  };

  const sumRaw = await fetch("summary");
  if (!sumRaw) return offline(device.id, now); // unreachable / no API
  const statRaw = await fetch("stats");
  const poolRaw = await fetch("pools");
  return extractStatusFromRaw(device.id, sumRaw, statRaw, poolRaw, now);
}
