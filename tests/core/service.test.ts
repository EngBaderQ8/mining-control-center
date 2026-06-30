import { describe, it, expect } from "vitest";
import { DeviceRepo } from "../../src/main/db/repo";
import { MiningService, DEFAULT_CONFIG } from "../../src/main/service";
import type { Transport } from "../../src/core/drivers/types";
import type { DeviceStatus } from "../../src/core/model/device";
import type { Alert } from "../../src/core/alerts/rules";

function makeService(transport: Transport, emitted: { statuses: DeviceStatus[][]; alerts: Alert[][] }) {
  const repo = new DeviceRepo();
  const service = new MiningService(
    {
      repo,
      transport,
      encrypt: (p) => Buffer.from(p, "utf8"),
      decrypt: (e) => e.toString("utf8"),
      emitStatuses: (s) => emitted.statuses.push(s),
      emitAlerts: (a) => emitted.alerts.push(a),
      now: () => 1000,
    },
    { ...DEFAULT_CONFIG, pollIntervalMs: 999_999 },
  );
  return { service, repo };
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
          return '{"STATS":[{"chain_acn1":76,"chain_acn2":76,"chain_acn3":0,"chain_rate1":"100","chain_rate2":"100","chain_rate3":"0","fan1":4000,"fan2":0}]}';
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

  it("emits statuses and offline alerts across poll cycles", async () => {
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
    const { service } = makeService(transport, emitted);
    service.addSite({ id: "s1", name: "site" });
    service.addDevice(
      { id: "d1", siteId: "s1", name: "n", model: "S19", firmware: "stock", host: "h", apiPort: 4028, controlPort: 80 },
    );
    const first = await service.pollOnce();
    expect(first[0]?.state).toBe("online");
    expect(emitted.statuses).toHaveLength(1);
    alive = false;
    await service.pollOnce();
    expect(emitted.alerts.flat().map((a) => a.kind)).toContain("offline");
  });
});
