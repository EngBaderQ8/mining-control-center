import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "../shared/api";

/** Persistent desktop-behavior settings (startup, background/tray, etc.). */
export class AppSettingsStore {
  private state: AppSettings;

  constructor(private path?: string) {
    let loaded: Partial<AppSettings> = {};
    if (path && existsSync(path)) {
      try {
        const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
        // Only merge a real object — a bare string/number/array would spread junk.
        if (raw && typeof raw === "object" && !Array.isArray(raw)) loaded = raw as Partial<AppSettings>;
      } catch {
        loaded = {};
      }
    }
    this.state = this.coerce({ ...DEFAULT_APP_SETTINGS, ...loaded });
  }

  /** Coerce to booleans and reconcile dependencies (can't start hidden unless
   *  it's allowed to run in the background). */
  private coerce(s: AppSettings): AppSettings {
    const runInBackground = !!s.runInBackground;
    return {
      launchAtStartup: !!s.launchAtStartup,
      runInBackground,
      startMinimized: runInBackground ? !!s.startMinimized : false,
    };
  }

  get(): AppSettings {
    return { ...this.state };
  }

  /** Merge a partial update, coerce/reconcile, persist, and return the result. */
  set(partial: Partial<AppSettings>): AppSettings {
    this.state = this.coerce({ ...this.state, ...partial });
    this.persist();
    return this.get();
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
