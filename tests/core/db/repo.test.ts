import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../../src/main/db/schema";
import { DeviceRepo } from "../../../src/main/db/repo";

describe("DeviceRepo", () => {
  it("round-trips sites and devices", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const repo = new DeviceRepo(db);
    repo.upsertSite({ id: "s1", name: "الرياض" });
    repo.upsertDevice({
      id: "d1",
      siteId: "s1",
      name: "S19-01",
      model: "S19",
      firmware: "stock",
      host: "100.64.0.5",
      apiPort: 4028,
      controlPort: 80,
    });
    expect(repo.listSites()).toHaveLength(1);
    expect(repo.listDevices()[0]?.name).toBe("S19-01");
  });

  it("updates on conflicting id and deletes", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const repo = new DeviceRepo(db);
    repo.upsertSite({ id: "s1", name: "الرياض" });
    repo.upsertDevice({
      id: "d1",
      siteId: "s1",
      name: "old",
      model: "S19",
      firmware: "stock",
      host: "h",
      apiPort: 4028,
      controlPort: 80,
    });
    repo.upsertDevice({
      id: "d1",
      siteId: "s1",
      name: "new",
      model: "S19",
      firmware: "vnish",
      host: "h",
      apiPort: 4028,
      controlPort: 80,
    });
    expect(repo.listDevices()).toHaveLength(1);
    expect(repo.listDevices()[0]?.name).toBe("new");
    expect(repo.listDevices()[0]?.firmware).toBe("vnish");
    repo.deleteDevice("d1");
    expect(repo.listDevices()).toHaveLength(0);
  });
});
