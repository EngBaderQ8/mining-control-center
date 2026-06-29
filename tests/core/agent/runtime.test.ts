import { describe, it, expect } from "vitest";
import { AgentRuntime, type ServerConnection } from "../../../src/main/agent/runtime";
import type { ClientMessage, ServerMessage } from "../../../src/shared/protocol";
import type { Device } from "../../../src/core/model/device";

const dev: Device = {
  id: "d1",
  siteId: "s1",
  name: "n",
  model: "S19",
  firmware: "stock",
  host: "192.168.1.5",
  apiPort: 4028,
  controlPort: 80,
};

function fakeConn() {
  const sent: ClientMessage[] = [];
  const handlers: ((m: ServerMessage) => void)[] = [];
  const conn: ServerConnection = {
    send: (m) => sent.push(m),
    onMessage: (h) => handlers.push(h),
  };
  return { conn, sent, handlers, emit: (m: ServerMessage) => handlers.forEach((h) => h(m)) };
}

describe("AgentRuntime", () => {
  it("registers devices on start and answers command.exec with a result", async () => {
    const f = fakeConn();
    const calls: string[] = [];
    const rt = new AgentRuntime({
      agentId: "ag1",
      agentName: "site1",
      conn: f.conn,
      listDevices: () => [dev],
      execute: async (deviceId, command) => {
        calls.push(`${deviceId}:${command}`);
        return { deviceId, ok: true };
      },
    });
    rt.start();
    expect(f.sent[0]).toMatchObject({ type: "agent.hello", agentId: "ag1" });
    expect(f.sent.find((m) => m.type === "device.register")).toMatchObject({ type: "device.register" });

    f.emit({ type: "command.exec", commandId: "c1", deviceId: "d1", command: "reboot" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["d1:reboot"]);
    expect(f.sent.find((m) => m.type === "command.result")).toMatchObject({
      type: "command.result",
      commandId: "c1",
      outcome: { ok: true },
    });
  });

  it("announce() re-registers WITHOUT subscribing another handler (no reconnect leak)", () => {
    const f = fakeConn();
    const rt = new AgentRuntime({
      agentId: "ag1",
      agentName: "site1",
      conn: f.conn,
      listSites: () => [],
      listDevices: () => [dev],
      execute: async () => ({ deviceId: "d1", ok: true }),
    });
    rt.start();
    rt.announce(); // simulate a reconnect re-announce
    rt.announce();
    // Still exactly one message handler despite multiple announces.
    expect(f.handlers).toHaveLength(1);
    // Each announce re-sent agent.hello.
    expect(f.sent.filter((m) => m.type === "agent.hello")).toHaveLength(3);
  });

  it("pushStatuses sends a status.update", () => {
    const f = fakeConn();
    const rt = new AgentRuntime({
      agentId: "ag1",
      agentName: "s",
      conn: f.conn,
      listDevices: () => [],
      execute: async () => ({ deviceId: "x", ok: true }),
    });
    rt.pushStatuses([
      {
        deviceId: "d1",
        state: "online",
        hashrateTHs: 95,
        avgHashrateTHs: 95,
        maxTempC: 60,
        fanRpm: 4000,
        pool: "p",
        worker: "w",
        hwErrorRate: 0,
        uptimeSec: 1,
        lastSeen: 1,
      },
    ]);
    expect(f.sent[0]).toMatchObject({ type: "status.update" });
  });
});
