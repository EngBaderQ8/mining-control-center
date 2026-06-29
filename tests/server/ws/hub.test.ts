import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../../server/src/db/schema";
import { ServerRepo } from "../../../server/src/db/repo";
import { CommandRouter } from "../../../server/src/router/commandRouter";
import { ConnectionHub } from "../../../server/src/ws/hub";
import type { ServerMessage } from "../../../server/src/protocol/messages";

function setup() {
  const db = new Database(":memory:");
  applySchema(db);
  const repo = new ServerRepo(db);
  const uid = repo.createUser("a@b.com", "h");
  const router = new CommandRouter();
  const broadcasts: ServerMessage[] = [];
  return {
    repo,
    router,
    uid,
    broadcasts,
    broadcast: (_u: string, m: ServerMessage) => broadcasts.push(m),
  };
}

describe("ConnectionHub", () => {
  it("registers an agent + device, then a viewer command routes to the agent", async () => {
    const { repo, router, uid, broadcast } = setup();
    const agentSent: ServerMessage[] = [];
    const agentHub = new ConnectionHub(uid, (m) => agentSent.push(m), repo, router, broadcast);
    await agentHub.handleMessage({ type: "agent.hello", agentId: "ag1", name: "site1" });
    await agentHub.handleMessage({
      type: "device.register",
      device: {
        id: "d1",
        siteId: "s1",
        name: "S19",
        model: "S19",
        firmware: "stock",
        host: "192.168.1.50",
        apiPort: 4028,
        controlPort: 80,
      },
    });
    repo.upsertSite({ id: "s1", userId: uid, name: "site1" });

    const viewerSent: ServerMessage[] = [];
    const viewerHub = new ConnectionHub(uid, (m) => viewerSent.push(m), repo, router, broadcast);
    const done = viewerHub.handleMessage({
      type: "command.send",
      commandId: "c1",
      deviceId: "d1",
      command: "reboot",
    });

    expect(agentSent.find((m) => m.type === "command.exec")).toBeTruthy();
    await agentHub.handleMessage({
      type: "command.result",
      commandId: "c1",
      outcome: { deviceId: "d1", ok: true },
    });
    await done;
    expect(viewerSent.find((m) => m.type === "command.ack")).toMatchObject({
      type: "command.ack",
      outcome: { ok: true },
    });
  });

  it("acks failure for an unknown device", async () => {
    const { repo, router, uid, broadcast } = setup();
    const sent: ServerMessage[] = [];
    const hub = new ConnectionHub(uid, (m) => sent.push(m), repo, router, broadcast);
    await hub.handleMessage({ type: "command.send", commandId: "x", deviceId: "ghost", command: "reboot" });
    expect(sent[0]).toMatchObject({ type: "command.ack", outcome: { ok: false } });
  });

  it("deletes a device and a site, broadcasting a fresh snapshot", async () => {
    const { repo, router, uid, broadcast, broadcasts } = setup();
    const hub = new ConnectionHub(uid, () => {}, repo, router, broadcast);
    repo.upsertSite({ id: "s1", userId: uid, name: "site" });
    repo.upsertDevice({
      id: "d1", userId: uid, siteId: "s1", agentId: "ag1", name: "n", model: "S19",
      firmware: "stock", host: "h", apiPort: 4028, controlPort: 80,
    });

    await hub.handleMessage({ type: "device.delete", deviceId: "d1" });
    expect(repo.listDevices(uid)).toHaveLength(0);
    expect(broadcasts.some((m) => m.type === "snapshot")).toBe(true);

    await hub.handleMessage({ type: "site.delete", siteId: "s1" });
    expect(repo.listSites(uid)).toHaveLength(0);
  });

  it("broadcasts status updates and answers snapshot requests", async () => {
    const { repo, router, uid, broadcast, broadcasts } = setup();
    const sent: ServerMessage[] = [];
    const hub = new ConnectionHub(uid, (m) => sent.push(m), repo, router, broadcast);
    // The device must be owned by this user for its status to be accepted.
    repo.upsertDevice({
      id: "d1", userId: uid, siteId: "s1", agentId: "ag1", name: "n", model: "S19",
      firmware: "stock", host: "h", apiPort: 4028, controlPort: 80,
    });
    await hub.handleMessage({
      type: "status.update",
      statuses: [
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
      ],
    });
    expect(broadcasts.find((m) => m.type === "status.update")).toBeTruthy();
    await hub.handleMessage({ type: "snapshot.request" });
    expect(sent.find((m) => m.type === "snapshot")).toBeTruthy();
  });

  it("ignores status for a device not owned by the user (no spoofing)", async () => {
    const { repo, router, uid, broadcast, broadcasts } = setup();
    const hub = new ConnectionHub(uid, () => {}, repo, router, broadcast);
    await hub.handleMessage({
      type: "status.update",
      statuses: [
        {
          deviceId: "not-mine", state: "online", hashrateTHs: 999, avgHashrateTHs: 999,
          maxTempC: 1, fanRpm: 1, pool: "p", worker: "w", hwErrorRate: 0, uptimeSec: 1, lastSeen: 1,
        },
      ],
    });
    expect(broadcasts.find((m) => m.type === "status.update")).toBeFalsy();
    expect(repo.listStatuses(uid)).toHaveLength(0);
  });
});
