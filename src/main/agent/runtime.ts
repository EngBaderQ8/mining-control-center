import type { ClientMessage, ServerMessage } from "../../shared/protocol";
import type { Device, DeviceStatus } from "../../core/model/device";
import type { ControlCommand } from "../../core/drivers/types";
import type { CommandOutcome } from "../../core/model/result";

export interface ServerConnection {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): void;
}

export interface AgentDeps {
  agentId: string;
  agentName: string;
  conn: ServerConnection;
  listDevices: () => Device[];
  execute: (
    deviceId: string,
    command: ControlCommand,
    params?: Record<string, string>,
  ) => Promise<CommandOutcome>;
}

/**
 * Orchestrates this install's agent behavior over an abstract connection:
 * announces itself, registers the local devices it owns, executes commands the
 * server routes to it, and pushes status updates. Framework-free and testable.
 */
export class AgentRuntime {
  constructor(private deps: AgentDeps) {}

  start(): void {
    this.deps.conn.onMessage((m) => this.onMessage(m));
    this.deps.conn.send({ type: "agent.hello", agentId: this.deps.agentId, name: this.deps.agentName });
    for (const device of this.deps.listDevices())
      this.deps.conn.send({ type: "device.register", device });
  }

  registerDevice(device: Device): void {
    this.deps.conn.send({ type: "device.register", device });
  }

  pushStatuses(statuses: DeviceStatus[]): void {
    this.deps.conn.send({ type: "status.update", statuses });
  }

  private onMessage(m: ServerMessage): void {
    if (m.type !== "command.exec") return;
    void this.deps
      .execute(m.deviceId, m.command, m.params)
      .then((outcome) =>
        this.deps.conn.send({ type: "command.result", commandId: m.commandId, outcome }),
      )
      .catch((e: Error) =>
        this.deps.conn.send({
          type: "command.result",
          commandId: m.commandId,
          outcome: { deviceId: m.deviceId, ok: false, error: e.message },
        }),
      );
  }
}
