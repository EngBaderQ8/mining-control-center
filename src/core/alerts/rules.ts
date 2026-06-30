import type { DeviceStatus } from "../model/device";

export type AlertKind = "offline" | "overheat" | "hashdrop" | "recovery";
export interface Alert {
  deviceId: string;
  kind: AlertKind;
  message: string;
}
export interface AlertThresholds {
  overheatC: number;
  hashDropFrac: number;
}

export function evaluateAlerts(
  prev: DeviceStatus,
  now: DeviceStatus,
  th: AlertThresholds,
  name: string = now.deviceId,
): Alert[] {
  const out: Alert[] = [];
  // NOTE: the offline alert is NOT fired here. A device that briefly flaps
  // offline (common on Whatsminer's connection-sensitive API) would otherwise
  // spam a notification every poll. The service debounces it — alerting only
  // after the device stays offline for a confirmation window, and only once.
  if (prev.maxTempC < th.overheatC && now.maxTempC >= th.overheatC)
    out.push({
      deviceId: now.deviceId,
      kind: "overheat",
      message: `${name} حرارة ${now.maxTempC}°C`,
    });
  const dropped =
    now.state !== "offline" &&
    now.avgHashrateTHs > 0 &&
    now.hashrateTHs < now.avgHashrateTHs * th.hashDropFrac;
  const wasOk =
    prev.avgHashrateTHs === 0 || prev.hashrateTHs >= prev.avgHashrateTHs * th.hashDropFrac;
  if (dropped && wasOk)
    out.push({ deviceId: now.deviceId, kind: "hashdrop", message: `${name} هبوط هاش` });
  return out;
}
