import type { Device, Site, DeviceStatus } from "../core/model/device";
import type { ControlCommand } from "../core/drivers/types";
import type { CommandOutcome } from "../core/model/result";

// Agent -> Server
export interface AgentHello {
  type: "agent.hello";
  agentId: string;
  name: string;
  version?: string; // the running app version (for the admin fleet/version view)
}
export interface SiteRegister {
  type: "site.register";
  site: Site;
}
export interface DeviceRegister {
  type: "device.register";
  device: Device;
}
export interface StatusUpdate {
  type: "status.update";
  statuses: DeviceStatus[];
}
export interface CommandResult {
  type: "command.result";
  commandId: string;
  outcome: CommandOutcome;
}

// Viewer -> Server
export interface SnapshotRequest {
  type: "snapshot.request";
}
export interface CommandSend {
  type: "command.send";
  commandId: string;
  deviceId: string;
  command: ControlCommand;
  params?: Record<string, string>;
}
export interface DeviceDelete {
  type: "device.delete";
  deviceId: string;
}
export interface SiteDelete {
  type: "site.delete";
  siteId: string;
}
// Rename a site. Sent viewer->server (rename from any laptop, even one that doesn't
// own the site locally); the server updates its DB, broadcasts a fresh snapshot to
// viewers, AND fans this same message out so the OWNING agent updates its local repo
// (otherwise the agent would re-register the old name on its next reconnect).
export interface SiteRename {
  type: "site.rename";
  siteId: string;
  name: string;
}

// Server -> Viewer
export interface SnapshotMsg {
  type: "snapshot";
  sites: Site[];
  devices: Device[];
  statuses: DeviceStatus[];
}
export interface CommandAck {
  type: "command.ack";
  commandId: string;
  outcome: CommandOutcome;
}

// Server -> Agent
export interface CommandExec {
  type: "command.exec";
  commandId: string;
  deviceId: string;
  command: ControlCommand;
  params?: Record<string, string>;
}

// Server -> client: check for an app update right now (admin-triggered rollout).
export interface UpdateNow {
  type: "update.now";
}

export type AgentMessage =
  | AgentHello
  | SiteRegister
  | DeviceRegister
  | StatusUpdate
  | CommandResult;
export type ViewerMessage = SnapshotRequest | CommandSend | DeviceDelete | SiteDelete | SiteRename;
export type ClientMessage = AgentMessage | ViewerMessage;
export type ServerMessage =
  | SnapshotMsg
  | CommandAck
  | CommandExec
  | StatusUpdate
  | UpdateNow
  | SiteRename;

const CLIENT_TYPES = new Set<string>([
  "agent.hello",
  "site.register",
  "device.register",
  "status.update",
  "command.result",
  "snapshot.request",
  "command.send",
  "device.delete",
  "site.delete",
  "site.rename",
]);

export function isClientMessage(v: unknown): v is ClientMessage {
  return (
    !!v &&
    typeof v === "object" &&
    "type" in v &&
    typeof (v as { type: unknown }).type === "string" &&
    CLIENT_TYPES.has((v as { type: string }).type)
  );
}
