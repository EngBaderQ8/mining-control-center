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
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  // One full poll attempt — returns a live status, or null if the miner didn't
  // answer (so the caller can retry before declaring it offline).
  const full = async (): Promise<DeviceStatus | null> => {
    // Whatsminer: the btminer `summary` already carries hashrate (MHS) + Env Temp
    // + fan in ONE connection. Go straight to it (the cgminer `summary+stats+pools`
    // combined hides Env Temp behind a board temp) and add `pools` for the worker.
    // Whatsminer tolerates few 4028 connections, so this keeps it to two.
    if (device.firmware === "whatsminer") {
      const sumRaw = await ask("summary");
      if (!sumRaw) return null;
      const probe = extractStatusFromRaw(device.id, sumRaw, sumRaw, sumRaw, now);
      if (probe.hashrateTHs <= 0) return null;
      const poolRaw = await ask("pools");
      return {
        ...extractStatusFromRaw(device.id, sumRaw, sumRaw, poolRaw || sumRaw, now),
        health: parseDeviceHealth(""),
      };
    }

    // Antminer fast path: hashrate + temps + chains + pools in ONE connection.
    const combined = await ask("summary+stats+pools");
    if (combined) {
      const s = extractStatusFromRaw(device.id, combined, combined, combined, now);
      if (s.hashrateTHs > 0) {
        if (/"MHS /.test(combined)) {
          // A Whatsminer still labelled "stock": the combined reply is cgminer-
          // format (board temp ~72), so read the owner's Env Temp (~34) from the
          // btminer `summary`.
          const sumRaw = await ask("summary");
          if (sumRaw) {
            const sWM = extractStatusFromRaw(device.id, sumRaw, sumRaw, combined, now);
            if (sWM.hashrateTHs > 0) return { ...sWM, health: parseDeviceHealth("") };
          }
          return { ...s, health: parseDeviceHealth("") };
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
    // Combined gave nothing usable — try `summary` directly (+ stats for Antminer).
    const sumRaw = await ask("summary");
    if (sumRaw) {
      const isWM = /"MHS /.test(sumRaw);
      const statRaw = !isWM ? await ask("stats") : "";
      const poolRaw = await ask("pools");
      const s = extractStatusFromRaw(device.id, sumRaw, statRaw || sumRaw, poolRaw || sumRaw, now);
      if (s.hashrateTHs > 0) return { ...s, health: parseDeviceHealth(statRaw) };
    }
    return null;
  };

  const first = await full();
  if (first && first.hashrateTHs > 0) return first;

  // The miner missed a beat — retry a cheap single `summary` twice (with a short
  // pause) before declaring it offline. Healthy miners (especially Whatsminer)
  // intermittently refuse a connection under load; without this they falsely flap
  // online/offline.
  for (let i = 0; i < 2; i++) {
    await sleep(250);
    const raw = await ask("summary");
    if (raw) {
      const s = extractStatusFromRaw(device.id, raw, raw, raw, now);
      if (s.hashrateTHs > 0) return { ...s, health: parseDeviceHealth("") };
    }
  }
  return offline(device.id, now);
}
