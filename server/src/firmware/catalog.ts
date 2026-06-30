import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Firmware } from "../../../src/core/model/device";

/** One uploaded firmware image, hosted + signed by the server (like app-updates). */
export interface FirmwareEntry {
  id: string;
  family: Firmware; // stock | braiins | luxos (whatsminer/vnish accepted but flashing is refused/limited)
  model: string; // target model string the agent must match before flashing
  version: string;
  file: string; // filename under dataDir/firmware/
  sha256: string;
  size: number;
  sig: string; // Ed25519 over family:model:version:sha256:size:uploadedAt:file
  uploadedAt: number;
}

function catalogPath(dataDir: string): string {
  return join(dataDir, "firmware", "catalog.json");
}

export function readCatalog(dataDir: string): FirmwareEntry[] {
  try {
    const p = catalogPath(dataDir);
    if (!existsSync(p)) return [];
    const j = JSON.parse(readFileSync(p, "utf8")) as unknown;
    return Array.isArray(j) ? (j as FirmwareEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendCatalog(dataDir: string, entry: FirmwareEntry): void {
  const all = [entry, ...readCatalog(dataDir)];
  const p = catalogPath(dataDir);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(all, null, 2), "utf8"); // atomic
  renameSync(tmp, p);
}

export function firmwareById(dataDir: string, id: string): FirmwareEntry | undefined {
  return readCatalog(dataDir).find((e) => e.id === id);
}

/** Coarse server-side model match (the agent does the authoritative catalog check
 *  incl. cooling/board count before flashing). Normalises case/spaces and requires
 *  one to contain the other so an unrelated model never even gets queued. */
export function modelMatches(deviceModel: string, fwModel: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
  const d = norm(deviceModel);
  const f = norm(fwModel);
  if (!d || !f) return false;
  return d === f || d.includes(f) || f.includes(d);
}
