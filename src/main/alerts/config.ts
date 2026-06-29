import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface TelegramSettings {
  enabled: boolean;
  token: string;
  chatId: string;
}

const DEFAULTS: TelegramSettings = { enabled: false, token: "", chatId: "" };

/** Persistent Telegram alert settings for this install (kept local, never sent to the server). */
export class AlertConfig {
  private state: TelegramSettings;

  constructor(private path?: string) {
    let loaded: Partial<TelegramSettings> = {};
    if (path && existsSync(path)) {
      try {
        loaded = JSON.parse(readFileSync(path, "utf8")) as Partial<TelegramSettings>;
      } catch {
        loaded = {};
      }
    }
    this.state = { ...DEFAULTS, ...loaded };
  }

  get(): TelegramSettings {
    return { ...this.state };
  }

  set(s: TelegramSettings): void {
    this.state = { ...DEFAULTS, ...s };
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
