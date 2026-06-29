import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "node:path";
import { appendFileSync } from "node:fs";
// electron-updater is CommonJS and exposes `autoUpdater` as a NAMED export. A
// default import (`electronUpdater.autoUpdater`) resolves to undefined in the
// packaged app — hence "Cannot read properties of undefined (reading
// 'autoUpdater')". Import the named export directly.
import { autoUpdater as electronAutoUpdater } from "electron-updater";
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
import { getNetworkStats } from "./profit/networkStats";
import { AlertConfig } from "./alerts/config";
import { sendTelegram, detectChatId } from "./alerts/telegram";
import { RecoveryConfig } from "./recovery/config";
import { buildDailyReport } from "../core/report/daily";
import { startBotPoller } from "./alerts/botPoller";
import type { TelegramSettings, RecoverySettings } from "../shared/api";

let mainWindow: BrowserWindow | null = null;
let alertConfig: AlertConfig | null = null;
let recoveryConfig: RecoveryConfig | null = null;
// Set by setupAutoUpdate so the startup check can be deferred until the renderer
// has loaded and subscribed (otherwise its events are emitted into the void).
let triggerUpdateCheck: ((trigger: string) => void) | null = null;
let updateSetupError = "";

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

/** Send to whichever window is currently live (mainWindow is reassigned on activate). */
function sendToWindow(channel: string, payload: unknown): void {
  const w = mainWindow;
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function buildBridge(): ServerBridge {
  const userData = app.getPath("userData");
  const repo = new DeviceRepo(join(userData, "mining.json"));
  const config = new ConnectionConfig(join(userData, "connection.json"));
  alertConfig = new AlertConfig(join(userData, "telegram.json"));
  recoveryConfig = new RecoveryConfig(join(userData, "recovery.json"));
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
    emitSnapshot: (snap) => sendToWindow(CH.snapshotUpdate, snap),
    emitStatuses: (statuses) => sendToWindow(CH.statusesUpdate, statuses),
    emitAlerts: (alerts) => sendToWindow(CH.alerts, alerts),
    notify: (msg) => {
      notifyMessage("تنبيه", msg);
      // Also push to the user's phone via Telegram, if configured.
      const tg = alertConfig?.get();
      if (tg?.enabled && tg.token && tg.chatId) {
        void sendTelegram(tg.token, tg.chatId, `⛏ تنبيه التعدين:\n${msg}`);
      }
    },
  });
}

/**
 * Auto-update from the public releases repo. Downloads new versions in the
 * background and installs + relaunches automatically — so the whole fleet of
 * site laptops stays current without manual re-installs.
 */
function setupAutoUpdate(): void {
  const updater = electronAutoUpdater;
  if (!updater) throw new Error("electron-updater autoUpdater unavailable");
  const current = app.getVersion();
  const send = (s: {
    state: string;
    percent?: number;
    version?: string;
    current?: string;
    error?: string;
  }): void => sendToWindow(CH.updateStatus, { current, ...s });

  // Write every update event to a file so a failure can be diagnosed precisely.
  const logPath = join(app.getPath("userData"), "update.log");
  const ulog = (level: string, msg: unknown): void => {
    try {
      appendFileSync(logPath, `${new Date().toISOString()} [${level}] ${String(msg)}\n`);
    } catch {
      /* ignore */
    }
  };
  updater.logger = {
    info: (m: unknown) => ulog("info", m),
    warn: (m: unknown) => ulog("warn", m),
    error: (m: unknown) => ulog("error", m),
    debug: (m: unknown) => ulog("debug", m),
  };
  ulog("info", `app started v${current}, packaged=${app.isPackaged}`);

  updater.autoDownload = true;
  // Event listeners drive the persistent banner during an actual download.
  updater.on("checking-for-update", () => send({ state: "checking" }));
  updater.on("update-available", (i) => {
    ulog("info", `update-available ${i.version}`);
    send({ state: "available", version: i.version });
  });
  updater.on("update-not-available", () => send({ state: "uptodate", version: current }));
  updater.on("download-progress", (p) =>
    send({ state: "downloading", percent: Math.round(p.percent) }),
  );
  updater.on("error", (e) => {
    ulog("error", `updater error: ${e.message}`);
    send({ state: "error", error: e.message });
  });
  updater.on("update-downloaded", (i) => {
    ulog("info", `update-downloaded ${i.version}`);
    send({ state: "ready", version: i.version });
    // Apply automatically so the whole fleet stays current (brief restart).
    setTimeout(() => updater.quitAndInstall(true, true), 8000);
  });

  // One check path for both startup and the manual button — ALWAYS bounded by a
  // timeout so a silently-hung network request becomes a visible error (red
  // banner + log) instead of "nothing happens".
  const runCheck = async (
    trigger: string,
  ): Promise<{ current: string; latest?: string; available: boolean; error?: string; dev?: boolean }> => {
    if (!app.isPackaged) {
      send({ state: "uptodate", current });
      return { current, available: false, dev: true };
    }
    ulog("info", `check start (${trigger})`);
    send({ state: "checking" });
    // Retry transient network failures (e.g. ERR_CONNECTION_RESET) a few times
    // before surfacing an error — GitHub blips shouldn't read as "update broken".
    const attempt = (): Promise<{ updateInfo?: { version?: string } } | null> =>
      Promise.race([
        updater.checkForUpdates(),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("انتهت المهلة (25ث) — ما قدر يوصل GitHub")), 25000),
        ),
      ]);
    try {
      let r: { updateInfo?: { version?: string } } | null = null;
      let lastErr: Error | null = null;
      for (let i = 1; i <= 3; i++) {
        try {
          r = await attempt();
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e as Error;
          ulog("warn", `check attempt ${i}/3 failed (${trigger}): ${lastErr.message}`);
          if (i < 3) await new Promise((res) => setTimeout(res, 4000));
        }
      }
      if (lastErr) throw lastErr;
      const latest = r?.updateInfo?.version;
      const available = !!latest && latest !== current;
      ulog("info", `check result (${trigger}): current=${current} latest=${latest} available=${available}`);
      if (!available) send({ state: "uptodate", version: latest });
      return { current, latest, available };
    } catch (e) {
      const error = (e as Error).message;
      ulog("error", `check failed (${trigger}): ${error}`);
      send({ state: "error", error });
      return { current, available: false, error };
    }
  };

  ipcMain.handle(CH.updateCheck, () => runCheck("manual"));

  if (!app.isPackaged) return;
  // Defer the startup check until the renderer is ready (see whenReady).
  triggerUpdateCheck = (t: string) => void runCheck(t);
  setInterval(() => void runCheck("interval"), 60 * 60 * 1000); // hourly
}

app.whenReady().then(() => {
  mainWindow = createWindow();
  // Register the version handler FIRST and independently — it must never depend
  // on the bridge or the updater succeeding, so the running build is always known.
  ipcMain.handle(CH.appVersion, () => app.getVersion());
  ipcMain.handle(CH.networkStats, () => getNetworkStats());
  ipcMain.handle(CH.telegramGet, () => alertConfig?.get() ?? { enabled: false, token: "", chatId: "" });
  ipcMain.handle(CH.telegramSet, (_e, s: TelegramSettings) => alertConfig?.set(s));
  ipcMain.handle(CH.telegramTest, (_e, s: TelegramSettings) =>
    sendTelegram(s.token, s.chatId, "✅ اختبار: تنبيهات مركز التحكم بالتعدين تعمل!"),
  );
  ipcMain.handle(CH.telegramDetect, (_e, token: string) => detectChatId(token));

  try {
    const bridge = buildBridge();
    registerIpc(bridge);
    bridge.resume(); // reconnect if already logged in
    // Apply persisted self-healing settings + handlers (needs the live bridge).
    if (recoveryConfig) bridge.setRecovery(recoveryConfig.get());
    ipcMain.handle(CH.recoveryGet, () => recoveryConfig?.get());
    ipcMain.handle(CH.recoverySet, (_e, s: RecoverySettings) => {
      recoveryConfig?.set(s); // clamps bad values
      if (recoveryConfig) bridge.setRecovery(recoveryConfig.get()); // apply the clamped values
    });
    // Daily Telegram fleet summary (when Telegram is configured), plus an
    // on-demand "send now" so the user can preview it.
    const sendDailyReport = async (): Promise<{ ok: boolean; error?: string }> => {
      const tg = alertConfig?.get();
      if (!tg?.enabled || !tg.token || !tg.chatId) return { ok: false, error: "فعّل تيليجرام واحفظ أولاً" };
      const snap = bridge.getSnapshot();
      if (snap.devices.length === 0) return { ok: false, error: "لا توجد أجهزة بعد" };
      const net = await getNetworkStats();
      return sendTelegram(tg.token, tg.chatId, buildDailyReport(snap.devices, snap.statuses, net, Date.now()));
    };
    ipcMain.handle(CH.telegramReport, () => sendDailyReport());
    setInterval(() => void sendDailyReport(), 24 * 60 * 60 * 1000);
    // Two-way Telegram control: text the bot to command the farm from anywhere.
    startBotPoller({
      getSettings: () => alertConfig?.get() ?? { enabled: false, token: "", chatId: "" },
      getSnapshot: () => bridge.getSnapshot(),
      sendCommand: (id, command) => bridge.sendCommand(id, command),
      getNetworkStats: () => getNetworkStats(),
    });
    console.log("[mcc] bridge ready");
  } catch (e) {
    console.error("[mcc] startup failed:", (e as Error).message);
  }
  // Isolate updater setup so a failure here can NEVER break the rest of the app;
  // capture the reason so it can be shown to the user.
  try {
    setupAutoUpdate();
  } catch (e) {
    updateSetupError = (e as Error).message;
    try {
      appendFileSync(
        join(app.getPath("userData"), "update.log"),
        `${new Date().toISOString()} [fatal] setupAutoUpdate threw: ${updateSetupError}\n`,
      );
    } catch {
      /* ignore */
    }
  }
  // Run the startup check only AFTER the renderer has loaded and subscribed, so
  // its checking/up-to-date/error events actually reach the banner.
  mainWindow.webContents.once("did-finish-load", () => {
    if (updateSetupError) {
      sendToWindow(CH.updateStatus, {
        state: "error",
        error: "إعداد التحديث فشل: " + updateSetupError,
        current: app.getVersion(),
      });
    } else if (triggerUpdateCheck) {
      setTimeout(() => triggerUpdateCheck?.("startup"), 1500);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
  });
});

app.on("window-all-closed", () => {
  // Windows/Linux: quit when all windows are closed.
  if (process.platform !== "darwin") app.quit();
});
