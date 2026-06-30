import type { Device, DeviceStatus, Site } from "../core/model/device";
import type { CommandOutcome } from "../core/model/result";
import type { Transport, ControlCommand, CommandParams } from "../core/drivers/types";
import { getDriver } from "../core/drivers/registry";
import { resolveSecret } from "../core/drivers/defaults";
import { parseDeviceHealth, parseWhatsminerHealth, type DeviceHealth } from "../core/diagnose/parse";
import { lookupSpec } from "../core/devices/catalog";
import { buildRequest } from "../core/cgminer/protocol";
import { pollDevice } from "../core/monitor/poller";
import { pollAll } from "../core/monitor/scheduler";
import { runBulk } from "../core/bulk/engine";
import { evaluateAlerts, type Alert } from "../core/alerts/rules";
import { evaluateRecovery, DEFAULT_RECOVERY, type RecoverySettings } from "../core/recovery/rules";
import type { DeviceRepo } from "./db/repo";

export interface ServiceDeps {
  repo: DeviceRepo;
  transport: Transport;
  encrypt: (plain: string) => Buffer;
  decrypt: (enc: Buffer) => string;
  emitStatuses: (s: DeviceStatus[]) => void;
  emitAlerts: (a: Alert[]) => void;
  now: () => number;
}

export interface ServiceConfig {
  pollIntervalMs: number;
  maxConcurrency: number;
  warnTempC: number;
  overheatC: number;
  hashDropFrac: number;
}

/** Max auto-reboots while a device stays in one offline episode (resets when it returns). */
const MAX_REBOOTS_PER_EPISODE = 2;

/** A device must stay offline this long before an offline alert fires (and it
 *  fires only once per episode) — so a brief connection flap doesn't spam a
 *  notification every poll. */
const OFFLINE_ALERT_CONFIRM_MS = 60_000;

export const DEFAULT_CONFIG: ServiceConfig = {
  pollIntervalMs: 10_000,
  // Poll fewer miners at once: Whatsminer (and cheap site routers) drop
  // connections under a burst, which showed up as healthy miners flapping offline.
  maxConcurrency: 10,
  warnTempC: 80,
  overheatC: 90,
  hashDropFrac: 0.7,
};

export interface Snapshot {
  sites: Site[];
  devices: Device[];
  statuses: DeviceStatus[];
}

export class MiningService {
  private latest = new Map<string, DeviceStatus>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private recovery: RecoverySettings = DEFAULT_RECOVERY;
  private offlineSince = new Map<string, number>();
  private lastRecoveryAt = new Map<string, number>();
  private rebootAttempts = new Map<string, number>();
  // For the debounced offline alert: when the current offline episode began, and
  // whether we've already alerted for it.
  private offlineAlertSince = new Map<string, number>();
  private offlineAlerted = new Set<string>();

  constructor(
    private deps: ServiceDeps,
    private config: ServiceConfig = DEFAULT_CONFIG,
  ) {}

  /** Configure self-healing (auto reboot offline / stop overheating). Resets the
   *  per-device timing state so windows restart cleanly under the new settings. */
  setRecovery(s: RecoverySettings): void {
    this.recovery = s;
    this.offlineSince.clear();
    this.lastRecoveryAt.clear();
    this.rebootAttempts.clear();
  }

  getSnapshot(): Snapshot {
    return {
      sites: this.deps.repo.listSites(),
      devices: this.deps.repo.listDevices(),
      statuses: [...this.latest.values()],
    };
  }

  addSite(site: Site): void {
    this.deps.repo.upsertSite(site);
  }

  addDevice(device: Device, secret?: string): void {
    this.deps.repo.upsertDevice(device);
    if (secret !== undefined && secret !== "")
      this.deps.repo.setSecret(device.id, this.deps.encrypt(secret));
  }

  deleteDevice(id: string): void {
    this.deps.repo.deleteDevice(id);
    this.latest.delete(id);
  }

  private secretFor(deviceId: string): string | undefined {
    const enc = this.deps.repo.getSecret(deviceId);
    return enc ? this.deps.decrypt(enc) : undefined;
  }

  async sendCommand(
    deviceId: string,
    command: ControlCommand,
    params?: CommandParams,
  ): Promise<CommandOutcome> {
    const device = this.deps.repo.listDevices().find((d) => d.id === deviceId);
    if (!device) return { deviceId, ok: false, error: "device not found" };
    // "diagnose" isn't a driver op — read the miner's stats here (this agent is on
    // the miner's LAN) and return the parsed health so a remote viewer can see it.
    if (command === "diagnose") return this.diagnose(device);
    return getDriver(device.firmware).execute(
      device,
      command,
      this.deps.transport,
      resolveSecret(device.firmware, this.secretFor(deviceId)),
      params,
    );
  }

  /** Read per-board health from the device and return DeviceHealth JSON in `data`.
   *  Whatsminer uses a different API schema than cgminer (edevs/devs + summary), so it
   *  gets a dedicated parser; everything else uses the cgminer `stats` path. */
  private async diagnose(device: Device): Promise<CommandOutcome> {
    const ask = async (cmd: string): Promise<string> => {
      try {
        return await this.deps.transport.tcp4028(device.host, device.apiPort, buildRequest(cmd));
      } catch {
        return "";
      }
    };
    let health: DeviceHealth;
    let reached = false;
    let rawSample = "";
    if (device.firmware === "whatsminer") {
      const summary = await ask("summary");
      let devs = await ask("edevs");
      health = parseWhatsminerHealth(devs, summary);
      if (health.boards.length === 0) {
        const alt = await ask("devs");
        const h2 = parseWhatsminerHealth(alt, summary);
        if (h2.boards.length > 0) health = h2;
        if (alt) devs = alt;
      }
      reached = !!(devs || summary);
      rawSample = devs || summary;
    } else {
      const stats = await ask("stats");
      health = parseDeviceHealth(stats);
      let combined = "";
      if (health.boards.length === 0) {
        combined = await ask("summary+stats+pools");
        const h2 = parseDeviceHealth(combined);
        if (h2.boards.length > 0) health = h2;
      }
      reached = !!(stats || combined);
      rawSample = stats || combined;
    }
    if (!reached) return { deviceId: device.id, ok: false, error: "ما قدر يوصل الجهاز" };
    // Attach what we know about this model (vendor, cooling, rated hashrate) so the
    // viewer shows accurate, model-aware diagnostics.
    const spec = lookupSpec(device.model) ?? lookupSpec(device.name);
    // Reached the device but parsed no boards → attach a trimmed raw sample so the
    // failure is never silent (and the exact fields can be added if a firmware differs).
    const raw =
      health.boards.length === 0 ? rawSample.replace(/\0/g, "").slice(0, 600) : undefined;
    return {
      deviceId: device.id,
      ok: true,
      data: JSON.stringify({ ...health, spec, ...(raw ? { raw } : {}) }),
    };
  }

  async sendBulk(
    deviceIds: string[],
    command: ControlCommand,
    params?: CommandParams,
  ): Promise<CommandOutcome[]> {
    const all = this.deps.repo.listDevices();
    const targets = all.filter((d) => deviceIds.includes(d.id));
    return runBulk(targets, command, { maxConcurrency: this.config.maxConcurrency }, (d) =>
      getDriver(d.firmware).execute(
        d,
        command,
        this.deps.transport,
        resolveSecret(d.firmware, this.secretFor(d.id)),
        params,
      ),
    );
  }

  async pollOnce(): Promise<DeviceStatus[]> {
    const devices = this.deps.repo.listDevices();
    const now = this.deps.now();
    const statuses = await pollAll(
      devices,
      { maxConcurrency: this.config.maxConcurrency, warnTempC: this.config.warnTempC, now },
      (d) => pollDevice(d, this.deps.transport, now),
    );
    const nameById = new Map(devices.map((d) => [d.id, d.name]));
    const alerts: Alert[] = [];
    for (const s of statuses) {
      const name = nameById.get(s.deviceId) ?? s.deviceId;
      const prev = this.latest.get(s.deviceId);
      if (prev)
        alerts.push(
          ...evaluateAlerts(
            prev,
            s,
            { overheatC: this.config.overheatC, hashDropFrac: this.config.hashDropFrac },
            name,
          ),
        );
      // Debounced offline alert: a device must stay offline for the confirm
      // window before we notify (filters brief flaps), and we notify once.
      if (s.state === "offline") {
        const since = this.offlineAlertSince.get(s.deviceId) ?? now;
        if (!this.offlineAlertSince.has(s.deviceId)) this.offlineAlertSince.set(s.deviceId, now);
        if (now - since >= OFFLINE_ALERT_CONFIRM_MS && !this.offlineAlerted.has(s.deviceId)) {
          this.offlineAlerted.add(s.deviceId);
          alerts.push({ deviceId: s.deviceId, kind: "offline", message: `${name} غير متصل` });
        }
      } else {
        this.offlineAlertSince.delete(s.deviceId);
        this.offlineAlerted.delete(s.deviceId);
      }
      this.latest.set(s.deviceId, s);
    }
    this.deps.emitStatuses(statuses);
    if (alerts.length) this.deps.emitAlerts(alerts);
    await this.runRecovery(statuses, devices, now);
    return statuses;
  }

  /** Self-healing: auto-reboot devices offline too long, stop overheating ones.
   *  Caps reboots per offline episode and only starts the cooldown on a
   *  successfully-dispatched command (so a failed action retries next poll). */
  private async runRecovery(statuses: DeviceStatus[], devices: Device[], now: number): Promise<void> {
    if (!this.recovery.enabled) return;
    for (const s of statuses) {
      if (s.state === "offline") {
        if (!this.offlineSince.has(s.deviceId)) this.offlineSince.set(s.deviceId, now);
      } else {
        this.offlineSince.delete(s.deviceId);
        this.rebootAttempts.delete(s.deviceId); // back online — reset attempts
      }
      const decision = evaluateRecovery(
        s,
        this.offlineSince.get(s.deviceId) ?? null,
        this.lastRecoveryAt.get(s.deviceId) ?? null,
        this.recovery,
        now,
      );
      if (!decision.action) continue;
      // Stop hammering a device that won't come back: cap reboots per episode.
      if (decision.action === "reboot" && (this.rebootAttempts.get(s.deviceId) ?? 0) >= MAX_REBOOTS_PER_EPISODE) {
        continue;
      }
      const name = devices.find((d) => d.id === s.deviceId)?.name ?? s.deviceId;
      const label = decision.action === "reboot" ? "إعادة تشغيل" : "إيقاف وقائي";
      const outcome = await this.sendCommand(s.deviceId, decision.action);
      if (outcome.ok) {
        this.lastRecoveryAt.set(s.deviceId, now);
        if (decision.action === "reboot")
          this.rebootAttempts.set(s.deviceId, (this.rebootAttempts.get(s.deviceId) ?? 0) + 1);
        this.deps.emitAlerts([
          { deviceId: s.deviceId, kind: "recovery", message: `🤖 إصلاح ذاتي: ${label} لـ ${name} (${decision.reason})` },
        ]);
      } else {
        // Don't start the cooldown on failure — retry next poll, and surface it.
        this.deps.emitAlerts([
          { deviceId: s.deviceId, kind: "recovery", message: `⚠️ فشل الإصلاح الذاتي (${label}) لـ ${name}: ${outcome.error ?? ""}` },
        ]);
      }
    }
  }

  startMonitoring(): void {
    if (this.timer) return;
    void this.pollOnce();
    this.timer = setInterval(() => void this.pollOnce(), this.config.pollIntervalMs);
  }

  stopMonitoring(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
