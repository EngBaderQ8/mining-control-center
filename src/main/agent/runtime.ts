import type { ClientMessage, ServerMessage } from "../../shared/protocol";
import type { Device, DeviceStatus, Site } from "../../core/model/device";
import type { ControlCommand } from "../../core/drivers/types";
import type { CommandOutcome } from "../../core/model/result";

export interface ServerConnection {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): void;
}

export interface AgentDeps {
  agentId: string;
  agentName: string;
  appVersion?: string;
  conn: ServerConnection;
  listDevices: () => Device[];
  listSites?: () => Site[];
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

  /** Subscribe once (for the lifetime of the connection object) then announce. */
  start(): void {
    this.deps.conn.onMessage((m) => this.onMessage(m));
    this.announce();
  }

  /** (Re)send hello + the local sites/devices. Safe to call again after a
   *  reconnect WITHOUT re-subscribing the message handler. */
  announce(): void {
    this.deps.conn.send({
      type: "agent.hello",
      agentId: this.deps.agentId,
      name: this.deps.agentName,
      ...(this.deps.appVersion ? { version: this.deps.appVersion } : {}),
    });
    for (const site of this.deps.listSites?.() ?? [])
      this.deps.conn.send({ type: "site.register", site });
    for (const device of this.deps.listDevices())
      this.deps.conn.send({ type: "device.register", device });
  }

  registerSite(site: Site): void {
    this.deps.conn.send({ type: "site.register", site });
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
