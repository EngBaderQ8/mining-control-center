import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { runFlash, type FlashRunnerDeps } from "../../../src/main/agent/flashRunner";
import type { FlashExec, FlashProgress, FlashResult } from "../../../src/shared/protocol";
import type { Device, Firmware } from "../../../src/core/model/device";
import type { FlashTransport } from "../../../src/core/drivers/types";

const FW = Buffer.from("FIRMWARE-IMAGE-BYTES");
const FW_SHA = createHash("sha256").update(FW).digest("hex");

const verOf = (bmminer: string): string =>
  JSON.stringify({ STATUS: [{ STATUS: "S" }], VERSION: [{ Type: "Antminer S19", BMMiner: bmminer }] });
const LUX_VER = JSON.stringify({ VERSION: [{ Type: "Antminer S19", LUXminer: "2024.1.0" }] });

const device: Device = {
  id: "d1",
  siteId: "s1",
  name: "S19",
  model: "S19",
  firmware: "stock",
  host: "h",
  apiPort: 4028,
  controlPort: 80,
};

const job = (over: Partial<FlashExec> = {}): FlashExec => ({
  type: "flash.exec",
  jobId: "j1",
  deviceId: "d1",
  family: "stock" as Firmware,
  model: "S19",
  url: "/firmware/S19-2.0.tar.gz",
  sha256: FW_SHA,
  size: FW.length,
  version: "2.0",
  uploadedAt: 1,
  sig: "sig",
  keepSettings: true,
  ...over,
});

/** A FlashTransport whose upload always "succeeds" — so the real StockDriver.flash
 *  returns `flashed` and the runner proceeds to the version read-back. */
const okUploadTransport: FlashTransport = {
  async tcp4028() {
    return "{}";
  },
  async http() {
    return { status: 200, body: "ok" };
  },
  async httpUpload() {
    return { status: 200, body: "System Upgrade Successed" };
  },
};

/** Returns version strings in sequence (clamped to the last) — call 0 is the
 *  pre-flash read, the rest are the post-reboot confirm reads. */
function versionSeq(values: string[]): (d: Device) => Promise<string> {
  let i = 0;
  return async () => values[Math.min(i++, values.length - 1)] ?? "";
}

function harness(over: Partial<FlashRunnerDeps> = {}): {
  deps: FlashRunnerDeps;
  results: FlashResult[];
  phases: string[];
} {
  const results: FlashResult[] = [];
  const phases: string[] = [];
  const deps: FlashRunnerDeps = {
    transport: okUploadTransport,
    findDevice: (id) => (id === "d1" ? device : undefined),
    getSecret: () => "root:root",
    download: async () => FW,
    readVersion: versionSeq([verOf("1.0"), verOf("2.0")]),
    verifySig: () => true,
    delay: async () => {},
    send: (m: FlashProgress | FlashResult) => {
      if (m.type === "flash.result") results.push(m);
      else phases.push(m.phase);
    },
    ...over,
  };
  return { deps, results, phases };
}

describe("runFlash", () => {
  it("succeeds when sha matches, model matches, and the version CHANGES after reboot", async () => {
    const { deps, results, phases } = harness();
    await runFlash(job(), deps);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ state: "success", newVersion: "2.0" });
    expect(phases).toEqual([
      "downloading",
      "verifying",
      "matching",
      "flashing",
      "rebooting",
      "confirming",
    ]);
  });

  it("FAILS on a sha256 mismatch — and never reaches the driver flash", async () => {
    const { deps, results, phases } = harness();
    await runFlash(job({ sha256: "00".repeat(32) }), deps);
    expect(results[0]?.state).toBe("failed");
    expect(phases).not.toContain("flashing");
  });

  it("FAILS on a bad Ed25519 signature — never flashes (signature is load-bearing)", async () => {
    const { deps, results, phases } = harness({ verifySig: () => false });
    await runFlash(job(), deps);
    expect(results[0]?.state).toBe("failed");
    expect(results[0]?.error).toContain("توقيع");
    expect(phases).not.toContain("flashing");
  });

  it("REFUSES on a model mismatch (S19 image, but job targets S21)", async () => {
    const { deps, results, phases } = harness();
    await runFlash(job({ model: "S21" }), deps);
    expect(results[0]?.state).toBe("refused");
    expect(phases).not.toContain("flashing");
  });

  it("REFUSES when the live firmware family differs from the job", async () => {
    const { deps, results } = harness({ readVersion: versionSeq([LUX_VER]) });
    await runFlash(job(), deps); // job.family = stock, device reports luxos
    expect(results[0]?.state).toBe("refused");
  });

  it("REFUSES an unsupported family (no driver.flash, e.g. whatsminer)", async () => {
    const { deps, results } = harness();
    await runFlash(job({ family: "whatsminer", url: "/firmware/wm.bin" }), deps);
    expect(results[0]?.state).toBe("refused");
  });

  it("FAILS when the device never comes back after the reboot", async () => {
    // pre-version reads fine, then the device is unreachable forever.
    const { deps, results } = harness({ readVersion: versionSeq([verOf("1.0"), ""]) });
    await runFlash(job(), deps);
    expect(results[0]?.state).toBe("failed");
  });

  it("FAILS when the version is unchanged after the flash (it didn't take)", async () => {
    const { deps, results } = harness({ readVersion: versionSeq([verOf("1.0"), verOf("1.0")]) });
    await runFlash(job(), deps);
    expect(results[0]?.state).toBe("failed");
  });

  it("FAILS when the firmware download is empty", async () => {
    const { deps, results } = harness({ download: async () => Buffer.alloc(0) });
    await runFlash(job(), deps);
    expect(results[0]?.state).toBe("failed");
  });

  it("FAILS for a device this agent does not own", async () => {
    const { deps, results } = harness();
    await runFlash(job({ deviceId: "ghost" }), deps);
    expect(results[0]?.state).toBe("failed");
  });
});
