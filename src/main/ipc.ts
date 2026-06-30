import { ipcMain } from "electron";
import { CH } from "../shared/api";
import type { ServerBridge } from "./agent/serverBridge";
import type { Device, Site } from "../core/model/device";
import type { ControlCommand } from "../core/drivers/types";

/** Wire request/response IPC channels to the server bridge. */
export function registerIpc(bridge: ServerBridge): void {
  ipcMain.handle(CH.serverSet, (_e, addr: string, fingerprint: string) =>
    bridge.setServer(addr, fingerprint),
  );
  ipcMain.handle(CH.authSignup, async (_e, email: string, password: string) => {
    const r = await bridge.signup(email, password);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  });
  ipcMain.handle(CH.authLogin, async (_e, email: string, password: string) => {
    const r = await bridge.login(email, password);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  });
  ipcMain.handle(CH.authStatus, () => bridge.authStatus());
  ipcMain.handle(CH.authLogout, () => bridge.logout());

  ipcMain.handle(CH.snapshotGet, () => bridge.getSnapshot());
  ipcMain.handle(
    CH.deviceCommand,
    (_e, deviceId: string, command: ControlCommand, params?: Record<string, string>) =>
      bridge.sendCommand(deviceId, command, params),
  );
  ipcMain.handle(CH.deviceBulk, (_e, deviceIds: string[], command: ControlCommand) =>
    bridge.sendBulk(deviceIds, command),
  );
  ipcMain.handle(CH.deviceAdd, (_e, device: Device, secret?: string) => {
    bridge.addDevice(device, secret);
  });
  ipcMain.handle(CH.siteAdd, (_e, site: Site) => {
    bridge.addSite(site);
  });
  ipcMain.handle(CH.deviceScan, (_e, siteName: string, base?: string, secret?: string) =>
    bridge.scanNetwork(siteName, base, secret),
  );
  ipcMain.handle(CH.deviceTest, (_e, ip: string) => bridge.testHost(ip));
  ipcMain.handle(CH.deviceDiagnose, (_e, host: string) => bridge.diagnoseDevice(host));
  ipcMain.handle(CH.localIps, () => bridge.getLocalIps());
  ipcMain.handle(CH.deviceSetSecret, (_e, deviceIds: string[], secret: string) => {
    bridge.setSecrets(deviceIds, secret);
  });
  ipcMain.handle(CH.deviceDelete, (_e, deviceId: string) => {
    bridge.deleteDevice(deviceId);
  });
  ipcMain.handle(CH.siteDelete, (_e, siteId: string) => {
    bridge.deleteSite(siteId);
  });
}
