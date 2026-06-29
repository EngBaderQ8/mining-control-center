import type { Device, DeviceStatus, Site } from "../core/model/device";
import type { CommandOutcome } from "../core/model/result";
import type { ControlCommand } from "../core/drivers/types";
import type { Alert } from "../core/alerts/rules";
import type { Snapshot } from "../main/service";

export type { Device, DeviceStatus, Site, CommandOutcome, ControlCommand, Alert, Snapshot };

/** IPC channel names shared between main, preload, and renderer. */
export const CH = {
  snapshotGet: "snapshot:get",
  monitorStart: "monitor:start",
  monitorStop: "monitor:stop",
  deviceCommand: "device:command",
  deviceBulk: "device:bulk",
  deviceAdd: "device:add",
  deviceDelete: "device:delete",
  siteAdd: "site:add",
  // push (main -> renderer)
  statusesUpdate: "statuses:update",
  alerts: "alerts",
} as const;

/** The typed surface exposed on `window.api` by the preload bridge. */
export interface Api {
  getSnapshot(): Promise<Snapshot>;
  startMonitoring(): Promise<void>;
  stopMonitoring(): Promise<void>;
  sendCommand(deviceId: string, command: ControlCommand): Promise<CommandOutcome>;
  sendBulk(deviceIds: string[], command: ControlCommand): Promise<CommandOutcome[]>;
  addDevice(device: Device, secret?: string): Promise<void>;
  deleteDevice(id: string): Promise<void>;
  addSite(site: Site): Promise<void>;
  /** Subscribe to live status pushes; returns an unsubscribe function. */
  onStatuses(cb: (statuses: DeviceStatus[]) => void): () => void;
  /** Subscribe to alert pushes; returns an unsubscribe function. */
  onAlerts(cb: (alerts: Alert[]) => void): () => void;
}
