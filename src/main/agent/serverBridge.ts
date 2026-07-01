import { randomUUID, verify as cryptoVerify } from "node:crypto";
import { get as httpsGet } from "node:https";
import { get as httpGet } from "node:http";
import type { SensorConfig, SensorReading } from "../../core/model/sensor";
import { parseShelly, evalEnv } from "../../core/sensors/shelly";
import type { Device, Site, DeviceStatus, Firmware } from "../../core/model/device";
import type { ControlCommand, Transport, FlashTransport } from "../../core/drivers/types";
import type { CommandOutcome } from "../../core/model/result";
import type { Alert } from "../../core/alerts/rules";
import type { ServerMessage, FlashExec, AgentOpExec } from "../../shared/protocol";
import { httpUpload } from "../transport/http";
import { runFlash } from "./flashRunner";
import { UPDATE_PUBLIC_KEY } from "../updateKey";
import { MiningService, type Snapshot } from "../service";
import type { DeviceRepo } from "../db/repo";
import { ConnectionConfig } from "./config";
import { ServerClient, type AuthResult } from "./serverClient";
import { AgentRuntime } from "./runtime";
import { subnetHosts, planRescan, type DiscoveredDevice } from "../../core/discovery/scan";
import { hostsToRescan } from "../../core/discovery/rescan";
import { detectFromVersion, extractMac, extractWhatsminerModel } from "../../core/discovery/detect";
import { pollDevice } from "../../core/monitor/poller";
import { parseDeviceHealth, type DeviceHealth } from "../../core/diagnose/parse";
import { localPrivateBases, localIpv4s } from "../discovery/localSubnet";
import { diagnoseHost, tcp4028 } from "../transport/tcp";

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
  private pendingOps = new Map<string, (r: { ok: boolean; data?: string; error?: string }) => void>();
  private rescanTimer: ReturnType<typeof setInterval> | null = null;
  private initialRescan: ReturnType<typeof setTimeout> | null = null;
  private rescanning = false;
  private sensorTimer: ReturnType<typeof setInterval> | null = null;
  private sensorAlertedAt = new Map<string, number>(); // sensorId -> last alert epoch (throttle)
  private wmFixTimer: ReturnType<typeof setTimeout> | null = null;
  private wmFixDone = false; // one-time Whatsminer name repair (per app session)
  private flashing = new Set<string>(); // deviceIds currently being flashed (per-device lock)

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

    // Auto-discovery is OPT-IN (off by default) — enabled via setAutoDiscovery() from
    // the app setting. It only probes UNREGISTERED IPs and auto-adds newly-found miners;
    // on DHCP networks that can create duplicates, so the user controls it.
  }

  /** Turn the periodic auto-discovery sweep on/off (from the app setting). Off = the
   *  agent never auto-adds devices; the user scans manually when adding real miners. */
  setAutoDiscovery(enabled: boolean): void {
    if (this.initialRescan) {
      clearTimeout(this.initialRescan);
      this.initialRescan = null;
    }
    if (this.rescanTimer) {
      clearInterval(this.rescanTimer);
      this.rescanTimer = null;
    }
    if (!enabled) return;
    // First sweep a few minutes after enabling, then every 10 minutes.
    this.initialRescan = setTimeout(() => void this.rescanKnownSites(), 3 * 60 * 1000);
    this.rescanTimer = setInterval(() => void this.rescanKnownSites(), 10 * 60 * 1000);
  }

  /** Stop background timers (for a clean shutdown / tests). */
  dispose(): void {
    if (this.initialRescan) clearTimeout(this.initialRescan);
    if (this.rescanTimer) clearInterval(this.rescanTimer);
    if (this.sensorTimer) clearInterval(this.sensorTimer);
    if (this.wmFixTimer) clearTimeout(this.wmFixTimer);
    this.initialRescan = null;
    this.rescanTimer = null;
    this.sensorTimer = null;
    this.wmFixTimer = null;
  }

  /** GET a small JSON document from a sensor on the LAN (plain HTTP, short timeout). */
  private httpGetJson(host: string, path: string, timeoutMs = 4000): Promise<unknown> {
    const h = host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return new Promise((resolve, reject) => {
      const req = httpGet(`http://${h}${path}`, { timeout: timeoutMs }, (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => {
          body += c;
          if (body.length > 200_000) req.destroy(); // sensor JSON is tiny; cap junk
        });
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error("bad JSON"));
          }
        });
      });
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
    });
  }

  /** Persist a site's sensor list locally and (re)start the climate sweep. */
  private applySetSensors(siteId: string, list: SensorConfig[]): void {
    this.deps.config.setSensors(
      siteId,
      list.map((x) => ({ ...x, siteId })),
    );
    this.refreshSensorPolling();
  }

  /** Poll (now) the sensors configured for a site (or all sites when siteId is empty). */
  private async readSensors(siteId: string): Promise<SensorReading[]> {
    const all = this.deps.config.get().sensors ?? [];
    const mine = siteId ? all.filter((s) => s.siteId === siteId) : all;
    return Promise.all(mine.map((c) => this.pollSensor(c)));
  }

  /** Save a site's room sensors — LOCALLY if this machine owns the site, else routed to
   *  the owning farm laptop (so the office PC configures a remote site's sensors). */
  async setSensorsAtSite(siteId: string, list: SensorConfig[]): Promise<{ ok: boolean; error?: string }> {
    if (this.ownsSite(siteId)) {
      this.applySetSensors(siteId, list);
      return { ok: true };
    }
    const r = await this.sendAgentOp({ siteId }, "setSensors", { siteId, sensors: JSON.stringify(list) });
    return { ok: r.ok, ...(r.error ? { error: r.error } : {}) };
  }

  /** Read a site's room sensors — locally if owned, else from the owning farm laptop. */
  async getSensorsAtSite(siteId: string): Promise<SensorReading[]> {
    if (this.ownsSite(siteId)) return this.readSensors(siteId);
    const r = await this.sendAgentOp({ siteId }, "getSensors", { siteId });
    if (!r.ok || !r.data) return [];
    try {
      return JSON.parse(r.data) as SensorReading[];
    } catch {
      return [];
    }
  }

  /** Read one Shelly sensor: try Gen1 /status then Gen2/3 /rpc/Shelly.GetStatus. */
  private async pollSensor(cfg: SensorConfig): Promise<SensorReading> {
    let lastErr = "لم يستجب";
    for (const path of ["/status", "/rpc/Shelly.GetStatus"]) {
      try {
        const r = parseShelly(await this.httpGetJson(cfg.host, path));
        if (r) return { ...cfg, ...r, ok: true, at: Date.now() };
      } catch (e) {
        lastErr = (e as Error).message;
      }
    }
    return { ...cfg, ok: false, at: Date.now(), error: lastErr };
  }

  /** (Re)start the background sensor sweep: poll each configured sensor every 60s and
   *  raise an OS+Telegram alert (throttled 30m per sensor) when a room breaches its limit. */
  private refreshSensorPolling(): void {
    if (this.sensorTimer) {
      clearInterval(this.sensorTimer);
      this.sensorTimer = null;
    }
    if ((this.deps.config.get().sensors ?? []).length === 0) return;
    const tick = async (): Promise<void> => {
      for (const cfg of this.deps.config.get().sensors ?? []) {
        const r = await this.pollSensor(cfg);
        if (!r.ok) continue;
        const high = evalEnv(r, {
          ...(cfg.maxTempC ? { maxTempC: cfg.maxTempC } : {}),
          ...(cfg.maxHumidity ? { maxHumidity: cfg.maxHumidity } : {}),
        }).find((i) => i.severity === "high");
        if (!high) continue;
        const last = this.sensorAlertedAt.get(cfg.id) ?? 0;
        if (Date.now() - last < 30 * 60 * 1000) continue; // throttle repeats
        this.sensorAlertedAt.set(cfg.id, Date.now());
        this.deps.notify(
          high.code === "roomHot"
            ? `🌡️ حرارة غرفة «${cfg.name}» وصلت ${Math.round(high.value)}° (الحد ${high.limit}°) — تأكد من التبريد`
            : `💧 رطوبة غرفة «${cfg.name}» وصلت ${Math.round(high.value)}% (الحد ${high.limit}%)`,
        );
      }
    };
    void tick();
    this.sensorTimer = setInterval(() => void tick(), 60 * 1000);
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

  /** Store the web/control password locally (encrypted at rest) for devices THIS agent
   *  owns. An empty password CLEARS it (reverts to the firmware default). */
  private setSecretsLocal(deviceIds: string[], secret: string): void {
    for (const id of deviceIds) {
      if (secret) this.deps.repo.setSecret(id, this.deps.encrypt(secret));
      else this.deps.repo.clearSecret(id);
    }
  }

  /**
   * Set device passwords from anywhere: for devices this machine owns, store locally;
   * for devices owned by another agent (i.e. the office computer setting a remote
   * farm's passwords), route to that farm's agent grouped by site so it stores them.
   * (The password rides the user's own cert-pinned server — needed so remote control
   * works on miners with non-default passwords.)
   */
  async setCredentials(deviceIds: string[], secret: string): Promise<void> {
    const localIds = new Set(this.deps.repo.listDevices().map((d) => d.id));
    const siteOf = new Map(this.snapshot.devices.map((d) => [d.id, d.siteId]));
    const localTargets: string[] = [];
    const remoteBySite = new Map<string, string[]>();
    for (const id of deviceIds) {
      if (localIds.has(id)) localTargets.push(id);
      else {
        const siteId = siteOf.get(id);
        if (siteId) remoteBySite.set(siteId, [...(remoteBySite.get(siteId) ?? []), id]);
      }
    }
    if (localTargets.length) this.setSecretsLocal(localTargets, secret);
    for (const [siteId, ids] of remoteBySite)
      await this.sendAgentOp({ siteId }, "setSecret", { deviceIds: ids.join(","), secret });
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

  /** Is a live miner reachable at this host right now? (Stops at the first marker.) */
  private async probePresent(host: string, firmware: Firmware): Promise<boolean> {
    const cmds = firmware === "whatsminer" ? ["get_version", "summary", "version"] : ["version", "summary"];
    for (let p = 0; p < cmds.length; p++) {
      const d = await diagnoseHost(host, 4028, 2800, cmds[p]!);
      if (detectFromVersion(d.raw)) return true;
      if (p === 0 && !d.connected) return false; // nothing on 4028 — dead host
    }
    return false;
  }

  /** True if THIS machine is the agent that owns the site (its devices are in our local
   *  repo). A pure viewer (e.g. the office computer) has none → it must route ops to the
   *  owning farm laptop. */
  private ownsSite(siteId: string): boolean {
    return this.deps.repo.listDevices().some((d) => d.siteId === siteId);
  }

  /**
   * Remove absent devices in a site. Runs LOCALLY if this machine owns the site;
   * otherwise ROUTES the op to the owning agent (so the office computer can clean a
   * remote farm without logging into its laptop) and returns that agent's result.
   */
  async removeAbsentDevices(
    siteId: string,
  ): Promise<{ removed: number; kept: number; siteUnreachable: boolean }> {
    if (this.ownsSite(siteId)) return this.removeAbsentLocal(siteId);
    const r = await this.sendAgentOp({ siteId }, "removeAbsent");
    if (!r.ok || !r.data) return { removed: 0, kept: 0, siteUnreachable: true };
    try {
      return JSON.parse(r.data) as { removed: number; kept: number; siteUnreachable: boolean };
    } catch {
      return { removed: 0, kept: 0, siteUnreachable: true };
    }
  }

  /**
   * Probe every device in a site and remove ONLY those whose IP has NO miner responding
   * (genuine phantoms — e.g. an old IP left behind by a DHCP change). Miners that respond
   * are kept (present hardware, even if not hashing). If NOTHING in the site answers it's
   * treated as a network/agent outage and nothing is removed — so a temporary outage can
   * never wipe a whole site. Runs on the agent that's on the miners' LAN.
   */
  private async removeAbsentLocal(
    siteId: string,
  ): Promise<{ removed: number; kept: number; siteUnreachable: boolean }> {
    const devices = this.deps.repo.listDevices().filter((d) => d.siteId === siteId);
    if (devices.length === 0) return { removed: 0, kept: 0, siteUnreachable: false };
    const present = new Set<string>();
    let i = 0;
    const worker = async (): Promise<void> => {
      while (i < devices.length) {
        const d = devices[i++]!;
        if (await this.probePresent(d.host, d.firmware)) present.add(d.id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, devices.length) }, worker));
    // Network-health guard: nothing answered → likely an outage, not absent devices.
    if (present.size === 0) return { removed: 0, kept: devices.length, siteUnreachable: true };
    let removed = 0;
    for (const d of devices) {
      if (!present.has(d.id)) {
        this.deleteDevice(d.id);
        removed++;
      }
    }
    if (removed > 0) this.requestSnapshot();
    return { removed, kept: present.size, siteUnreachable: false };
  }

  /** Rename a site. Routed through the server so it works from ANY laptop (even one
   *  that only VIEWS this site), updates the shared DB + all viewers live, and reaches
   *  the OWNING agent so it persists the new name (and re-registers it). */
  renameSite(siteId: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    // If this laptop owns the site, update locally too (immediate + offline-safe).
    if (this.deps.repo.listSites().some((s) => s.id === siteId))
      this.deps.repo.upsertSite({ id: siteId, name: trimmed });
    if (this.connected) this.client.send({ type: "site.rename", siteId, name: trimmed });
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
    concurrency = 20,
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
        let rawAll = "";
        // Antminer answers `version`; some Whatsminer firmware only answers
        // `get_version`, and a few only reveal themselves via `summary`. 2.8s
        // timeout for Whatsminer's slower handshake.
        const cmds = ["version", "get_version", "summary"];
        for (let p = 0; p < cmds.length; p++) {
          const d = await diagnoseHost(host, 4028, 2800, cmds[p]!);
          if (d.connected) conn = true;
          if (d.raw) rawAll += d.raw;
          if (d.gotData) {
            gotData = true;
            det = detectFromVersion(d.raw);
            if (det) break;
          }
          if (p === 0 && !d.connected) break; // nothing on 4028 — dead host, skip alternates
        }
        if (conn) connected++;
        if (gotData) responded++;
        if (det) {
          // Capture a stable MAC so a later IP change is recognised as the same box.
          let hwId = extractMac(rawAll);
          if (!hwId) hwId = (await this.probeIdentity(host, det.firmware)).mac;
          const model = await this.bestModel(host, det); // real Whatsminer minertype when available
          found.push({ host, firmware: det.firmware, model, ...(hwId ? { hwId } : {}) });
        }
      }
    };
    // Lower concurrency (was 64): Whatsminer/cheap routers drop probes under a
    // big burst, which made genuine miners go undiscovered.
    await Promise.all(Array.from({ length: Math.min(concurrency, hosts.length) }, worker));
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
        ...(d.hwId ? { hwId: d.hwId } : {}),
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

  /** Scan a REMOTE farm's LAN from a viewer (office computer): route the scan to the
   *  chosen farm laptop (agentId), which scans its own subnet and adds the site +
   *  devices locally. Returns the same shape as a local scan. */
  async scanNetworkVia(
    agentId: string,
    siteName: string,
    base?: string,
    secret?: string,
  ): Promise<{ found: number; reachable: boolean; bases: string[]; connected: number; responded: number }> {
    const fail = { found: 0, reachable: false, bases: [] as string[], connected: 0, responded: 0 };
    const r = await this.sendAgentOp({ agentId }, "scan", {
      siteName,
      ...(base ? { base } : {}),
      ...(secret ? { secret } : {}),
    });
    if (!r.ok || !r.data) return fail;
    try {
      return JSON.parse(r.data) as typeof fail & { found: number };
    } catch {
      return fail;
    }
  }

  /** Test a single IP AT a specific site — runs locally if we own the site, else routes
   *  to that site's farm laptop (so it uses that site's own router/subnet). Lets the
   *  office computer test an IP on any site without picking an agent. */
  async testHostAtSite(siteId: string, ip: string): Promise<Awaited<ReturnType<ServerBridge["testHost"]>>> {
    if (this.ownsSite(siteId)) return this.testHost(ip);
    const fail = {
      connected: false, gotData: false, sample: "", firmware: null, state: "offline",
      hashrateTHs: 0, maxTempC: 0, summarySample: "", boardsFound: 0, statsChainSample: "",
    };
    const r = await this.sendAgentOp({ siteId }, "testHost", { ip });
    if (!r.ok || !r.data)
      return { ...fail, ...(r.error ? { error: r.error } : {}) } as Awaited<ReturnType<ServerBridge["testHost"]>>;
    try {
      return JSON.parse(r.data) as Awaited<ReturnType<ServerBridge["testHost"]>>;
    } catch {
      return fail as Awaited<ReturnType<ServerBridge["testHost"]>>;
    }
  }

  /** Diagnose a single IP on a REMOTE farm from a viewer: route the probe to the farm
   *  laptop (agentId), which reaches the miner on its LAN. */
  async testHostVia(agentId: string, ip: string): Promise<Awaited<ReturnType<ServerBridge["testHost"]>>> {
    const fail = {
      connected: false, gotData: false, sample: "", firmware: null, state: "offline",
      hashrateTHs: 0, maxTempC: 0, summarySample: "", boardsFound: 0, statsChainSample: "",
    };
    const r = await this.sendAgentOp({ agentId }, "testHost", { ip });
    if (!r.ok || !r.data)
      return { ...fail, ...(r.error ? { error: r.error } : {}) } as Awaited<ReturnType<ServerBridge["testHost"]>>;
    try {
      return JSON.parse(r.data) as Awaited<ReturnType<ServerBridge["testHost"]>>;
    } catch {
      return fail as Awaited<ReturnType<ServerBridge["testHost"]>>;
    }
  }

  /**
   * Auto-discovery sweep: for every known site, probe the UNREGISTERED IPs in its
   * subnet(s). A found miner whose MAC matches an existing device is the SAME box on a
   * new IP → its host is updated IN PLACE (keeping its name/password) rather than added
   * as a phantom duplicate; only a genuinely-new miner is added. Existing offline
   * devices are NEVER removed. Runs on a 10-minute timer at low concurrency.
   */
  async rescanKnownSites(): Promise<{ added: number; relocated: number }> {
    // Never overlap a still-running sweep (with several sites a sweep can take
    // minutes; the 10-min timer firing again would double the network load).
    if (this.rescanning) return { added: 0, relocated: 0 };
    this.rescanning = true;
    try {
      const sites = this.deps.repo.listSites();
      if (sites.length === 0 || this.deps.repo.listDevices().length === 0)
        return { added: 0, relocated: 0 };
      // Backfill stable MACs for known devices first, so a moved miner can be matched
      // to its existing entry (instead of being added as a new/phantom device).
      await this.backfillHwIds();
      const devices = this.deps.repo.listDevices();
      let added = 0;
      let relocated = 0;
      for (const site of sites) {
        const hosts = hostsToRescan(site.id, devices, subnetHosts);
        if (hosts.length === 0) continue;
        // New miners inherit this site's fleet password (from a sibling that has
        // one) so control + self-healing work on them — the manual scan does this too.
        const sib = devices.find((x) => x.siteId === site.id && this.deps.repo.getSecret(x.id));
        const secret = sib ? this.deps.decrypt(this.deps.repo.getSecret(sib.id)!) : undefined;
        const { found } = await this.scanDetailed(hosts, 8);
        const siteDevices = devices.filter((d) => d.siteId === site.id);
        const plan = planRescan(found, siteDevices);
        // A miner that changed IP: update the SAME device's host (no phantom, keeps
        // its custom name + saved password).
        for (const r of plan.relocate) {
          const existing = this.deps.repo.listDevices().find((d) => d.id === r.deviceId);
          if (!existing) continue;
          const moved = { ...existing, host: r.host };
          this.deps.repo.upsertDevice(moved);
          this.agent?.registerDevice(moved);
          relocated++;
        }
        for (const d of plan.add) {
          const last = d.host.split(".").pop() ?? "";
          const controlPort = d.firmware === "stock" || d.firmware === "vnish" ? 80 : 4028;
          const device: Device = {
            id: randomUUID(),
            siteId: site.id,
            name: `${d.model}-${last}`,
            model: d.model,
            firmware: d.firmware,
            host: d.host,
            apiPort: 4028,
            controlPort,
            ...(d.hwId ? { hwId: d.hwId } : {}),
          };
          this.service.addDevice(device, secret);
          this.agent?.registerDevice(device);
          added++;
        }
      }
      if (added > 0 || relocated > 0) {
        if (added > 0) this.deps.notify(`🔍 اكتشاف تلقائي: تمت إضافة ${added} جهاز جديد`);
        this.requestSnapshot();
      }
      return { added, relocated };
    } finally {
      this.rescanning = false;
    }
  }

  /** Probe a host for its stable MAC (field-name-agnostic) AND detected firmware.
   *  Whatsminer keeps the MAC in get_miner_info; others may surface it in version/stats. */
  private async probeIdentity(
    host: string,
    firmware: Firmware,
  ): Promise<{ mac: string | null; firmware: Firmware | null }> {
    const cmds =
      firmware === "whatsminer"
        ? ["get_miner_info", "summary", "version"]
        : ["version", "stats", "get_miner_info"];
    let mac: string | null = null;
    let fw: Firmware | null = null;
    for (const cmd of cmds) {
      const d = await diagnoseHost(host, 4028, 2800, cmd);
      if (!mac) mac = extractMac(d.raw);
      if (!fw) {
        const det = detectFromVersion(d.raw);
        if (det) fw = det.firmware;
      }
      if (mac && fw) break;
    }
    return { mac, firmware: fw };
  }

  /** Deep-probe a Whatsminer for its REAL model (minertype), when the basic
   *  version/get_version/summary didn't reveal it. Tries the newer btminer
   *  {"cmd":"get.device.info"} envelope (raw via tcp4028) and legacy {"command":...}
   *  commands (devdetails / stats / get_miner_info). Returns a clean model or null. */
  private async probeWhatsminerModel(host: string): Promise<string | null> {
    const attempts: Array<() => Promise<string>> = [
      () => tcp4028(host, 4028, JSON.stringify({ cmd: "get.device.info" }), 2800),
      () => tcp4028(host, 4028, JSON.stringify({ cmd: "get.device.info", info: "miner" }), 2800),
      () => diagnoseHost(host, 4028, 2800, "devdetails").then((d) => d.raw),
      () => diagnoseHost(host, 4028, 2800, "stats").then((d) => d.raw),
      () => diagnoseHost(host, 4028, 2800, "get_miner_info").then((d) => d.raw),
    ];
    for (const a of attempts) {
      try {
        const model = extractWhatsminerModel(await a());
        if (model) return model;
      } catch {
        /* try the next command/format */
      }
    }
    return null;
  }

  /** Best model for a detected device: the detected one, or — for a Whatsminer that only
   *  gave a generic label — a deeper probe for its real minertype (M30S/M50S/M60…). */
  private async bestModel(host: string, det: { firmware: Firmware; model: string }): Promise<string> {
    if (det.firmware === "whatsminer" && (det.model === "Whatsminer" || det.model === "ASIC")) {
      const real = await this.probeWhatsminerModel(host);
      if (real) return real;
    }
    return det.model;
  }

  /** One-time backfill of MACs for registered devices that don't have one yet, so the
   *  rescan can recognise an IP change. Offline devices simply don't respond (retried a
   *  later sweep). Bounded concurrency to stay gentle on the site network. */
  private async backfillHwIds(): Promise<void> {
    const missing = this.deps.repo.listDevices().filter((d) => !d.hwId);
    if (missing.length === 0) return;
    let i = 0;
    const worker = async (): Promise<void> => {
      while (i < missing.length) {
        const d = missing[i++]!;
        const id = await this.probeIdentity(d.host, d.firmware);
        // Adopt the MAC ONLY if the host still hosts the SAME firmware family — guards
        // against grabbing a different miner's MAC if this IP was reassigned (DHCP).
        if (!id.mac || (id.firmware && id.firmware !== d.firmware)) continue;
        const cur = this.deps.repo.listDevices().find((x) => x.id === d.id);
        if (cur && !cur.hwId) this.deps.repo.upsertDevice({ ...cur, hwId: id.mac });
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, missing.length) }, worker));
  }

  /** Repair Whatsminer devices whose auto-generated NAME/model is a firmware-VERSION
   *  string (from the old detection bug that used fw_ver as the model). Re-detects the
   *  real model from the live miner and rewrites name+model in place — locally AND on the
   *  server (so the office-PC viewer updates too). Only touches whatsminer rows with a
   *  versiony name/model; never a name the user chose. Idempotent + bounded concurrency. */
  private async backfillWhatsminerNames(): Promise<void> {
    // Matches an auto-generated version-string name: a long digit run, a "Rel2-…" build,
    // or an embedded YYYYMMDD. NOT a normal model like "M50S" or "Whatsminer".
    const VER_RE = /^\d{6,}|^rel\d|\.\d{8}\.|-\d{8}|\d{8}\.\d/i;
    // Re-process a Whatsminer if its name/model is a version string, empty, OR still the
    // generic "Whatsminer" placeholder (so we can upgrade it to the real model once found).
    const bad = this.deps.repo
      .listDevices()
      .filter(
        (d) =>
          d.firmware === "whatsminer" &&
          (VER_RE.test(d.name) || VER_RE.test(d.model) || d.model === "" || d.model === "Whatsminer"),
      );
    if (bad.length === 0) return;
    let i = 0;
    const worker = async (): Promise<void> => {
      while (i < bad.length) {
        const d = bad[i++]!;
        let det: ReturnType<typeof detectFromVersion> = null;
        for (const cmd of ["version", "get_version", "summary"]) {
          const r = await diagnoseHost(d.host, 4028, 2800, cmd);
          if (r.gotData) {
            det = detectFromVersion(r.raw);
            if (det) break;
          }
        }
        if (!det || det.firmware !== "whatsminer") continue; // offline, or not a Whatsminer anymore
        const model = await this.bestModel(d.host, det); // real minertype (M50S…) or "Whatsminer"
        const cur = this.deps.repo.listDevices().find((x) => x.id === d.id);
        if (!cur) continue;
        const last = cur.host.split(".").pop() ?? "";
        // Rewrite ONLY an auto-generated name (versiony OR the generic "Whatsminer-<octet>") —
        // never a name the user typed.
        const auto = VER_RE.test(cur.name) || /^whatsminer-\d+$/i.test(cur.name);
        const newName = auto ? `${model}-${last}` : cur.name;
        if (cur.model === model && cur.name === newName) continue; // nothing changed
        const fixed = { ...cur, model, name: newName };
        this.deps.repo.upsertDevice(fixed); // persist locally
        this.agent?.registerDevice(fixed); // push to server -> viewer sees the corrected name
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, bad.length) }, worker));
    this.requestSnapshot();
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

  /** Viewer side: run a management op on the OWNING agent via the server (routed by
   *  site OR agentId), awaiting its result. Long timeout — probing/scanning a whole
   *  subnet can take tens of seconds. */
  private sendAgentOp(
    target: { siteId?: string; agentId?: string },
    op: import("../../shared/protocol").AgentOp,
    params?: Record<string, string>,
  ): Promise<{ ok: boolean; data?: string; error?: string }> {
    if (!this.connected) return Promise.resolve({ ok: false, error: "غير متصل بالخادم" });
    const opId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingOps.delete(opId);
        resolve({ ok: false, error: "انتهت المهلة" });
      }, 130000);
      this.pendingOps.set(opId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      this.client.send({
        type: "agentop.send",
        opId,
        ...(target.siteId ? { siteId: target.siteId } : {}),
        ...(target.agentId ? { agentId: target.agentId } : {}),
        op,
        ...(params ? { params } : {}),
      });
    });
  }

  /** Agent side: the server routed an op here (we own the site/agent) — run it locally
   *  and report the result back over the same channel. Everything the office computer
   *  can trigger runs here on the farm laptop. */
  private async handleAgentOp(m: AgentOpExec): Promise<void> {
    try {
      const p = m.params ?? {};
      let data = "{}";
      switch (m.op) {
        case "removeAbsent":
          if (!m.siteId) throw new Error("siteId required");
          data = JSON.stringify(await this.removeAbsentLocal(m.siteId));
          break;
        case "rescan":
          data = JSON.stringify(await this.rescanKnownSites());
          break;
        case "scan":
          data = JSON.stringify(
            await this.scanNetwork(p["siteName"] ?? "", p["base"] || undefined, p["secret"] || undefined),
          );
          break;
        case "setSecret": {
          const ids = (p["deviceIds"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          this.setSecretsLocal(ids, p["secret"] ?? "");
          data = JSON.stringify({ ok: true, count: ids.length });
          break;
        }
        case "testHost":
          data = JSON.stringify(await this.testHost(p["ip"] ?? ""));
          break;
        case "setSensors": {
          const siteId = p["siteId"] ?? "";
          this.applySetSensors(siteId, JSON.parse(p["sensors"] ?? "[]") as SensorConfig[]);
          data = JSON.stringify({ ok: true });
          break;
        }
        case "getSensors":
          data = JSON.stringify(await this.readSensors(p["siteId"] || ""));
          break;
        default:
          this.client.send({ type: "agentop.result", opId: m.opId, ok: false, error: "عملية غير معروفة" });
          return;
      }
      this.client.send({ type: "agentop.result", opId: m.opId, ok: true, data });
    } catch (e) {
      this.client.send({ type: "agentop.result", opId: m.opId, ok: false, error: (e as Error).message });
    }
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
    this.refreshSensorPolling(); // resume room-climate alerts from persisted config
    // One-time repair of Whatsminer devices misnamed with a firmware-version string
    // (old detection bug). Runs on THIS agent's own devices, shortly after connecting.
    if (!this.wmFixDone && !this.wmFixTimer) {
      this.wmFixTimer = setTimeout(() => {
        this.wmFixTimer = null;
        this.wmFixDone = true;
        void this.backfillWhatsminerNames();
      }, 20_000);
    }
    // On (re)connect, pick up any update the owner uploaded to their server.
    const base = this.serverBase();
    if (base) this.deps.checkServerUpdate?.(base);
  }

  /** Base URL of the owner's server, for the self-hosted update channel. */
  private serverBase(): string | null {
    const a = this.deps.config.get().serverAddr;
    return a ? `https://${a}` : null;
  }

  /**
   * Run a firmware-flash job for one locally-owned device and stream
   * progress/result back to the server. The actual orchestration (download →
   * sha256 → model re-check → driver flash → version read-back) lives in
   * runFlash; this just wires it to this agent's transport, repo and socket.
   */
  private async handleFlash(msg: FlashExec): Promise<void> {
    // Per-device lock: never run two concurrent flashes against the same physical miner
    // (e.g. if two batches both dispatched it). A second flash.exec is refused, not run.
    if (this.flashing.has(msg.deviceId)) {
      this.client.send({
        type: "flash.result",
        jobId: msg.jobId,
        deviceId: msg.deviceId,
        state: "refused",
        error: "يوجد فلاش جارٍ بالفعل لنفس الجهاز",
      });
      return;
    }
    this.flashing.add(msg.deviceId);
    // Compose a FlashTransport: reuse the agent's tcp/http, add binary upload.
    const ft: FlashTransport = {
      tcp4028: (h, p, c) => this.deps.transport.tcp4028(h, p, c),
      http: (r) => this.deps.transport.http(r),
      httpUpload,
    };
    try {
      await runFlash(msg, {
        transport: ft,
        findDevice: (id) => this.deps.repo.listDevices().find((d) => d.id === id),
        getSecret: (id) => {
          const enc = this.deps.repo.getSecret(id);
          return enc ? this.deps.decrypt(enc) : undefined;
        },
        download: (path) => this.downloadToBuffer(path, msg.size),
        readVersion: (d) =>
          this.deps.transport.tcp4028(d.host, d.apiPort, JSON.stringify({ command: "version" })),
        verifySig: (payload, sigB64) => {
          try {
            return cryptoVerify(null, Buffer.from(payload), UPDATE_PUBLIC_KEY, Buffer.from(sigB64, "base64"));
          } catch {
            return false;
          }
        },
        send: (m) => this.client.send(m),
      });
    } catch (e) {
      // runFlash already reports failures, but never let a flash crash the bridge.
      this.client.send({
        type: "flash.result",
        jobId: msg.jobId,
        deviceId: msg.deviceId,
        state: "failed",
        error: (e as Error).message,
      });
    } finally {
      this.flashing.delete(msg.deviceId);
    }
  }

  /** Download a server-hosted firmware file into a Buffer, capped at the signed `size`
   *  (hard-limited to 600MB) so a hostile/MITM responder can't OOM the agent. Trust in
   *  the bytes is the Ed25519 signature + SHA-256 (verified in runFlash), not this
   *  unpinned TLS connection. */
  private downloadToBuffer(path: string, expectedSize: number): Promise<Buffer> {
    const base = this.serverBase();
    if (!base || !path) return Promise.resolve(Buffer.alloc(0));
    const HARD_CAP = 600 * 1024 * 1024;
    const cap = Math.min(expectedSize > 0 ? expectedSize : HARD_CAP, HARD_CAP);
    const url = `${base}${path}`;
    return new Promise((resolve) => {
      try {
        const req = httpsGet(url, { rejectUnauthorized: false, timeout: 180000 }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            resolve(Buffer.alloc(0));
            return;
          }
          const len = Number(res.headers["content-length"] ?? 0);
          if (len > cap) {
            res.destroy();
            resolve(Buffer.alloc(0));
            return;
          }
          const chunks: Buffer[] = [];
          let received = 0;
          res.on("data", (c) => {
            received += (c as Buffer).length;
            if (received > cap) {
              res.destroy();
              resolve(Buffer.alloc(0));
              return;
            }
            chunks.push(c as Buffer);
          });
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", () => resolve(Buffer.alloc(0)));
        });
        req.on("error", () => resolve(Buffer.alloc(0)));
        req.on("timeout", () => {
          req.destroy();
          resolve(Buffer.alloc(0));
        });
      } catch {
        resolve(Buffer.alloc(0));
      }
    });
  }

  private onServerMessage(m: ServerMessage): void {
    switch (m.type) {
      case "snapshot":
        this.snapshot = {
          sites: m.sites,
          devices: m.devices,
          statuses: m.statuses,
          ...(m.agents ? { agents: m.agents } : {}),
        };
        this.deps.emitSnapshot(this.snapshot);
        break;
      case "status.update": {
        const byId = new Map(this.snapshot.statuses.map((x) => [x.deviceId, x]));
        for (const st of m.statuses) byId.set(st.deviceId, st);
        this.snapshot = { ...this.snapshot, statuses: [...byId.values()] };
        this.deps.emitStatuses(m.statuses);
        break;
      }
      case "site.rename":
        // If this agent owns the site, persist the new name locally so it survives
        // and re-registers correctly. Viewers that don't own it just get the snapshot.
        if (this.deps.repo.listSites().some((s) => s.id === m.siteId))
          this.deps.repo.upsertSite({ id: m.siteId, name: m.name });
        break;
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
      case "flash.exec":
        // Firmware-flash job for a device this agent owns. Long-running: it reports
        // progress + a terminal result asynchronously (not the 15s command channel).
        void this.handleFlash(m);
        break;
      case "agentop.exec":
        // A viewer (e.g. office computer) asked us — the owning agent — to run a
        // site management op locally and report back.
        void this.handleAgentOp(m);
        break;
      case "agentop.ack": {
        const resolve = this.pendingOps.get(m.opId);
        if (resolve) {
          this.pendingOps.delete(m.opId);
          resolve({ ok: m.ok, ...(m.data ? { data: m.data } : {}), ...(m.error ? { error: m.error } : {}) });
        }
        break;
      }
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
