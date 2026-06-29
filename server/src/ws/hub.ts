import type { ServerRepo } from "../db/repo";
import type { CommandRouter } from "../router/commandRouter";
import type { ClientMessage, ServerMessage } from "../protocol/messages";

type Send = (m: ServerMessage) => void;
type Broadcast = (userId: string, m: ServerMessage) => void;

/**
 * Applies an authenticated client's messages to the repo/router/broadcast.
 * Transport-free: `send` writes to this socket, `broadcast` fans out to the
 * user's other sockets. Fully unit-tested with fakes.
 */
export class ConnectionHub {
  private agentId: string | null = null;

  constructor(
    private userId: string,
    private send: Send,
    private repo: ServerRepo,
    private router: CommandRouter,
    private broadcast: Broadcast,
  ) {}

  async handleMessage(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "agent.hello":
        this.agentId = msg.agentId;
        this.repo.touchAgent(msg.agentId, this.userId, msg.name);
        this.router.attachAgent(msg.agentId, (exec) => this.send(exec));
        break;
      case "site.register":
        this.repo.upsertSite({ ...msg.site, userId: this.userId });
        break;
      case "device.register":
        this.repo.upsertDevice({
          ...msg.device,
          userId: this.userId,
          agentId: this.agentId ?? "",
        });
        break;
      case "status.update":
        for (const s of msg.statuses) this.repo.upsertStatus(this.userId, s);
        this.broadcast(this.userId, { type: "status.update", statuses: msg.statuses });
        break;
      case "command.result":
        this.router.resolveResult(msg.commandId, msg.outcome);
        break;
      case "snapshot.request":
        this.send({
          type: "snapshot",
          sites: this.repo.listSites(this.userId),
          devices: this.repo.listDevices(this.userId),
          statuses: this.repo.listStatuses(this.userId),
        });
        break;
      case "device.delete":
        this.repo.deleteDevice(this.userId, msg.deviceId);
        this.broadcastSnapshot();
        break;
      case "site.delete":
        this.repo.deleteSite(this.userId, msg.siteId);
        this.broadcastSnapshot();
        break;
      case "command.send": {
        const agentId = this.repo.deviceAgent(this.userId, msg.deviceId);
        if (!agentId) {
          this.send({
            type: "command.ack",
            commandId: msg.commandId,
            outcome: { deviceId: msg.deviceId, ok: false, error: "unknown device" },
          });
          break;
        }
        try {
          const outcome = await this.router.routeCommand(agentId, {
            type: "command.exec",
            commandId: msg.commandId,
            deviceId: msg.deviceId,
            command: msg.command,
            params: msg.params,
          });
          this.send({ type: "command.ack", commandId: msg.commandId, outcome });
        } catch (e) {
          this.send({
            type: "command.ack",
            commandId: msg.commandId,
            outcome: { deviceId: msg.deviceId, ok: false, error: (e as Error).message },
          });
        }
        break;
      }
    }
  }

  /** Push a fresh full snapshot to every socket of this user (after a structural change). */
  private broadcastSnapshot(): void {
    this.broadcast(this.userId, {
      type: "snapshot",
      sites: this.repo.listSites(this.userId),
      devices: this.repo.listDevices(this.userId),
      statuses: this.repo.listStatuses(this.userId),
    });
  }

  onClose(): void {
    if (this.agentId) this.router.detachAgent(this.agentId);
  }
}
