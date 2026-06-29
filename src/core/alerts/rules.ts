import type { DeviceStatus } from "../model/device";

export type AlertKind = "offline" | "overheat" | "hashdrop";
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
): Alert[] {
  const out: Alert[] = [];
  if (prev.state !== "offline" && now.state === "offline")
    out.push({ deviceId: now.deviceId, kind: "offline", message: `${now.deviceId} غير متصل` });
  if (prev.maxTempC < th.overheatC && now.maxTempC >= th.overheatC)
    out.push({
      deviceId: now.deviceId,
      kind: "overheat",
      message: `${now.deviceId} حرارة ${now.maxTempC}°C`,
    });
  const dropped =
    now.state !== "offline" &&
    now.avgHashrateTHs > 0 &&
    now.hashrateTHs < now.avgHashrateTHs * th.hashDropFrac;
  const wasOk =
    prev.avgHashrateTHs === 0 || prev.hashrateTHs >= prev.avgHashrateTHs * th.hashDropFrac;
  if (dropped && wasOk)
    out.push({ deviceId: now.deviceId, kind: "hashdrop", message: `${now.deviceId} هبوط هاش` });
  return out;
}
