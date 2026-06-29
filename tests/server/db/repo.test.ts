import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../../server/src/db/schema";
import { ServerRepo } from "../../../server/src/db/repo";

describe("ServerRepo", () => {
  it("creates a user, scopes sites/devices, and stores status", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const repo = new ServerRepo(db);
    const uid = repo.createUser("a@b.com", "hash");
    expect(repo.findUserByEmail("a@b.com")?.id).toBe(uid);
    repo.upsertSite({ id: "s1", userId: uid, name: "الرياض" });
    repo.upsertDevice({
      id: "d1",
      userId: uid,
      siteId: "s1",
      agentId: "ag1",
      name: "S19-01",
      model: "S19",
      firmware: "stock",
      host: "192.168.1.50",
      apiPort: 4028,
      controlPort: 80,
    });
    expect(repo.listDevices(uid)).toHaveLength(1);
    repo.upsertStatus(uid, {
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
    });
    expect(repo.listStatuses(uid)[0]?.state).toBe("online");
    expect(repo.deviceAgent(uid, "d1")).toBe("ag1");
  });

  it("isolates data between users", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const repo = new ServerRepo(db);
    const u1 = repo.createUser("u1@b.com", "h");
    const u2 = repo.createUser("u2@b.com", "h");
    repo.upsertSite({ id: "s1", userId: u1, name: "site" });
    repo.upsertDevice({
      id: "d1",
      userId: u1,
      siteId: "s1",
      agentId: "ag1",
      name: "n",
      model: "S19",
      firmware: "stock",
      host: "h",
      apiPort: 4028,
      controlPort: 80,
    });
    expect(repo.listDevices(u1)).toHaveLength(1);
    expect(repo.listDevices(u2)).toHaveLength(0);
  });
});
