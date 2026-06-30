import type { Device, DeviceStatus, Site } from "../core/model/device";
import type { CommandOutcome } from "../core/model/result";
import type { ControlCommand } from "../core/drivers/types";
import type { Alert } from "../core/alerts/rules";
import type { Snapshot } from "../main/service";

export type { Device, DeviceStatus, Site, CommandOutcome, ControlCommand, Alert, Snapshot };

// The central server is a fixed deployment detail — site staff never type it.
// The app fills it automatically and only asks for email + password. Change this
// (and republish) if the server ever moves.
export const DEFAULT_SERVER_ADDR = "144.172.105.191:8443";

// Developer/operator contact, shown in the About menu/dialog.
export const CONTACT = {
  telegram: "Darkhorsee_1",
  telegramUrl: "https://t.me/Darkhorsee_1",
  whatsapp: "+971582682099",
  whatsappUrl: "https://wa.me/971582682099",
} as const;

export interface AuthResponse {
  ok: boolean;
  error?: string;
}

export interface AuthStatusResponse {
  hasServer: boolean;
  loggedIn: boolean;
  connected: boolean;
  serverAddr?: string;
}

export interface TelegramSettings {
  enabled: boolean;
  token: string;
  chatId: string;
}

export interface RecoverySettings {
  enabled: boolean;
  rebootOfflineMin: number;
  overheatStopC: number;
  cooldownMin: number;
}

/** Desktop-behavior settings (Windows startup + background/tray). */
export interface AppSettings {
  launchAtStartup: boolean; // register the app to start with Windows
  // When on, closing the ✕ hides to the tray and keeps monitoring; when off, ✕
  // quits the app. One flag governs both the close behavior and staying alive.
  runInBackground: boolean;
  startMinimized: boolean; // when launched at startup, start hidden in the tray
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  launchAtStartup: false,
  runInBackground: true,
  startMinimized: true,
};

export interface UpdateStatus {
  state: "checking" | "available" | "downloading" | "ready" | "none" | "error" | "uptodate";
  percent?: number;
  version?: string; // the available/target version
  current?: string; // the running version
  error?: string;
}

export interface UpdateCheckResult {
  current: string;
  latest?: string;
  available: boolean;
  error?: string;
  dev?: boolean;
}

/** IPC channel names shared between main, preload, and renderer. */
export const CH = {
  // auth / server
  authSignup: "auth:signup",
  authLogin: "auth:login",
  authStatus: "auth:status",
  authLogout: "auth:logout",
  serverSet: "server:set",
  // data
  snapshotGet: "snapshot:get",
  deviceCommand: "device:command",
  deviceBulk: "device:bulk",
  deviceAdd: "device:add",
  deviceScan: "device:scan",
  deviceTest: "device:test",
  deviceDiagnose: "device:diagnose",
  localIps: "device:localips",
  deviceSetSecret: "device:setsecret",
  deviceDelete: "device:delete",
  siteAdd: "site:add",
  siteDelete: "site:delete",
  // profit / network
  networkStats: "profit:netstats",
  // telegram alerts
  telegramGet: "tg:get",
  telegramSet: "tg:set",
  telegramTest: "tg:test",
  telegramDetect: "tg:detect",
  telegramReport: "tg:report",
  // self-healing
  recoveryGet: "recovery:get",
  recoverySet: "recovery:set",
  // desktop behavior (startup + tray)
  appSettingsGet: "appsettings:get",
  appSettingsSet: "appsettings:set",
  openSettings: "settings:open", // main -> renderer: File ▸ Settings menu clicked
  openAbout: "about:open", // main -> renderer: About menu clicked
  openExternal: "shell:openexternal", // renderer -> main: open a URL in the browser
  // updates
  updateCheck: "update:check",
  appVersion: "app:version",
  // push (main -> renderer)
  snapshotUpdate: "snapshot:update",
  statusesUpdate: "statuses:update",
  alerts: "alerts",
  updateStatus: "update:status",
} as const;

/** The typed surface exposed on `window.api` by the preload bridge. */
export interface Api {
  // auth / server
  setServer(addr: string, fingerprint: string): Promise<void>;
  signup(email: string, password: string): Promise<AuthResponse>;
  login(email: string, password: string): Promise<AuthResponse>;
  authStatus(): Promise<AuthStatusResponse>;
  logout(): Promise<void>;
  // data
  getSnapshot(): Promise<Snapshot>;
  sendCommand(
    deviceId: string,
    command: ControlCommand,
    params?: Record<string, string>,
  ): Promise<CommandOutcome>;
  sendBulk(deviceIds: string[], command: ControlCommand): Promise<CommandOutcome[]>;
  addDevice(device: Device, secret?: string): Promise<void>;
  addSite(site: Site): Promise<void>;
  deleteDevice(deviceId: string): Promise<void>;
  deleteSite(siteId: string): Promise<void>;
  setCredentials(deviceIds: string[], secret: string): Promise<void>;
  scanNetwork(
    siteName: string,
    base?: string,
    secret?: string,
  ): Promise<{
    found: number;
    reachable: boolean;
    bases: string[];
    connected: number;
    responded: number;
  }>;
  testHost(ip: string): Promise<{
    connected: boolean;
    gotData: boolean;
    sample: string;
    firmware: string | null;
    state: string;
    hashrateTHs: number;
    maxTempC: number;
    summarySample: string;
    boardsFound: number;
    statsChainSample: string;
    error?: string;
  }>;
  getLocalIps(): Promise<string[]>;
  diagnoseDevice(host: string): Promise<{
    reachable: boolean;
    error?: string;
    boards: Array<{ board: number; chips: number; rateGhs: number; hwErrors: number }>;
    fans: number[];
    temps: number[];
    issues: Array<{ code: string; severity: "warn" | "high"; values: Record<string, number> }>;
  }>;
  getNetworkStats(): Promise<{ priceUsd: number; difficulty: number; blockRewardBtc: number }>;
  // telegram alerts
  getTelegram(): Promise<TelegramSettings>;
  setTelegram(s: TelegramSettings): Promise<void>;
  testTelegram(s: TelegramSettings): Promise<{ ok: boolean; error?: string }>;
  detectChatId(token: string): Promise<{ chatId?: string; error?: string }>;
  sendDailyReport(): Promise<{ ok: boolean; error?: string }>;
  // self-healing
  getRecovery(): Promise<RecoverySettings>;
  setRecovery(s: RecoverySettings): Promise<void>;
  // desktop behavior (startup + tray)
  getAppSettings(): Promise<AppSettings>;
  setAppSettings(s: Partial<AppSettings>): Promise<AppSettings>;
  // updates
  checkUpdate(): Promise<UpdateCheckResult>;
  getVersion(): Promise<string>;
  // subscriptions (return an unsubscribe function)
  onSnapshot(cb: (snap: Snapshot) => void): () => void;
  onStatuses(cb: (statuses: DeviceStatus[]) => void): () => void;
  onAlerts(cb: (alerts: Alert[]) => void): () => void;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
  onOpenSettings(cb: () => void): () => void;
  onOpenAbout(cb: () => void): () => void;
  openExternal(url: string): Promise<void>;
}
