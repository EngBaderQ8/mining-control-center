import { ipcMain } from "electron";
import { CH } from "../shared/api";
import type { MiningService } from "./service";
import type { Device, Site } from "../core/model/device";
import type { ControlCommand } from "../core/drivers/types";

/** Wire request/response IPC channels to the service. */
export function registerIpc(service: MiningService): void {
  ipcMain.handle(CH.snapshotGet, () => service.getSnapshot());
  ipcMain.handle(CH.monitorStart, () => service.startMonitoring());
  ipcMain.handle(CH.monitorStop, () => service.stopMonitoring());
  ipcMain.handle(CH.deviceCommand, (_e, deviceId: string, command: ControlCommand) =>
    service.sendCommand(deviceId, command),
  );
  ipcMain.handle(CH.deviceBulk, (_e, deviceIds: string[], command: ControlCommand) =>
    service.sendBulk(deviceIds, command),
  );
  ipcMain.handle(CH.deviceAdd, (_e, device: Device, secret?: string) => {
    service.addDevice(device, secret);
  });
  ipcMain.handle(CH.deviceDelete, (_e, id: string) => {
    service.deleteDevice(id);
  });
  ipcMain.handle(CH.siteAdd, (_e, site: Site) => {
    service.addSite(site);
  });
}
