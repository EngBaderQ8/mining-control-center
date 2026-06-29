import type { Device, DeviceStatus, Site } from "../core/model/device";
import type { CommandOutcome } from "../core/model/result";
import type { Transport, ControlCommand, CommandParams } from "../core/drivers/types";
import { getDriver } from "../core/drivers/registry";
import { pollDevice } from "../core/monitor/poller";
import { pollAll } from "../core/monitor/scheduler";
import { runBulk } from "../core/bulk/engine";
import { evaluateAlerts, type Alert } from "../core/alerts/rules";
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

  constructor(
    private deps: ServiceDeps,
    private config: ServiceConfig = DEFAULT_CONFIG,
  ) {}

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
    return getDriver(device.firmware).execute(
      device,
      command,
      this.deps.transport,
      this.secretFor(deviceId),
      params,
    );
  }

  async sendBulk(
    deviceIds: string[],
    command: ControlCommand,
    params?: CommandParams,
  ): Promise<CommandOutcome[]> {
    const all = this.deps.repo.listDevices();
    const targets = all.filter((d) => deviceIds.includes(d.id));
    return runBulk(targets, command, { maxConcurrency: this.config.maxConcurrency }, (d) =>
      getDriver(d.firmware).execute(d, command, this.deps.transport, this.secretFor(d.id), params),
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
    return statuses;
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
