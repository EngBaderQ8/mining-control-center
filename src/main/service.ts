import type { Device, DeviceStatus, Site } from "../core/model/device";
import type { CommandOutcome } from "../core/model/result";
import type { Transport, ControlCommand, CommandParams } from "../core/drivers/types";
import { getDriver } from "../core/drivers/registry";
import { resolveSecret } from "../core/drivers/defaults";
import { parseDeviceHealth } from "../core/diagnose/parse";
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

export const DEFAULT_CONFIG: ServiceConfig = {
  pollIntervalMs: 10_000,
  maxConcurrency: 16,
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

  /** Read `stats` from the device and return DeviceHealth JSON in `data`. */
  private async diagnose(device: Device): Promise<CommandOutcome> {
    const ask = async (cmd: string): Promise<string> => {
      try {
        return await this.deps.transport.tcp4028(device.host, device.apiPort, buildRequest(cmd));
      } catch {
        return "";
      }
    };
    const stats = await ask("stats");
    let health = parseDeviceHealth(stats);
    if (health.boards.length === 0) {
      const combined = await ask("summary+stats+pools");
      const h2 = parseDeviceHealth(combined);
      if (h2.boards.length > 0) health = h2;
    }
    if (!stats && health.boards.length === 0)
      return { deviceId: device.id, ok: false, error: "ما قدر يوصل الجهاز" };
    return { deviceId: device.id, ok: true, data: JSON.stringify(health) };
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
    const alerts: Alert[] = [];
    for (const s of statuses) {
      const prev = this.latest.get(s.deviceId);
      if (prev)
        alerts.push(
          ...evaluateAlerts(prev, s, {
            overheatC: this.config.overheatC,
            hashDropFrac: this.config.hashDropFrac,
          }),
        );
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
