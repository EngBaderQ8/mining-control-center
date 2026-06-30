import type { ServerRepo } from "../db/repo";
import type { CommandRouter } from "../router/commandRouter";
import type { FlashSequencer } from "../firmware/sequencer";
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
    private flashSequencer: FlashSequencer,
  ) {}

  async handleMessage(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "agent.hello":
        this.agentId = msg.agentId;
        this.repo.touchAgent(msg.agentId, this.userId, msg.name, msg.version);
        this.router.attachAgent(msg.agentId, (exec) => this.send(exec));
        break;
      case "site.register":
        // Push a live snapshot to the user's viewers when a NEW/renamed site
        // arrives, so it appears without restarting the app. Identical
        // re-registers (every agent reconnect) report no change → no broadcast.
        if (this.repo.upsertSite({ ...msg.site, userId: this.userId })) this.broadcastSnapshot();
        break;
      case "device.register":
        if (
          this.repo.upsertDevice({
            ...msg.device,
            userId: this.userId,
            agentId: this.agentId ?? "",
          })
        )
          this.broadcastSnapshot();
        break;
      case "status.update": {
        // Only accept status for devices that actually belong to this user —
        // an agent must not be able to write/overwrite another user's device.
        const owned = msg.statuses.filter((s) => this.repo.deviceAgent(this.userId, s.deviceId));
        for (const s of owned) this.repo.upsertStatus(this.userId, s);
        if (owned.length) this.broadcast(this.userId, { type: "status.update", statuses: owned });
        break;
      }
      case "command.result":
        this.router.resolveResult(msg.commandId, msg.outcome);
        break;
      case "flash.progress": {
        // Only the agent that OWNS the job may report on it (no cross-agent spoofing).
        const job = this.repo.getFlashJob(msg.jobId);
        if (job && job.agentId === this.agentId) this.flashSequencer.onProgress(msg.jobId, msg.phase);
        break;
      }
      case "flash.result": {
        const job = this.repo.getFlashJob(msg.jobId);
        if (job && job.agentId === this.agentId)
          this.flashSequencer.onResult(msg.jobId, msg.state, msg.newVersion, msg.error);
        break;
      }
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
      case "site.rename": {
        const name = msg.name.trim();
        const site = this.repo.listSites(this.userId).find((s) => s.id === msg.siteId);
        if (name && site && this.repo.upsertSite({ id: msg.siteId, name, userId: this.userId })) {
          // Push the rename to ALL the user's sockets so the owning agent updates its
          // local repo (and re-registers the new name), then refresh viewers.
          this.broadcast(this.userId, { type: "site.rename", siteId: msg.siteId, name });
          this.broadcastSnapshot();
        }
        break;
      }
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
