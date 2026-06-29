import type { Device, DeviceStatus, Site } from "../core/model/device";
import type { CommandOutcome } from "../core/model/result";
import type { ControlCommand } from "../core/drivers/types";
import type { Alert } from "../core/alerts/rules";
import type { Snapshot } from "../main/service";

export type { Device, DeviceStatus, Site, CommandOutcome, ControlCommand, Alert, Snapshot };

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
    error?: string;
  }>;
  getLocalIps(): Promise<string[]>;
  getNetworkStats(): Promise<{ priceUsd: number; difficulty: number; blockRewardBtc: number }>;
  // telegram alerts
  getTelegram(): Promise<TelegramSettings>;
  setTelegram(s: TelegramSettings): Promise<void>;
  testTelegram(s: TelegramSettings): Promise<{ ok: boolean; error?: string }>;
  detectChatId(token: string): Promise<{ chatId?: string; error?: string }>;
  // updates
  checkUpdate(): Promise<UpdateCheckResult>;
  getVersion(): Promise<string>;
  // subscriptions (return an unsubscribe function)
  onSnapshot(cb: (snap: Snapshot) => void): () => void;
  onStatuses(cb: (statuses: DeviceStatus[]) => void): () => void;
  onAlerts(cb: (alerts: Alert[]) => void): () => void;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
}
