import type { Device, Site, DeviceStatus } from "../core/model/device";
import type { ControlCommand } from "../core/drivers/types";
import type { CommandOutcome } from "../core/model/result";

// Agent -> Server
export interface AgentHello {
  type: "agent.hello";
  agentId: string;
  name: string;
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

export type AgentMessage = AgentHello | DeviceRegister | StatusUpdate | CommandResult;
export type ViewerMessage = SnapshotRequest | CommandSend;
export type ClientMessage = AgentMessage | ViewerMessage;
export type ServerMessage = SnapshotMsg | CommandAck | CommandExec | StatusUpdate;

const CLIENT_TYPES = new Set<string>([
  "agent.hello",
  "device.register",
  "status.update",
  "command.result",
  "snapshot.request",
  "command.send",
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
