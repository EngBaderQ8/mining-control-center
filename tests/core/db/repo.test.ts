import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";
import { DeviceRepo } from "../../../src/main/db/repo";
import type { Device } from "../../../src/core/model/device";

const mkDevice = (over: Partial<Device> = {}): Device => ({
  id: "d1",
  siteId: "s1",
  name: "S19-01",
  model: "S19",
  firmware: "stock",
  host: "100.64.0.5",
  apiPort: 4028,
  controlPort: 80,
  ...over,
});

describe("DeviceRepo (in-memory)", () => {
  it("round-trips sites and devices", () => {
    const repo = new DeviceRepo();
    repo.upsertSite({ id: "s1", name: "الرياض" });
    repo.upsertDevice(mkDevice());
    expect(repo.listSites()).toHaveLength(1);
    expect(repo.listDevices()[0]?.name).toBe("S19-01");
  });

  it("updates on conflicting id and deletes", () => {
    const repo = new DeviceRepo();
    repo.upsertSite({ id: "s1", name: "الرياض" });
    repo.upsertDevice(mkDevice({ name: "old" }));
    repo.upsertDevice(mkDevice({ name: "new", firmware: "vnish" }));
    expect(repo.listDevices()).toHaveLength(1);
    expect(repo.listDevices()[0]?.name).toBe("new");
    expect(repo.listDevices()[0]?.firmware).toBe("vnish");
    repo.deleteDevice("d1");
    expect(repo.listDevices()).toHaveLength(0);
  });

  it("stores and reads back an encrypted secret as bytes", () => {
    const repo = new DeviceRepo();
    repo.upsertDevice(mkDevice());
    repo.setSecret("d1", Buffer.from([1, 2, 3, 250]));
    expect([...(repo.getSecret("d1") ?? [])]).toEqual([1, 2, 3, 250]);
    expect(repo.getSecret("missing")).toBeNull();
  });
});

describe("DeviceRepo (file persistence)", () => {
  it("persists to disk and reloads in a new instance", () => {
    const path = join(tmpdir(), `mcc-repo-test-${process.pid}.json`);
    if (existsSync(path)) rmSync(path);
    try {
      const a = new DeviceRepo(path);
      a.upsertSite({ id: "s1", name: "جدة" });
      a.upsertDevice(mkDevice({ name: "persisted" }));
      a.setSecret("d1", Buffer.from("pw", "utf8"));

      const b = new DeviceRepo(path); // fresh instance reads the file
      expect(b.listSites()[0]?.name).toBe("جدة");
      expect(b.listDevices()[0]?.name).toBe("persisted");
      expect(b.getSecret("d1")?.toString("utf8")).toBe("pw");
    } finally {
      if (existsSync(path)) rmSync(path);
    }
  });
});
