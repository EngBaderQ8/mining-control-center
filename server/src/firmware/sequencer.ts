import type { ServerRepo } from "../db/repo";
import type { CommandRouter } from "../router/commandRouter";
import { firmwareById } from "./catalog";

const TERMINAL = new Set(["success", "failed", "refused", "stopped"]);
const WATCHDOG_MS = 20 * 60 * 1000; // a flash with no progress for 20 min = assume bricked

/**
 * Drives a firmware-flash batch ONE DEVICE AT A TIME. Dispatches the next queued
 * device only after the previous one reports `success`; on ANY failure/refusal/timeout
 * it STOPS the whole batch (cancels remaining queued devices) — so a bad image can
 * brick at most one miner, never the fleet. Optionally pauses after each success until
 * the operator confirms ("gradual + dashboard confirmation").
 */
export class FlashSequencer {
  private autoContinue = new Map<string, boolean>(); // batchId -> auto-advance?
  private watchdogs = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private repo: ServerRepo,
    private router: CommandRouter,
    private dataDir: string,
  ) {}

  startBatch(batchId: string, autoContinue: boolean): void {
    this.autoContinue.set(batchId, autoContinue);
    this.dispatchNext(batchId);
  }

  /** Operator confirmed the previous device is healthy → flash the next one. */
  continueBatch(batchId: string): void {
    this.dispatchNext(batchId);
  }

  cancelBatch(batchId: string): void {
    this.repo.stopQueuedJobs(batchId);
    this.autoContinue.delete(batchId);
  }

  onProgress(jobId: string, phase: string): void {
    const job = this.repo.getFlashJob(jobId);
    if (job && !TERMINAL.has(job.state)) this.repo.setFlashState(jobId, phase);
    this.armWatchdog(jobId); // each progress tick resets the brick timer
  }

  onResult(
    jobId: string,
    state: "success" | "failed" | "refused",
    newVersion?: string,
    error?: string,
  ): void {
    const job = this.repo.getFlashJob(jobId);
    if (!job) return;
    this.clearWatchdog(jobId);
    this.repo.setFlashState(jobId, state, { newVersion, error });
    if (state === "success") {
      if (this.autoContinue.get(job.batchId)) this.dispatchNext(job.batchId);
      // else: pause — wait for continueBatch() from the dashboard.
    } else {
      // STOP-on-failure: cancel every remaining queued device in this batch.
      this.repo.stopQueuedJobs(job.batchId);
    }
  }

  private dispatchNext(batchId: string): void {
    const job = this.repo.nextQueuedJob(batchId);
    if (!job) return; // batch complete (or paused with nothing queued)
    const fw = firmwareById(this.dataDir, job.firmwareId);
    if (!fw) {
      this.repo.setFlashState(job.jobId, "failed", { error: "firmware image not found" });
      this.repo.stopQueuedJobs(batchId);
      return;
    }
    this.repo.setFlashState(job.jobId, "flashing");
    const isLux = fw.family === "luxos"; // LuxOS pulls its own signed image — no byte push
    const ok = this.router.sendToAgent(job.agentId, {
      type: "flash.exec",
      jobId: job.jobId,
      deviceId: job.deviceId,
      family: fw.family,
      model: fw.model,
      url: isLux ? "" : `/firmware/${fw.file}`,
      sha256: isLux ? "" : fw.sha256,
      keepSettings: true,
    });
    if (!ok) {
      this.repo.setFlashState(job.jobId, "failed", { error: "owning agent offline" });
      this.repo.stopQueuedJobs(batchId);
      return;
    }
    this.armWatchdog(job.jobId);
  }

  private armWatchdog(jobId: string): void {
    this.clearWatchdog(jobId);
    const t = setTimeout(() => {
      const job = this.repo.getFlashJob(jobId);
      if (job && !TERMINAL.has(job.state)) {
        this.repo.setFlashState(jobId, "failed", {
          error: "timeout — no response (possible brick)",
        });
        this.repo.stopQueuedJobs(job.batchId);
      }
    }, WATCHDOG_MS);
    t.unref?.(); // never keep the process alive just for a flash watchdog
    this.watchdogs.set(jobId, t);
  }

  private clearWatchdog(jobId: string): void {
    const t = this.watchdogs.get(jobId);
    if (t) {
      clearTimeout(t);
      this.watchdogs.delete(jobId);
    }
  }
}
