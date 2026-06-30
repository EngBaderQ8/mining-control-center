import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../../server/src/db/schema";
import { ServerRepo } from "../../../server/src/db/repo";

function repo(): ServerRepo {
  const db = new Database(":memory:");
  applySchema(db);
  return new ServerRepo(db);
}
const mkJob = (jobId: string, deviceId: string, batchId = "b1") => ({
  jobId,
  batchId,
  userId: "u1",
  deviceId,
  agentId: "ag1",
  firmwareId: "fw1",
});

describe("flash job repo (safety + isolation)", () => {
  it("claimQueuedJob is atomic: only the first caller wins the queued->flashing claim", () => {
    const r = repo();
    r.createFlashJobs([mkJob("j1", "d1")]);
    expect(r.claimQueuedJob("j1")).toBe(true);
    expect(r.getFlashJob("j1")!.state).toBe("flashing");
    expect(r.claimQueuedJob("j1")).toBe(false); // already claimed
  });

  it("setFlashState makes terminal states one-way (no overwrite of a terminal row)", () => {
    const r = repo();
    r.createFlashJobs([mkJob("j1", "d1")]);
    expect(r.setFlashState("j1", "success", { newVersion: "v2" })).toBe(1);
    expect(r.setFlashState("j1", "failed", { error: "late" })).toBe(0); // refused
    expect(r.getFlashJob("j1")!.state).toBe("success");
  });

  it("anyFlashActive = MID-flash only; activeFlashDeviceIds (for dedupe) includes queued", () => {
    const r = repo();
    r.createFlashJobs([mkJob("j1", "d1"), mkJob("j2", "d2")]);
    expect(r.anyFlashActive()).toBe(false); // queued, but nothing is mid-flash yet
    expect([...r.activeFlashDeviceIds()].sort()).toEqual(["d1", "d2"]); // queued still blocks re-queue
    r.claimQueuedJob("j1"); // d1 -> flashing
    expect(r.anyFlashActive()).toBe(true);
    r.setFlashState("j1", "success", { newVersion: "v" });
    r.setFlashState("j2", "stopped");
    expect(r.anyFlashActive()).toBe(false); // all terminal now
    expect([...r.activeFlashDeviceIds()]).toEqual([]); // nothing live
  });

  it("getFlashJobForUser scopes a job to its owning tenant", () => {
    const r = repo();
    r.createFlashJobs([mkJob("j1", "d1")]); // userId u1
    expect(r.getFlashJobForUser("u1", "j1")).toBeTruthy();
    expect(r.getFlashJobForUser("u2", "j1")).toBeUndefined(); // other tenant cannot see it
  });

  it("touchAgent refuses to rebind an agentId owned by a different user (anti-spoof)", () => {
    const r = repo();
    const u1 = r.createUser("a@b.com", "h");
    const u2 = r.createUser("c@d.com", "h");
    expect(r.touchAgent("ag1", u1, "site")).toBe(true);
    expect(r.touchAgent("ag1", u1, "site2")).toBe(true); // same owner can refresh
    expect(r.touchAgent("ag1", u2, "evil")).toBe(false); // foreign user rejected
    expect(r.agentOwner("ag1")).toBe(u1);
  });

  it("reconcileInterruptedFlashJobs fails dangling mid-flash jobs and stops their batch", () => {
    const r = repo();
    r.createFlashJobs([mkJob("j1", "d1"), mkJob("j2", "d2")]);
    r.claimQueuedJob("j1"); // j1 = 'flashing' (simulating a crash mid-flash)
    r.reconcileInterruptedFlashJobs();
    expect(r.getFlashJob("j1")!.state).toBe("failed");
    expect(r.getFlashJob("j1")!.error).toContain("restart");
    expect(r.getFlashJob("j2")!.state).toBe("stopped");
  });
});
