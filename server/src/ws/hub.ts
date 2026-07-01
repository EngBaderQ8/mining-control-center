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
        // Bind agentId to this authenticated user. If the agentId is already owned by a
        // DIFFERENT tenant, refuse — one user must never claim another's agent (which
        // would hijack its router slot and let them answer for its flash jobs).
        if (this.repo.touchAgent(msg.agentId, this.userId, msg.name, msg.version)) {
          this.agentId = msg.agentId;
          this.router.attachAgent(msg.agentId, (exec) => this.send(exec));
        }
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
      case "agentop.result":
        // The owning agent finished a routed site op — resolve the viewer's waiter.
        this.router.resolveAgentOp(msg.opId, { ok: msg.ok, data: msg.data, error: msg.error });
        break;
      case "agentop.send": {
        // Route a management op to the OWNING agent: by explicit agentId (e.g. scanning
        // a brand-new farm) or by the site's owner. Both are verified to belong to THIS
        // user — a viewer can never target another tenant's agent.
        const agentId = msg.agentId
          ? this.repo.agentOwner(msg.agentId) === this.userId
            ? msg.agentId
            : null
          : msg.siteId
            ? this.repo.siteAgent(this.userId, msg.siteId)
            : null;
        if (!agentId) {
          this.send({ type: "agentop.ack", opId: msg.opId, ok: false, error: "no agent to run this op" });
          break;
        }
        try {
          const r = await this.router.routeAgentOp(agentId, {
            type: "agentop.exec",
            opId: msg.opId,
            ...(msg.siteId ? { siteId: msg.siteId } : {}),
            op: msg.op,
            ...(msg.params ? { params: msg.params } : {}),
          });
          this.send({ type: "agentop.ack", opId: msg.opId, ok: r.ok, ...(r.data ? { data: r.data } : {}), ...(r.error ? { error: r.error } : {}) });
        } catch (e) {
          this.send({ type: "agentop.ack", opId: msg.opId, ok: false, error: (e as Error).message });
        }
        break;
      }
      case "flash.progress": {
        // Authoritative tenant boundary is the JWT-derived userId (agentId is
        // client-asserted/spoofable); also require the report to be for the exact
        // device the server dispatched to this job.
        const job = this.repo.getFlashJobForUser(this.userId, msg.jobId);
        if (job && job.agentId === this.agentId && job.deviceId === msg.deviceId)
          this.flashSequencer.onProgress(msg.jobId, msg.phase);
        break;
      }
      case "flash.result": {
        const job = this.repo.getFlashJobForUser(this.userId, msg.jobId);
        if (job && job.agentId === this.agentId && job.deviceId === msg.deviceId)
          this.flashSequencer.onResult(msg.jobId, msg.state, msg.newVersion, msg.error);
        break;
      }
      case "snapshot.request":
        this.send(this.snapshot());
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

  /** Build this user's full snapshot, including their farm laptops (agents) + live
   *  online state, so a viewer can target a remote scan at a specific farm. */
  private snapshot(): ServerMessage {
    return {
      type: "snapshot",
      sites: this.repo.listSites(this.userId),
      devices: this.repo.listDevices(this.userId),
      statuses: this.repo.listStatuses(this.userId),
      agents: this.repo
        .listUserAgents(this.userId)
        .map((a) => ({ id: a.id, name: a.name, online: this.router.isAgentOnline(a.id) })),
    };
  }

  /** Push a fresh full snapshot to every socket of this user (after a structural change). */
  private broadcastSnapshot(): void {
    this.broadcast(this.userId, this.snapshot());
  }

  onClose(): void {
    if (this.agentId) this.router.detachAgent(this.agentId);
  }
}
