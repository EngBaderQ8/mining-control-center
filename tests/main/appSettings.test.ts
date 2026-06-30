import { describe, it, expect } from "vitest";
import { AppSettingsStore } from "../../src/main/appSettings";
import { DEFAULT_APP_SETTINGS } from "../../src/shared/api";

describe("AppSettingsStore", () => {
  it("returns defaults with no backing file", () => {
    const s = new AppSettingsStore();
    expect(s.get()).toEqual(DEFAULT_APP_SETTINGS);
  });

  it("merges a partial update and coerces to booleans", () => {
    const s = new AppSettingsStore();
    const next = s.set({ launchAtStartup: 1 as unknown as boolean });
    expect(next.launchAtStartup).toBe(true);
    expect(typeof next.runInBackground).toBe("boolean");
  });

  it("forces startMinimized off when runInBackground is off (can't start hidden with no background)", () => {
    const s = new AppSettingsStore();
    const next = s.set({ startMinimized: true, runInBackground: false });
    expect(next.runInBackground).toBe(false);
    expect(next.startMinimized).toBe(false);
  });

  it("keeps startMinimized when background is on", () => {
    const s = new AppSettingsStore();
    const next = s.set({ startMinimized: true, runInBackground: true });
    expect(next.startMinimized).toBe(true);
  });
});
