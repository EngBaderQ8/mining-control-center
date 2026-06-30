import { describe, it, expect } from "vitest";
import { DeviceRepo } from "../../src/main/db/repo";
import { MiningService, DEFAULT_CONFIG } from "../../src/main/service";
import type { Transport } from "../../src/core/drivers/types";
import type { DeviceStatus } from "../../src/core/model/device";
import type { Alert } from "../../src/core/alerts/rules";

function makeService(
  transport: Transport,
  emitted: { statuses: DeviceStatus[][]; alerts: Alert[][] },
  clock: { t: number } = { t: 1000 },
) {
  const repo = new DeviceRepo();
  const service = new MiningService(
    {
      repo,
      transport,
      encrypt: (p) => Buffer.from(p, "utf8"),
      decrypt: (e) => e.toString("utf8"),
      emitStatuses: (s) => emitted.statuses.push(s),
      emitAlerts: (a) => emitted.alerts.push(a),
      now: () => clock.t,
    },
    { ...DEFAULT_CONFIG, pollIntervalMs: 999_999 },
  );
  return { service, repo, clock };
}

describe("MiningService", () => {
  it("routes a command to the right firmware driver and passes the decrypted secret", async () => {
    const seen: { cmd: string; secret?: string }[] = [];
    const transport: Transport = {
      async tcp4028(_h, _p, cmd) {
        seen.push({ cmd });
        return '{"STATUS":[{"STATUS":"S"}]}';
      },
      async http() {
        return { status: 200, body: "ok" };
      },
    };
    const emitted = { statuses: [] as DeviceStatus[][], alerts: [] as Alert[][] };
    const { service } = makeService(transport, emitted);
    service.addSite({ id: "s1", name: "site" });
    service.addDevice(
      { id: "d1", siteId: "s1", name: "n", model: "S19", firmware: "braiins", host: "h", apiPort: 4028, controlPort: 4028 },
      "mypassword",
    );
    const outcome = await service.sendCommand("d1", "stopMining");
    expect(outcome.ok).toBe(true);
    expect(seen[0]?.cmd).toContain('"pause"'); // braiins stopMining => pause
  });

  it("handles a routed 'diagnose' command by reading stats and returning health JSON", async () => {
    const transport: Transport = {
      async tcp4028(_h, _p, cmd) {
        if (cmd.includes("stats"))
          return '{"STATS":[{"chain_acn1":76,"chain_acn2":76,"chain_acn3":76,"chain_rate1":"100","chain_rate2":"100","chain_rate3":"0","fan1":4000}]}';
        return "{}";
      },
      async http() {
        return { status: 200, body: "ok" };
      },
    };
    const emitted = { statuses: [] as DeviceStatus[][], alerts: [] as Alert[][] };
    const { service } = makeService(transport, emitted);
    service.addSite({ id: "s1", name: "site" });
    service.addDevice({
      id: "d1", siteId: "s1", name: "n", model: "S19", firmware: "stock", host: "h", apiPort: 4028, controlPort: 80,
    });
    const outcome = await service.sendCommand("d1", "diagnose");
    expect(outcome.ok).toBe(true);
    const health = JSON.parse(outcome.data!);
    expect(health.boards).toHaveLength(3);
    expect(health.issues.some((i: { code: string }) => i.code === "boardDown")).toBe(true);
  });

  it("debounces offline alerts (no flap-spam), fires once after the confirm window, with the device NAME", async () => {
    let alive = true;
    const transport: Transport = {
      async tcp4028(_h, _p, cmd) {
        if (!alive) throw new Error("down");
        if (cmd.includes("summary"))
          return '{"SUMMARY":[{"GHS 5s":95000,"GHS av":95000,"Elapsed":3600}]}';
        if (cmd.includes("stats")) return '{"STATS":[{"temp2_1":60,"fan1":4000}]}';
        return '{"POOLS":[{"URL":"stratum+tcp://p:3333","User":"a.w1"}]}';
      },
      async http() {
        return { status: 200, body: "ok" };
      },
    };
    const emitted = { statuses: [] as DeviceStatus[][], alerts: [] as Alert[][] };
    const clock = { t: 1000 };
    const { service } = makeService(transport, emitted, clock);
    service.addSite({ id: "s1", name: "site" });
    service.addDevice({
      id: "d1", siteId: "s1", name: "ASIC-47", model: "S19", firmware: "stock", host: "h", apiPort: 4028, controlPort: 80,
    });
    const first = await service.pollOnce();
    expect(first[0]?.state).toBe("online");
    expect(emitted.statuses).toHaveLength(1);

    // Goes offline — but a brief flap must NOT alert immediately.
    alive = false;
    await service.pollOnce();
    expect(emitted.alerts.flat().map((a) => a.kind)).not.toContain("offline");

    // Still offline past the confirm window → fires exactly once, with the name.
    clock.t += 70_000;
    await service.pollOnce();
    const offline = emitted.alerts.flat().filter((a) => a.kind === "offline");
    expect(offline).toHaveLength(1);
    expect(offline[0]!.message).toContain("ASIC-47");
    expect(offline[0]!.message).not.toContain("d1"); // the UUID, not used

    // Keeps polling while offline → no duplicate spam.
    clock.t += 70_000;
    await service.pollOnce();
    expect(emitted.alerts.flat().filter((a) => a.kind === "offline")).toHaveLength(1);
  });
});
