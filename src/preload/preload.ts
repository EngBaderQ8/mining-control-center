import { contextBridge, ipcRenderer } from "electron";
import { CH, type Api } from "../shared/api";
import type { DeviceStatus, Device, Site } from "../core/model/device";
import type { ControlCommand } from "../core/drivers/types";
import type { Alert } from "../core/alerts/rules";

const api: Api = {
  getSnapshot: () => ipcRenderer.invoke(CH.snapshotGet),
  startMonitoring: () => ipcRenderer.invoke(CH.monitorStart),
  stopMonitoring: () => ipcRenderer.invoke(CH.monitorStop),
  sendCommand: (deviceId: string, command: ControlCommand) =>
    ipcRenderer.invoke(CH.deviceCommand, deviceId, command),
  sendBulk: (deviceIds: string[], command: ControlCommand) =>
    ipcRenderer.invoke(CH.deviceBulk, deviceIds, command),
  addDevice: (device: Device, secret?: string) =>
    ipcRenderer.invoke(CH.deviceAdd, device, secret),
  deleteDevice: (id: string) => ipcRenderer.invoke(CH.deviceDelete, id),
  addSite: (site: Site) => ipcRenderer.invoke(CH.siteAdd, site),
  onStatuses: (cb: (statuses: DeviceStatus[]) => void) => {
    const handler = (_e: unknown, statuses: DeviceStatus[]): void => cb(statuses);
    ipcRenderer.on(CH.statusesUpdate, handler);
    return () => ipcRenderer.removeListener(CH.statusesUpdate, handler);
  },
  onAlerts: (cb: (alerts: Alert[]) => void) => {
    const handler = (_e: unknown, alerts: Alert[]): void => cb(alerts);
    ipcRenderer.on(CH.alerts, handler);
    return () => ipcRenderer.removeListener(CH.alerts, handler);
  },
};

contextBridge.exposeInMainWorld("api", api);
