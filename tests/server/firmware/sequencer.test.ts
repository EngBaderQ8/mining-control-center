import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySchema } from "../../../server/src/db/schema";
import { ServerRepo } from "../../../server/src/db/repo";
import { CommandRouter } from "../../../server/src/router/commandRouter";
import { FlashSequencer } from "../../../server/src/firmware/sequencer";
import { appendCatalog } from "../../../server/src/firmware/catalog";
import type { ServerMessage } from "../../../server/src/protocol/messages";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "fw-"));
  const db = new Database(":memory:");
  applySchema(db);
  const repo = new ServerRepo(db);
  const router = new CommandRouter();
  const sent: ServerMessage[] = [];
  router.attachAgent("ag1", (m) => sent.push(m));
  appendCatalog(dir, {
    id: "fw1", family: "stock", model: "S19", version: "1.0",
    file: "x.tar.gz", sha256: "abc", size: 10, sig: "s", uploadedAt: 1,
  });
  const seq = new FlashSequencer(repo, router, dir);
  const job = (jobId: string, batchId: string, deviceId: string, agentId = "ag1") => ({
    jobId, batchId, userId: "u", deviceId, agentId, firmwareId: "fw1",
  });
  return { repo, seq, sent, job };
}
const dev = (m: ServerMessage): string => (m as { deviceId: string }).deviceId;

describe("FlashSequencer", () => {
  it("flashes ONE device at a time and STOPS the whole batch on a failure", () => {
    const { repo, seq, sent, job } = setup();
    repo.createFlashJobs([job("j1", "b1", "d1"), job("j2", "b1", "d2"), job("j3", "b1", "d3")]);
    seq.startBatch("b1", true); // auto-continue

    expect(sent).toHaveLength(1); // only device 1 dispatched
    expect(dev(sent[0]!)).toBe("d1");
    expect(repo.getFlashJob("j1")!.state).toBe("flashing");

    seq.onResult("j1", "success", "v2"); // -> device 2
    expect(repo.getFlashJob("j1")!.state).toBe("success");
    expect(sent).toHaveLength(2);
    expect(dev(sent[1]!)).toBe("d2");

    seq.onResult("j2", "failed", undefined, "boom"); // STOP
    expect(repo.getFlashJob("j2")!.state).toBe("failed");
    expect(repo.getFlashJob("j3")!.state).toBe("stopped"); // device 3 never flashed
    expect(sent).toHaveLength(2);
  });

  it("pauses for dashboard confirmation when auto-continue is off", () => {
    const { repo, seq, sent, job } = setup();
    repo.createFlashJobs([job("j1", "b2", "d1"), job("j2", "b2", "d2")]);
    seq.startBatch("b2", false);
    expect(sent).toHaveLength(1);

    seq.onResult("j1", "success", "v2");
    expect(sent).toHaveLength(1); // paused — device 2 NOT auto-dispatched
    expect(repo.getFlashJob("j2")!.state).toBe("queued");

    seq.continueBatch("b2");
    expect(sent).toHaveLength(2);
    expect(dev(sent[1]!)).toBe("d2");
  });

  it("fails + stops the batch if the owning agent is offline (never silently skips)", () => {
    const { repo, seq, sent, job } = setup();
    repo.createFlashJobs([job("j1", "b3", "d1", "OFFLINE"), job("j2", "b3", "d2")]);
    seq.startBatch("b3", true);
    expect(repo.getFlashJob("j1")!.state).toBe("failed");
    expect(repo.getFlashJob("j2")!.state).toBe("stopped");
    expect(sent).toHaveLength(0);
  });

  it("a refused flash also stops the batch", () => {
    const { repo, seq, job } = setup();
    repo.createFlashJobs([job("j1", "b4", "d1"), job("j2", "b4", "d2")]);
    seq.startBatch("b4", true);
    seq.onResult("j1", "refused", undefined, "model mismatch");
    expect(repo.getFlashJob("j1")!.state).toBe("refused");
    expect(repo.getFlashJob("j2")!.state).toBe("stopped");
  });

  it("does NOT start a second device while one is still mid-flash (continueBatch is in-flight-safe)", () => {
    const { repo, seq, sent, job } = setup();
    repo.createFlashJobs([job("j1", "b5", "d1"), job("j2", "b5", "d2")]);
    seq.startBatch("b5", false);
    expect(sent).toHaveLength(1); // j1 dispatched, now 'flashing'
    // A premature Continue (or a double-click) must NOT dispatch j2 while j1 is mid-flash.
    seq.continueBatch("b5");
    seq.continueBatch("b5");
    expect(sent).toHaveLength(1);
    expect(repo.getFlashJob("j2")!.state).toBe("queued");
  });

  it("ignores a late/duplicate result for an already-terminal job (no relabel, no re-dispatch)", () => {
    const { repo, seq, sent, job } = setup();
    repo.createFlashJobs([job("j1", "b6", "d1"), job("j2", "b6", "d2")]);
    seq.startBatch("b6", true);
    seq.onResult("j1", "failed", undefined, "timeout — possible brick"); // terminal -> stops batch
    expect(repo.getFlashJob("j1")!.state).toBe("failed");
    expect(repo.getFlashJob("j2")!.state).toBe("stopped");
    // A late 'success' for j1 must NOT overwrite the brick label nor re-dispatch.
    seq.onResult("j1", "success", "v9");
    expect(repo.getFlashJob("j1")!.state).toBe("failed");
    expect(sent).toHaveLength(1);
  });

  it("treats a 'success' with no version read-back proof as a failure (stops the batch)", () => {
    const { repo, seq, job } = setup();
    repo.createFlashJobs([job("j1", "b7", "d1"), job("j2", "b7", "d2")]);
    seq.startBatch("b7", true);
    seq.onResult("j1", "success"); // no newVersion -> not a real success
    expect(repo.getFlashJob("j1")!.state).toBe("failed");
    expect(repo.getFlashJob("j2")!.state).toBe("stopped");
  });
});
