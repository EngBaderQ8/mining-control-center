import type { DeviceStatus } from "../model/device";
import type { ControlCommand } from "../drivers/types";

export interface RecoverySettings {
  enabled: boolean;
  rebootOfflineMin: number; // reboot a device offline at least this many minutes
  overheatStopC: number; // stop a device at/above this temperature (protect)
  cooldownMin: number; // minimum minutes between auto-actions on the same device
}

export const DEFAULT_RECOVERY: RecoverySettings = {
  enabled: false,
  rebootOfflineMin: 10,
  overheatStopC: 90,
  cooldownMin: 20,
};

export interface RecoveryDecision {
  action: ControlCommand | null;
  reason: string;
}

/**
 * Decide whether to auto-act on a device. Overheat protection takes priority
 * (stop a too-hot miner), then reboot a device that's been offline too long.
 * A per-device cooldown prevents action storms.
 */
export function evaluateRecovery(
  status: DeviceStatus,
  offlineSinceMs: number | null,
  lastActionAtMs: number | null,
  settings: RecoverySettings,
  now: number,
): RecoveryDecision {
  if (!settings.enabled) return { action: null, reason: "" };
  if (lastActionAtMs !== null && now - lastActionAtMs < settings.cooldownMin * 60_000) {
    return { action: null, reason: "" }; // still cooling down
  }
  // Overheat — stop to protect the hardware.
  if (status.state !== "offline" && status.maxTempC >= settings.overheatStopC) {
    return { action: "stopMining", reason: `حرارة ${status.maxTempC}° ≥ ${settings.overheatStopC}°` };
  }
  // Offline too long — try a reboot.
  if (
    status.state === "offline" &&
    offlineSinceMs !== null &&
    now - offlineSinceMs >= settings.rebootOfflineMin * 60_000
  ) {
    return { action: "reboot", reason: `غير متصل ${settings.rebootOfflineMin} دقيقة` };
  }
  return { action: null, reason: "" };
}
