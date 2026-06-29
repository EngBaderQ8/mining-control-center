import { randomUUID } from "node:crypto";
import type { Device, Site, DeviceStatus } from "../../core/model/device";
import type { ControlCommand, Transport } from "../../core/drivers/types";
import type { CommandOutcome } from "../../core/model/result";
import type { ServerMessage } from "../../shared/protocol";
import { MiningService, type Snapshot } from "../service";
import type { DeviceRepo } from "../db/repo";
import { ConnectionConfig } from "./config";
import { ServerClient, type AuthResult } from "./serverClient";
import { AgentRuntime } from "./runtime";
import { scanHosts, subnetHosts } from "../../core/discovery/scan";
import { localIpv4 } from "../discovery/localSubnet";

export interface BridgeDeps {
  config: ConnectionConfig;
  repo: DeviceRepo;
  transport: Transport;
  /** Same as transport but with a short timeout, used for fast network scanning. */
  scanTransport: Transport;
  encrypt: (plain: string) => Buffer;
  decrypt: (enc: Buffer) => string;
  emitSnapshot: (snap: Snapshot) => void;
  emitStatuses: (statuses: DeviceStatus[]) => void;
  notify: (msg: string) => void;
}

export interface AuthStatus {
  hasServer: boolean;
  loggedIn: boolean;
  connected: boolean;
  serverAddr?: string;
}

/**
 * Bridges this install's local mining engine with the central server: it acts as
 * an agent for local devices (registers them, pushes status, executes routed
 * commands) and as a viewer (caches the all-account snapshot and forwards live
 * updates + command results to the renderer).
 */
export class ServerBridge {
  private client: ServerClient;
  private service: MiningService;
  private agent: AgentRuntime | null = null;
  private connected = false;
  private snapshot: Snapshot = { sites: [], devices: [], statuses: [] };
  private pending = new Map<string, (o: CommandOutcome) => void>();

  constructor(private deps: BridgeDeps) {
    this.client = new ServerClient(deps.config);
    this.service = new MiningService({
      repo: deps.repo,
      transport: deps.transport,
      encrypt: deps.encrypt,
      decrypt: deps.decrypt,
      emitStatuses: (statuses) => this.agent?.pushStatuses(statuses),
      emitAlerts: (alerts) => {
        for (const a of alerts) this.deps.notify(a.message);
      },
      now: () => Date.now(),
    });

    // Viewer feed: cache server snapshot/updates and forward to the renderer.
    this.client.onMessage((m) => this.onServerMessage(m));
    this.client.onState((c) => {
      this.connected = c;
      if (c) this.onConnected();
    });
  }

  authStatus(): AuthStatus {
    const s = this.deps.config.get();
    return {
      hasServer: !!s.serverAddr,
      loggedIn: !!s.token,
      connected: this.connected,
      ...(s.serverAddr !== undefined ? { serverAddr: s.serverAddr } : {}),
    };
  }

  setServer(addr: string, fingerprint: string): void {
    this.deps.config.setServer(addr, fingerprint);
  }

  async signup(email: string, password: string): Promise<AuthResult> {
    const r = await this.client.signup(email, password);
    if (r.ok) {
      this.deps.config.setToken(r.token);
      this.client.connect(r.token);
    }
    return r;
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const r = await this.client.login(email, password);
    if (r.ok) {
      this.deps.config.setToken(r.token);
      this.client.connect(r.token);
    }
    return r;
  }

  /** Reconnect using a stored token (called on startup if already logged in). */
  resume(): void {
    const token = this.deps.config.get().token;
    if (token) this.client.connect(token);
  }

  logout(): void {
    this.client.disconnect();
    this.deps.config.clearToken();
    this.connected = false;
  }

  getSnapshot(): Snapshot {
    return this.snapshot;
  }

  addSite(site: Site): void {
    this.deps.repo.upsertSite(site);
    this.agent?.registerSite(site);
  }

  addDevice(device: Device, secret?: string): void {
    this.service.addDevice(device, secret);
    this.agent?.registerDevice(device);
  }

  /**
   * Scan the local network for ASICs and auto-register everything found under a
   * new site. Runs on the agent (the machine on the miners' LAN). Returns how
   * many were found. Discovered devices get default stock creds (root:root) —
   * monitoring works immediately; control may need real creds for modded firmware.
   */
  async scanNetwork(siteName: string): Promise<{ found: number; reachable: boolean }> {
    const ip = localIpv4();
    if (!ip) return { found: 0, reachable: false };
    const hosts = subnetHosts(ip);
    const found = await scanHosts(hosts, 4028, this.deps.scanTransport, 32);
    if (found.length === 0) return { found: 0, reachable: true };

    const siteId = randomUUID();
    this.addSite({ id: siteId, name: siteName });
    for (const d of found) {
      const last = d.host.split(".").pop() ?? "";
      const controlPort = d.firmware === "stock" || d.firmware === "vnish" ? 80 : 4028;
      this.addDevice(
        {
          id: randomUUID(),
          siteId,
          name: `${d.model}-${last}`,
          model: d.model,
          firmware: d.firmware,
          host: d.host,
          apiPort: 4028,
          controlPort,
        },
        "root:root",
      );
    }
    return { found: found.length, reachable: true };
  }

  async sendCommand(
    deviceId: string,
    command: ControlCommand,
    params?: Record<string, string>,
  ): Promise<CommandOutcome> {
    if (!this.connected) return { deviceId, ok: false, error: "غير متصل بالخادم" };
    const commandId = randomUUID();
    return new Promise<CommandOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve({ deviceId, ok: false, error: "انتهت المهلة" });
      }, 20000);
      this.pending.set(commandId, (o) => {
        clearTimeout(timer);
        resolve(o);
      });
      this.client.send({ type: "command.send", commandId, deviceId, command, ...(params ? { params } : {}) });
    });
  }

  async sendBulk(
    deviceIds: string[],
    command: ControlCommand,
    params?: Record<string, string>,
  ): Promise<CommandOutcome[]> {
    return Promise.all(deviceIds.map((id) => this.sendCommand(id, command, params)));
  }

  private onConnected(): void {
    // (Re)build the agent runtime over the live connection and announce ourselves.
    const s = this.deps.config.get();
    this.agent = new AgentRuntime({
      agentId: s.agentId,
      agentName: s.agentName,
      conn: this.client,
      listSites: () => this.deps.repo.listSites(),
      listDevices: () => this.deps.repo.listDevices(),
      execute: (deviceId, command, params) => this.service.sendCommand(deviceId, command, params),
    });
    this.agent.start();
    this.client.send({ type: "snapshot.request" });
    this.service.startMonitoring(); // poll local devices -> pushStatuses to server
  }

  private onServerMessage(m: ServerMessage): void {
    switch (m.type) {
      case "snapshot":
        this.snapshot = { sites: m.sites, devices: m.devices, statuses: m.statuses };
        this.deps.emitSnapshot(this.snapshot);
        break;
      case "status.update": {
        const byId = new Map(this.snapshot.statuses.map((x) => [x.deviceId, x]));
        for (const st of m.statuses) byId.set(st.deviceId, st);
        this.snapshot = { ...this.snapshot, statuses: [...byId.values()] };
        this.deps.emitStatuses(m.statuses);
        break;
      }
      case "command.ack": {
        const resolve = this.pending.get(m.commandId);
        if (resolve) {
          this.pending.delete(m.commandId);
          resolve(m.outcome);
        }
        break;
      }
      case "command.exec":
        // handled by AgentRuntime's own subscriber
        break;
    }
  }
}
