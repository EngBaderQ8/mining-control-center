import { randomUUID } from "node:crypto";
import type { Device, Site, DeviceStatus } from "../../core/model/device";
import type { ControlCommand, Transport } from "../../core/drivers/types";
import type { CommandOutcome } from "../../core/model/result";
import type { Alert } from "../../core/alerts/rules";
import type { ServerMessage } from "../../shared/protocol";
import { MiningService, type Snapshot } from "../service";
import type { DeviceRepo } from "../db/repo";
import { ConnectionConfig } from "./config";
import { ServerClient, type AuthResult } from "./serverClient";
import { AgentRuntime } from "./runtime";
import { subnetHosts, type DiscoveredDevice } from "../../core/discovery/scan";
import { detectFromVersion } from "../../core/discovery/detect";
import { pollDevice } from "../../core/monitor/poller";
import { parseDeviceHealth, type DeviceHealth } from "../../core/diagnose/parse";
import { localPrivateBases, localIpv4s } from "../discovery/localSubnet";
import { diagnoseHost } from "../transport/tcp";

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
  emitAlerts: (alerts: Alert[]) => void;
  notify: (msg: string) => void;
  appVersion?: string; // reported to the server (admin version view)
  onUpdateNow?: () => void; // server asked this client to update now (GitHub channel)
  checkServerUpdate?: (serverBase: string) => void; // owner's self-hosted update channel
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
      emitStatuses: (statuses) => {
        // Always show locally-polled status in the renderer (even before/without a
        // server connection); also push to the server when connected.
        if (this.connected) this.agent?.pushStatuses(statuses);
        this.deps.emitStatuses(statuses);
      },
      emitAlerts: (alerts) => {
        this.deps.emitAlerts(alerts); // -> renderer toast (CH.alerts)
        for (const a of alerts) this.deps.notify(a.message); // -> OS notification + Telegram
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
    this.service.stopMonitoring(); // tear down the poll timer
    this.client.disconnect();
    this.deps.config.clearToken();
    this.connected = false;
  }

  getSnapshot(): Snapshot {
    return this.snapshot;
  }

  /** Ask the server for a fresh snapshot so the UI reflects structural changes. */
  private requestSnapshot(): void {
    if (this.connected) this.client.send({ type: "snapshot.request" });
  }

  addSite(site: Site): void {
    this.deps.repo.upsertSite(site);
    this.agent?.registerSite(site);
    this.requestSnapshot();
  }

  addDevice(device: Device, secret?: string): void {
    this.service.addDevice(device, secret);
    this.agent?.registerDevice(device);
    this.requestSnapshot();
  }

  /** This machine's connected private IPv4 addresses (for auto-filling the scan range). */
  getLocalIps(): string[] {
    return localIpv4s();
  }

  /** Deep-diagnose a device: fetch its `stats` and report per-board/fan faults. */
  async diagnoseDevice(host: string): Promise<DeviceHealth & { reachable: boolean; error?: string }> {
    const d = await diagnoseHost(host, 4028, 4000, "stats");
    if (!d.connected) {
      return { boards: [], fans: [], temps: [], hasFans: false, issues: [], reachable: false, ...(d.error ? { error: d.error } : {}) };
    }
    return { ...parseDeviceHealth(d.raw), reachable: true };
  }

  /** Diagnose a single ASIC IP end-to-end: connectivity, the raw summary reply,
   *  and the values the monitor would actually extract. */
  async testHost(ip: string): Promise<{
    connected: boolean;
    gotData: boolean;
    sample: string;
    firmware: string | null;
    state: string;
    hashrateTHs: number;
    maxTempC: number;
    summarySample: string;
    boardsFound: number;
    statsChainSample: string;
    error?: string;
  }> {
    const ver = await diagnoseHost(ip, 4028, 3000, "version");
    const sum = await diagnoseHost(ip, 4028, 3000, "summary");
    const detected = ver.gotData ? detectFromVersion(ver.raw) : null;
    const device: Device = {
      id: "test",
      siteId: "",
      name: "test",
      model: detected?.model ?? "",
      firmware: detected?.firmware ?? "stock",
      host: ip,
      apiPort: 4028,
      controlPort: 80,
    };
    const status = await pollDevice(device, this.deps.transport, Date.now());
    // Evidence for diagnostics: fetch `stats` directly (generous timeout — the
    // hydro models' per-chip reply is large) and show what the board parser sees.
    const statsProbe = await diagnoseHost(ip, 4028, 9000, "stats");
    const statsRaw = statsProbe.raw;
    const health = parseDeviceHealth(statsRaw);
    const clean = statsRaw.replace(/\0/g, "");
    const ci = clean.search(/chain[_a-z]*\d/i);
    const statsChainSample = ci >= 0 ? clean.slice(ci, ci + 220) : clean.slice(0, 220);
    // Surface EVERY temperature/fan field by name so we can see exactly what a
    // device reports (some Whatsminer firmware send "Temperature":0 and keep the
    // real heat in "Chip Temp Max", which a temp*-prefixed parser misses).
    const cleanSum = sum.raw.replace(/\0/g, "");
    const fieldsOf = (raw: string): string =>
      [...raw.replace(/\0/g, "").matchAll(/"([^"]*(?:temp|fan)[^"]*)"\s*:\s*"?(-?[\d.]+)/gi)]
        .map((m) => `${m[1]}=${m[2]}`)
        .join(", ");
    const tempFan = fieldsOf(sum.raw);
    // Whatsminer's hashboard temperature lives in `edevs`, not `summary` — probe it
    // too so we can see the real per-board temps (what WhatsMinerTool displays).
    const edevsProbe = await diagnoseHost(ip, 4028, 9000, "edevs");
    const edevsTempFan = fieldsOf(edevsProbe.raw);
    return {
      connected: ver.connected,
      gotData: ver.gotData,
      sample: ver.raw.replace(/\0/g, "").slice(0, 120),
      firmware: detected?.firmware ?? null,
      state: status.state,
      hashrateTHs: status.hashrateTHs,
      maxTempC: status.maxTempC,
      summarySample: `${cleanSum.slice(0, 140)}${tempFan ? `  ⟦summary: ${tempFan}⟧` : "  ⟦summary: لا حقول⟧"}${edevsTempFan ? `  ⟦edevs: ${edevsTempFan}⟧` : "  ⟦edevs: لا حقول⟧"}`,
      boardsFound: health.boards.length,
      statsChainSample,
      ...(ver.error ? { error: ver.error } : {}),
    };
  }

  /** Apply self-healing settings to the local monitoring service. */
  setRecovery(s: import("../../core/recovery/rules").RecoverySettings): void {
    this.service.setRecovery(s);
  }

  /** Set the web/control password for the given local devices (encrypted at rest,
   *  never sent to the server). Needed for control on miners whose password isn't
   *  the default root:root. */
  setSecrets(deviceIds: string[], secret: string): void {
    // An empty password CLEARS the stored secret, so the device reverts to the
    // firmware default (lets the user undo a wrong saved password).
    for (const id of deviceIds) {
      if (secret) this.deps.repo.setSecret(id, this.deps.encrypt(secret));
      else this.deps.repo.clearSecret(id);
    }
  }

  /** Delete a device locally (so this agent won't re-register it) and on the server. */
  deleteDevice(deviceId: string): void {
    this.deps.repo.deleteDevice(deviceId);
    if (this.connected) this.client.send({ type: "device.delete", deviceId });
  }

  /** Delete a whole site (and its devices) locally and on the server. */
  deleteSite(siteId: string): void {
    this.deps.repo.deleteSite(siteId);
    if (this.connected) this.client.send({ type: "site.delete", siteId });
  }

  /**
   * Scan the local network for ASICs and auto-register everything found under a
   * new site. Runs on the agent (the machine on the miners' LAN). Returns how
   * many were found. Discovered devices get default stock creds (root:root) —
   * monitoring works immediately; control may need real creds for modded firmware.
   */
  /** Detailed concurrent probe over hosts: device list + connectivity counters. */
  private async scanDetailed(
    hosts: string[],
  ): Promise<{ found: DiscoveredDevice[]; connected: number; responded: number }> {
    const found: DiscoveredDevice[] = [];
    let connected = 0;
    let responded = 0;
    let i = 0;
    const worker = async (): Promise<void> => {
      while (i < hosts.length) {
        const host = hosts[i++]!;
        let conn = false;
        let det: ReturnType<typeof detectFromVersion> = null;
        let gotData = false;
        // Antminer answers `version`; some Whatsminer firmware only answers
        // `get_version`, and a few only reveal themselves via `summary`. 2.8s
        // timeout for Whatsminer's slower handshake.
        const cmds = ["version", "get_version", "summary"];
        for (let p = 0; p < cmds.length; p++) {
          const d = await diagnoseHost(host, 4028, 2800, cmds[p]!);
          if (d.connected) conn = true;
          if (d.gotData) {
            gotData = true;
            det = detectFromVersion(d.raw);
            if (det) break;
          }
          if (p === 0 && !d.connected) break; // nothing on 4028 — dead host, skip alternates
        }
        if (conn) connected++;
        if (gotData) responded++;
        if (det) found.push({ host, firmware: det.firmware, model: det.model });
      }
    };
    // Lower concurrency (was 64): Whatsminer/cheap routers drop probes under a
    // big burst, which made genuine miners go undiscovered.
    await Promise.all(Array.from({ length: Math.min(20, hosts.length) }, worker));
    return { found, connected, responded };
  }

  async scanNetwork(
    siteName: string,
    base?: string,
    secret?: string,
  ): Promise<{
    found: number;
    reachable: boolean;
    bases: string[];
    connected: number;
    responded: number;
  }> {
    const bases = base && base.trim() ? [base.trim()] : localPrivateBases();
    if (bases.length === 0)
      return { found: 0, reachable: false, bases: [], connected: 0, responded: 0 };
    const hosts = bases.flatMap((b) => subnetHosts(b));
    const { found, connected, responded } = await this.scanDetailed(hosts);
    if (found.length === 0) return { found: 0, reachable: true, bases, connected, responded };

    const siteId = randomUUID();
    const site = { id: siteId, name: siteName };
    this.deps.repo.upsertSite(site);
    this.agent?.registerSite(site);
    for (const d of found) {
      const last = d.host.split(".").pop() ?? "";
      const controlPort = d.firmware === "stock" || d.firmware === "vnish" ? 80 : 4028;
      const device: Device = {
        id: randomUUID(),
        siteId,
        name: `${d.model}-${last}`,
        model: d.model,
        firmware: d.firmware,
        host: d.host,
        apiPort: 4028,
        controlPort,
      };
      // Store the password the user typed once (applies to the whole fleet). If
      // empty, store nothing — control falls back to the firmware's built-in
      // default automatically (firmwareDefaultSecret).
      this.service.addDevice(device, secret && secret.trim() ? secret.trim() : undefined);
      this.agent?.registerDevice(device);
    }
    this.requestSnapshot(); // one refresh after registering everything
    return { found: found.length, reachable: true, bases, connected, responded };
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
    // Build the agent runtime ONCE (so its message handler subscribes once for the
    // bridge's lifetime); on later reconnects just re-announce. Otherwise every
    // reconnect would stack another handler and duplicate command execution.
    const s = this.deps.config.get();
    if (!this.agent) {
      this.agent = new AgentRuntime({
        agentId: s.agentId,
        agentName: s.agentName,
        ...(this.deps.appVersion ? { appVersion: this.deps.appVersion } : {}),
        conn: this.client,
        listSites: () => this.deps.repo.listSites(),
        listDevices: () => this.deps.repo.listDevices(),
        execute: (deviceId, command, params) => this.service.sendCommand(deviceId, command, params),
      });
      this.agent.start();
    } else {
      this.agent.announce();
    }
    this.client.send({ type: "snapshot.request" });
    this.service.startMonitoring(); // poll local devices -> pushStatuses to server
    // On (re)connect, pick up any update the owner uploaded to their server.
    const base = this.serverBase();
    if (base) this.deps.checkServerUpdate?.(base);
  }

  /** Base URL of the owner's server, for the self-hosted update channel. */
  private serverBase(): string | null {
    const a = this.deps.config.get().serverAddr;
    return a ? `https://${a}` : null;
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
      case "update.now": {
        // The owner triggered a fleet-wide update from the admin dashboard —
        // check both the GitHub channel and the owner's self-hosted channel.
        this.deps.onUpdateNow?.();
        const base = this.serverBase();
        if (base) this.deps.checkServerUpdate?.(base);
        break;
      }
    }
  }
}
