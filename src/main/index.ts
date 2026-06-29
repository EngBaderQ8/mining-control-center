import { app, BrowserWindow } from "electron";
import { join } from "node:path";
import { DeviceRepo } from "./db/repo";
import { registerIpc } from "./ipc";
import { notifyMessage } from "./notify";
import { encryptSecret, decryptSecret } from "./secrets";
import { tcp4028 } from "./transport/tcp";
import { httpRequest } from "./transport/http";
import { CH } from "../shared/api";
import type { Transport } from "../core/drivers/types";
import { ConnectionConfig } from "./agent/config";
import { ServerBridge } from "./agent/serverBridge";

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

  win.webContents.on("did-finish-load", () => console.log("[mcc] renderer loaded"));
  win.webContents.on("did-fail-load", (_e, code, desc) =>
    console.error(`[mcc] renderer failed to load: ${code} ${desc}`),
  );
  // Diagnostic: surface renderer console + crashes into the main-process log.
  win.webContents.on("console-message", (...args: unknown[]) => {
    const d = args[0];
    const text =
      d && typeof d === "object" && "message" in d
        ? (d as { message: string }).message
        : args[2];
    console.log(`[renderer-console] ${String(text)}`);
  });
  win.webContents.on("render-process-gone", (_e, details) =>
    console.error(`[renderer gone] ${JSON.stringify(details)}`),
  );

  const devUrl = process.env["VITE_DEV_SERVER_URL"];
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(__dirname, "../renderer/index.html"));

  return win;
}

function buildBridge(win: BrowserWindow): ServerBridge {
  const userData = app.getPath("userData");
  const repo = new DeviceRepo(join(userData, "mining.json"));
  const config = new ConnectionConfig(join(userData, "connection.json"));
  const transport: Transport = { tcp4028, http: httpRequest };
  // Short-timeout transport for fast LAN scanning (don't wait 5s per dead host).
  const scanTransport: Transport = {
    tcp4028: (h, p, c) => tcp4028(h, p, c, 1200),
    http: httpRequest,
  };

  return new ServerBridge({
    config,
    repo,
    transport,
    scanTransport,
    encrypt: encryptSecret,
    decrypt: decryptSecret,
    emitSnapshot: (snap) => {
      if (!win.isDestroyed()) win.webContents.send(CH.snapshotUpdate, snap);
    },
    emitStatuses: (statuses) => {
      if (!win.isDestroyed()) win.webContents.send(CH.statusesUpdate, statuses);
    },
    notify: (msg) => {
      notifyMessage("تنبيه", msg);
    },
  });
}

app.whenReady().then(() => {
  mainWindow = createWindow();
  try {
    const bridge = buildBridge(mainWindow);
    registerIpc(bridge);
    bridge.resume(); // reconnect if already logged in
    console.log("[mcc] bridge ready");
  } catch (e) {
    console.error("[mcc] startup failed:", (e as Error).message);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  // Windows/Linux: quit when all windows are closed.
  if (process.platform !== "darwin") app.quit();
});
