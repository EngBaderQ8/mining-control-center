import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_RECOVERY, type RecoverySettings } from "../../core/recovery/rules";

/** Persistent self-healing settings for this install. */
export class RecoveryConfig {
  private state: RecoverySettings;

  constructor(private path?: string) {
    let loaded: Partial<RecoverySettings> = {};
    if (path && existsSync(path)) {
      try {
        loaded = JSON.parse(readFileSync(path, "utf8")) as Partial<RecoverySettings>;
      } catch {
        loaded = {};
      }
    }
    this.state = { ...DEFAULT_RECOVERY, ...loaded };
  }

  get(): RecoverySettings {
    return { ...this.state };
  }

  set(s: RecoverySettings): void {
    // Clamp so a bad value (e.g. cooldown 0 → action storm, offline 0 → instant
    // reboot loop) can never be persisted or reach the engine.
    const clamp = (n: number, lo: number, hi: number, d: number): number =>
      Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d;
    this.state = {
      enabled: !!s.enabled,
      rebootOfflineMin: clamp(s.rebootOfflineMin, 1, 1440, DEFAULT_RECOVERY.rebootOfflineMin),
      cooldownMin: clamp(s.cooldownMin, 1, 1440, DEFAULT_RECOVERY.cooldownMin),
      overheatStopC: clamp(s.overheatStopC, 50, 120, DEFAULT_RECOVERY.overheatStopC),
    };
    this.persist();
  }

  private persist(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.state, null, 2), "utf8");
    } catch {
      /* best-effort */
    }
  }
}
