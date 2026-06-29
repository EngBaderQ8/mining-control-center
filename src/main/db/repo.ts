import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Device, Site } from "../../core/model/device";

interface DbShape {
  sites: Site[];
  devices: Device[];
  secrets: Record<string, string>; // deviceId -> base64(encrypted)
}

const EMPTY: DbShape = { sites: [], devices: [], secrets: {} };

/**
 * Tiny persistent store for the device/site registry, backed by a JSON file.
 * The dataset is small (a handful of sites + devices), so SQL/native modules
 * are unnecessary — this keeps the app free of native-ABI coupling.
 *
 * Pass a file path to persist; omit it for an in-memory store (used in tests).
 */
export class DeviceRepo {
  private data: DbShape;

  constructor(private path?: string) {
    this.data = { ...EMPTY, sites: [], devices: [], secrets: {} };
    if (path && existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DbShape>;
        this.data = {
          sites: parsed.sites ?? [],
          devices: parsed.devices ?? [],
          secrets: parsed.secrets ?? {},
        };
      } catch {
        // Corrupt/unreadable file — start from an empty store rather than crash.
        this.data = { sites: [], devices: [], secrets: {} };
      }
    }
  }

  private persist(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf8");
  }

  upsertSite(s: Site): void {
    const i = this.data.sites.findIndex((x) => x.id === s.id);
    if (i >= 0) this.data.sites[i] = s;
    else this.data.sites.push(s);
    this.persist();
  }

  upsertDevice(d: Device): void {
    const i = this.data.devices.findIndex((x) => x.id === d.id);
    if (i >= 0) this.data.devices[i] = d;
    else this.data.devices.push(d);
    this.persist();
  }

  listSites(): Site[] {
    return [...this.data.sites];
  }

  listDevices(): Device[] {
    return [...this.data.devices];
  }

  deleteDevice(id: string): void {
    this.data.devices = this.data.devices.filter((d) => d.id !== id);
    delete this.data.secrets[id];
    this.persist();
  }

  deleteSite(siteId: string): void {
    for (const d of this.data.devices.filter((x) => x.siteId === siteId))
      delete this.data.secrets[d.id];
    this.data.devices = this.data.devices.filter((d) => d.siteId !== siteId);
    this.data.sites = this.data.sites.filter((s) => s.id !== siteId);
    this.persist();
  }

  setSecret(deviceId: string, enc: Buffer): void {
    this.data.secrets[deviceId] = enc.toString("base64");
    this.persist();
  }

  getSecret(deviceId: string): Buffer | null {
    const b64 = this.data.secrets[deviceId];
    return b64 ? Buffer.from(b64, "base64") : null;
  }
}
