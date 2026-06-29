import { contextBridge, ipcRenderer } from "electron";
import { CH, type Api, type Snapshot } from "../shared/api";
import type { DeviceStatus, Device, Site } from "../core/model/device";
import type { ControlCommand } from "../core/drivers/types";
import type { Alert } from "../core/alerts/rules";

const api: Api = {
  setServer: (addr: string, fingerprint: string) => ipcRenderer.invoke(CH.serverSet, addr, fingerprint),
  signup: (email: string, password: string) => ipcRenderer.invoke(CH.authSignup, email, password),
  login: (email: string, password: string) => ipcRenderer.invoke(CH.authLogin, email, password),
  authStatus: () => ipcRenderer.invoke(CH.authStatus),
  logout: () => ipcRenderer.invoke(CH.authLogout),

  getSnapshot: () => ipcRenderer.invoke(CH.snapshotGet),
  sendCommand: (deviceId: string, command: ControlCommand, params?: Record<string, string>) =>
    ipcRenderer.invoke(CH.deviceCommand, deviceId, command, params),
  sendBulk: (deviceIds: string[], command: ControlCommand) =>
    ipcRenderer.invoke(CH.deviceBulk, deviceIds, command),
  addDevice: (device: Device, secret?: string) => ipcRenderer.invoke(CH.deviceAdd, device, secret),
  addSite: (site: Site) => ipcRenderer.invoke(CH.siteAdd, site),
  scanNetwork: (siteName: string) => ipcRenderer.invoke(CH.deviceScan, siteName),

  onSnapshot: (cb: (snap: Snapshot) => void) => {
    const handler = (_e: unknown, snap: Snapshot): void => cb(snap);
    ipcRenderer.on(CH.snapshotUpdate, handler);
    return () => ipcRenderer.removeListener(CH.snapshotUpdate, handler);
  },
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
