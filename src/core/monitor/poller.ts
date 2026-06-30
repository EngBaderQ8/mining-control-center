import type { Device, DeviceStatus } from "../model/device";
import type { Transport } from "../drivers/types";
import { buildRequest } from "../cgminer/protocol";
import { extractStatusFromRaw } from "../cgminer/normalize";
import { parseDeviceHealth } from "../diagnose/parse";

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
 * Poll one device. Tries a single combined `summary+stats+pools` request first
 * (one connection — Antminer firmware dislikes concurrent 4028 connections), and
 * falls back to sequential single commands. Parsing is lenient/regex-based, so
 * slightly-malformed JSON and varied formats still yield a hashrate.
 */
export async function pollDevice(
  device: Device,
  t: Transport,
  now: number,
): Promise<DeviceStatus> {
  const ask = async (cmd: string): Promise<string> => {
    try {
      return await t.tcp4028(device.host, device.apiPort, buildRequest(cmd));
    } catch {
      return "";
    }
  };

  // One connection that returns everything (fields land in a single blob).
  const combined = await ask("summary+stats+pools");
  if (combined) {
    const s = extractStatusFromRaw(device.id, combined, combined, combined, now);
    if (s.hashrateTHs > 0) {
      let health = parseDeviceHealth(combined);
      if (health.boards.length === 0) {
        // Some firmware omits the per-chain breakdown from the combined reply —
        // fetch `stats` alone (full per-board detail) so diagnostics still work.
        const statsAlone = await ask("stats");
        if (statsAlone) {
          const h2 = parseDeviceHealth(statsAlone);
          if (h2.boards.length > 0) health = h2;
        }
      }
      return { ...s, health };
    }
  }

  // Fallback: separate sequential requests.
  const sumRaw = await ask("summary");
  const statRaw = await ask("stats");
  const poolRaw = await ask("pools");
  if (!sumRaw && !statRaw && !combined) return offline(device.id, now);
  const s = extractStatusFromRaw(
    device.id,
    sumRaw || combined,
    statRaw || combined,
    poolRaw || combined,
    now,
  );
  return { ...s, health: parseDeviceHealth(statRaw || combined) };
}
