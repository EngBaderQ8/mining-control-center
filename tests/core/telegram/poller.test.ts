import { describe, it, expect } from "vitest";
import { handleBotMessage, type BotContext } from "../../../src/main/alerts/botPoller";
import type { Device, Site } from "../../../src/core/model/device";

const sites: Site[] = [
  { id: "s1", name: "الرياض" },
  { id: "s2", name: "جدة" },
];
const mk = (id: string, siteId: string, name: string): Device => ({
  id,
  siteId,
  name,
  model: "S19",
  firmware: "stock",
  host: "h",
  apiPort: 4028,
  controlPort: 80,
});
const devices: Device[] = [
  mk("d1", "s1", "Antminer S19-101"),
  mk("d2", "s1", "Antminer S19-105"),
  mk("d3", "s2", "Antminer S19-201"),
];

function ctx(sent: Array<{ id: string; cmd: string }>): BotContext {
  return {
    getSettings: () => ({ enabled: true, token: "t", chatId: "c" }),
    getSnapshot: () => ({ sites, devices, statuses: [] }),
    sendCommand: async (id, cmd) => {
      sent.push({ id, cmd });
      return { deviceId: id, ok: true };
    },
    getNetworkStats: async () => ({ priceUsd: 60000, difficulty: 9e13, blockRewardBtc: 3.125 }),
  };
}

describe("handleBotMessage", () => {
  it("stops a single device matched by its number", async () => {
    const sent: Array<{ id: string; cmd: string }> = [];
    const reply = await handleBotMessage("أوقف 105", ctx(sent));
    expect(sent).toEqual([{ id: "d2", cmd: "stopMining" }]);
    expect(reply).toContain("نجح 1/1");
  });

  it("controls a whole site by name", async () => {
    const sent: Array<{ id: string; cmd: string }> = [];
    await handleBotMessage("ريبوت الرياض", ctx(sent));
    expect(sent.map((s) => s.id).sort()).toEqual(["d1", "d2"]); // both Riyadh devices
    expect(sent.every((s) => s.cmd === "reboot")).toBe(true);
  });

  it("controls all devices", async () => {
    const sent: Array<{ id: string; cmd: string }> = [];
    await handleBotMessage("أوقف الكل", ctx(sent));
    expect(sent).toHaveLength(3);
  });

  it("lists sites and shows help", async () => {
    const sites = await handleBotMessage("المواقع", ctx([]));
    expect(sites).toContain("الرياض");
    expect(sites).toContain("جدة");
    const help = await handleBotMessage("مساعدة", ctx([]));
    expect(help).toContain("الوضع");
  });

  it("replies clearly when the target is unknown", async () => {
    const sent: Array<{ id: string; cmd: string }> = [];
    const reply = await handleBotMessage("أوقف 999", ctx(sent));
    expect(sent).toHaveLength(0);
    expect(reply).toContain("ما لقيت");
  });
});
