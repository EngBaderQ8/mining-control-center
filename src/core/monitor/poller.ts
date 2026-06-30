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

  // Fast path: Antminer returns hashrate + temps + chains + pools in ONE
  // connection. (Whatsminer rejects the `stats` part, so it won't match here.)
  const combined = await ask("summary+stats+pools");
  if (combined) {
    const s = extractStatusFromRaw(device.id, combined, combined, combined, now);
    if (s.hashrateTHs > 0) {
      if (/"MHS /.test(combined)) {
        // Whatsminer: the HASHBOARD temperature (~70-74°C — exactly what the
        // official WhatsMinerTool shows) is reported per board by `edevs`, NOT in
        // `summary` (which only has chip-junction temps that run ~15° hotter and
        // would trip false overheat warnings). Read it for an accurate temp.
        const edevs = await ask("edevs");
        const sWM = edevs
          ? extractStatusFromRaw(device.id, combined, `${edevs} ${combined}`, combined, now)
          : s;
        return { ...sWM, health: parseDeviceHealth(combined) };
      }
      let health = parseDeviceHealth(combined);
      if (health.boards.length === 0) {
        const statsAlone = await ask("stats");
        if (statsAlone) {
          const h2 = parseDeviceHealth(statsAlone);
          if (h2.boards.length > 0) health = h2;
        }
      }
      return { ...s, health };
    }
  }

  // Recovery path (Whatsminer, or an Antminer whose combined reply failed).
  // Whatsminer tolerates few concurrent 4028 connections, so keep it minimal:
  // `summary` carries hashrate + temp + fan; one retry rides out a refused
  // connection (the cause of false "offline" flapping).
  const fetchSummary = async (withPool: boolean): Promise<DeviceStatus | null> => {
    const sumRaw = await ask("summary");
    if (!sumRaw) return null;
    const poolRaw = withPool ? await ask("pools") : "";
    // Antminer keeps temps (and per-board detail) in `stats`. Whatsminer keeps the
    // hashboard temperature in `edevs` (~70-74°C, the WhatsMinerTool value) — its
    // `summary` has only chip temps, and it rejects `stats`. Fetch the right one so
    // neither family loses an accurate temperature reading.
    const isWM = /"MHS /.test(sumRaw);
    const extraRaw = withPool ? await ask(isWM ? "edevs" : "stats") : "";
    return extractStatusFromRaw(device.id, sumRaw, extraRaw || sumRaw, poolRaw || combined, now);
  };
  let s = await fetchSummary(true);
  if (!s || s.hashrateTHs <= 0) {
    const retry = await fetchSummary(false); // one retry, summary-only (1 connection)
    if (retry && retry.hashrateTHs > 0) s = retry;
    else s = s ?? retry;
  }
  if (!s) {
    if (!combined) return offline(device.id, now);
    s = extractStatusFromRaw(device.id, combined, combined, combined, now);
  }
  return { ...s, health: parseDeviceHealth(combined) };
}
