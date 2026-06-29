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
    this.state = { ...DEFAULT_RECOVERY, ...s };
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
