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
  siteAdd: "site:add",
  // push (main -> renderer)
  snapshotUpdate: "snapshot:update",
  statusesUpdate: "statuses:update",
  alerts: "alerts",
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
  sendCommand(deviceId: string, command: ControlCommand): Promise<CommandOutcome>;
  sendBulk(deviceIds: string[], command: ControlCommand): Promise<CommandOutcome[]>;
  addDevice(device: Device, secret?: string): Promise<void>;
  addSite(site: Site): Promise<void>;
  // subscriptions (return an unsubscribe function)
  onSnapshot(cb: (snap: Snapshot) => void): () => void;
  onStatuses(cb: (statuses: DeviceStatus[]) => void): () => void;
  onAlerts(cb: (alerts: Alert[]) => void): () => void;
}
