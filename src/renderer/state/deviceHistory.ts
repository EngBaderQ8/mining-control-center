import type { DeviceStatus } from "../../core/model/device";
import type { DeviceSample } from "../../core/predict/analyze";

export type DeviceHistory = Record<string, DeviceSample[]>;

const KEY = "mcc.deviceHistory";

export interface RecordOpts {
  maxPerDevice: number;
  minIntervalMs: number;
}

/**
 * Append one sample per device (throttled per device), capped. Pure: returns the
 * SAME reference when nothing changed so a React setState can skip re-rendering.
 */
export function recordSamples(
  store: DeviceHistory,
  statuses: DeviceStatus[],
  now: number,
  opts: RecordOpts,
): DeviceHistory {
  let changed = false;
  const next: DeviceHistory = { ...store };
  for (const s of statuses) {
    const arr = next[s.deviceId] ?? [];
    const last = arr[arr.length - 1];
    if (last && now - last.t < opts.minIntervalMs) continue;
    const boards = s.health?.boards?.map((h) => ({ b: h.board, chips: h.chips, ghs: h.rateGhs, hwErr: h.hwErrors }));
    const sample: DeviceSample = {
      t: now,
      temp: s.maxTempC,
      ths: s.hashrateTHs,
      online: s.state !== "offline",
      ...(boards && boards.length > 0 ? { boards } : {}),
    };
    const appended = arr.concat(sample);
    next[s.deviceId] = appended.length > opts.maxPerDevice ? appended.slice(appended.length - opts.maxPerDevice) : appended;
    changed = true;
  }
  return changed ? next : store;
}

export function loadDeviceHistory(): DeviceHistory {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v: unknown = JSON.parse(raw);
      if (v && typeof v === "object") return v as DeviceHistory;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function saveDeviceHistory(store: DeviceHistory): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* ignore quota */
  }
}
