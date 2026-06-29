import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "./db/schema";
import { DeviceRepo } from "./db/repo";
import { MiningService } from "./service";
import { registerIpc } from "./ipc";
import { notifyAlerts } from "./notify";
import { encryptSecret, decryptSecret } from "./secrets";
import { tcp4028 } from "./transport/tcp";
import { httpRequest } from "./transport/http";
import { CH } from "../shared/api";
import type { Transport } from "../core/drivers/types";

let mainWindow: BrowserWindow | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "Mining Control Center",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env["VITE_DEV_SERVER_URL"];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));

  return win;
}

function buildService(win: BrowserWindow): MiningService {
  const db = new Database(join(app.getPath("userData"), "mining.db"));
  applySchema(db);
  const repo = new DeviceRepo(db);
  const transport: Transport = { tcp4028, http: httpRequest };

  return new MiningService({
    repo,
    transport,
    encrypt: encryptSecret,
    decrypt: decryptSecret,
    emitStatuses: (statuses) => {
      if (!win.isDestroyed()) win.webContents.send(CH.statusesUpdate, statuses);
    },
    emitAlerts: (alerts) => {
      if (!win.isDestroyed()) win.webContents.send(CH.alerts, alerts);
      notifyAlerts(alerts);
    },
    now: () => Date.now(),
  });
}

app.whenReady().then(() => {
  mainWindow = createWindow();
  const service = buildService(mainWindow);
  registerIpc(service);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  // Windows/Linux: quit when all windows are closed.
  if (process.platform !== "darwin") app.quit();
});
