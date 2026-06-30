import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../../server/src/db/schema";
import { ServerRepo } from "../../../server/src/db/repo";
import { CommandRouter } from "../../../server/src/router/commandRouter";
import { ConnectionHub } from "../../../server/src/ws/hub";
import { FlashSequencer } from "../../../server/src/firmware/sequencer";
import type { ServerMessage } from "../../../server/src/protocol/messages";

function setup() {
  const db = new Database(":memory:");
  applySchema(db);
  const repo = new ServerRepo(db);
  const uid = repo.createUser("a@b.com", "h");
  const router = new CommandRouter();
  const flashSequencer = new FlashSequencer(repo, router, ":memory:");
  const broadcasts: ServerMessage[] = [];
  return {
    repo,
    router,
    uid,
    broadcasts,
    flashSequencer,
    broadcast: (_u: string, m: ServerMessage) => broadcasts.push(m),
  };
}

describe("ConnectionHub", () => {
  it("registers an agent + device, then a viewer command routes to the agent", async () => {
    const { repo, router, uid, broadcast, flashSequencer } = setup();
    const agentSent: ServerMessage[] = [];
    const agentHub = new ConnectionHub(uid, (m) => agentSent.push(m), repo, router, broadcast, flashSequencer);
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
    const viewerHub = new ConnectionHub(uid, (m) => viewerSent.push(m), repo, router, broadcast, flashSequencer);
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
    const { repo, router, uid, broadcast, flashSequencer } = setup();
    const sent: ServerMessage[] = [];
    const hub = new ConnectionHub(uid, (m) => sent.push(m), repo, router, broadcast, flashSequencer);
    await hub.handleMessage({ type: "command.send", commandId: "x", deviceId: "ghost", command: "reboot" });
    expect(sent[0]).toMatchObject({ type: "command.ack", outcome: { ok: false } });
  });

  it("broadcasts a live snapshot when a NEW site/device registers, but stays silent on identical reconnect re-register", async () => {
    const { repo, router, uid, broadcast, broadcasts, flashSequencer } = setup();
    const hub = new ConnectionHub(uid, () => {}, repo, router, broadcast, flashSequencer);
    const device = {
      id: "d1", siteId: "s1", name: "n", model: "S19",
      firmware: "stock" as const, host: "h", apiPort: 4028, controlPort: 80,
    };
    await hub.handleMessage({ type: "agent.hello", agentId: "ag1", name: "salamat" });
    await hub.handleMessage({ type: "site.register", site: { id: "s1", name: "salamat" } });
    await hub.handleMessage({ type: "device.register", device });
    // New site + new device → each pushed a fresh snapshot to viewers.
    expect(broadcasts.filter((m) => m.type === "snapshot").length).toBe(2);

    // Re-registering the SAME site + device (what every reconnect does) must not
    // re-broadcast — otherwise a 57-device agent would storm viewers on reconnect.
    const before = broadcasts.length;
    await hub.handleMessage({ type: "site.register", site: { id: "s1", name: "salamat" } });
    await hub.handleMessage({ type: "device.register", device });
    expect(broadcasts.length).toBe(before);

    // A real change (renamed worker host) does broadcast again.
    await hub.handleMessage({ type: "device.register", device: { ...device, host: "h2" } });
    expect(broadcasts.length).toBe(before + 1);
  });

  it("renames a site: updates the DB and broadcasts the rename (to the owning agent) + a snapshot", async () => {
    const { repo, router, uid, broadcast, broadcasts, flashSequencer } = setup();
    const hub = new ConnectionHub(uid, () => {}, repo, router, broadcast, flashSequencer);
    repo.upsertSite({ id: "s1", userId: uid, name: "old" });
    await hub.handleMessage({ type: "site.rename", siteId: "s1", name: "new name" });
    expect(repo.listSites(uid)[0]!.name).toBe("new name");
    expect(broadcasts.some((m) => m.type === "site.rename" && m.name === "new name")).toBe(true);
    expect(broadcasts.some((m) => m.type === "snapshot")).toBe(true);
    // Renaming a site that doesn't exist / to empty does nothing.
    const before = broadcasts.length;
    await hub.handleMessage({ type: "site.rename", siteId: "nope", name: "x" });
    await hub.handleMessage({ type: "site.rename", siteId: "s1", name: "  " });
    expect(broadcasts.length).toBe(before);
  });

  it("deletes a device and a site, broadcasting a fresh snapshot", async () => {
    const { repo, router, uid, broadcast, broadcasts, flashSequencer } = setup();
    const hub = new ConnectionHub(uid, () => {}, repo, router, broadcast, flashSequencer);
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
    const { repo, router, uid, broadcast, broadcasts, flashSequencer } = setup();
    const sent: ServerMessage[] = [];
    const hub = new ConnectionHub(uid, (m) => sent.push(m), repo, router, broadcast, flashSequencer);
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

  it("isolates flashing by tenant: agentId binding + userId-scoped flash.result", async () => {
    const { repo, router, uid, broadcast, flashSequencer } = setup();
    // Owner u1 registers agent ag1 and has a job j1 currently mid-flash.
    const owner = new ConnectionHub(uid, () => {}, repo, router, broadcast, flashSequencer);
    await owner.handleMessage({ type: "agent.hello", agentId: "ag1", name: "site1" });
    expect(repo.agentOwner("ag1")).toBe(uid);
    repo.createFlashJobs([
      { jobId: "j1", batchId: "bb", userId: uid, deviceId: "d1", agentId: "ag1", firmwareId: "fw" },
    ]);
    repo.claimQueuedJob("j1"); // -> flashing

    // Attacker u2 (own valid session) cannot claim u1's agentId...
    const u2 = repo.createUser("evil@x.com", "h");
    const attacker = new ConnectionHub(u2, () => {}, repo, router, broadcast, flashSequencer);
    await attacker.handleMessage({ type: "agent.hello", agentId: "ag1", name: "spoof" });
    expect(repo.agentOwner("ag1")).toBe(uid); // binding held — still u1's agent
    // ...and cannot post a terminal result for u1's job.
    await attacker.handleMessage({
      type: "flash.result",
      jobId: "j1",
      deviceId: "d1",
      state: "success",
      newVersion: "evil",
    });
    expect(repo.getFlashJob("j1")!.state).toBe("flashing"); // spoof blocked

    // The legitimate owner's own result IS applied.
    await owner.handleMessage({
      type: "flash.result",
      jobId: "j1",
      deviceId: "d1",
      state: "success",
      newVersion: "v2",
    });
    expect(repo.getFlashJob("j1")!.state).toBe("success");
  });

  it("ignores status for a device not owned by the user (no spoofing)", async () => {
    const { repo, router, uid, broadcast, broadcasts, flashSequencer } = setup();
    const hub = new ConnectionHub(uid, () => {}, repo, router, broadcast, flashSequencer);
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
