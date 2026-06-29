import { describe, it, expect } from "vitest";
import { pollDevice } from "../../../src/core/monitor/poller";
import type { Transport } from "../../../src/core/drivers/types";
import type { Device } from "../../../src/core/model/device";

const dev: Device = {
  id: "d",
  siteId: "s",
  name: "n",
  model: "S19",
  firmware: "stock",
  host: "h",
  apiPort: 4028,
  controlPort: 80,
};

const ok: Transport = {
  async tcp4028(_h, _p, cmd) {
    if (cmd.includes("summary"))
      return '{"SUMMARY":[{"GHS 5s":95000,"GHS av":94000,"Device Hardware%":0.1,"Elapsed":3600}]}';
    if (cmd.includes("stats")) return '{"STATS":[{"temp2_1":60,"temp2_2":75,"fan1":4000}]}';
    return '{"POOLS":[{"URL":"stratum+tcp://p:3333","User":"a.w1","Stratum Active":true}]}';
  },
  async http() {
    throw new Error("no");
  },
};
const dead: Transport = {
  async tcp4028() {
    throw new Error("timeout");
  },
  async http() {
    throw new Error("no");
  },
};

describe("pollDevice", () => {
  it("returns online normalized status", async () => {
    const s = await pollDevice(dev, ok, 1000);
    expect(s.state).toBe("online");
    expect(s.hashrateTHs).toBeCloseTo(95, 0);
    expect(s.maxTempC).toBe(75);
  });
  it("returns offline on transport failure", async () => {
    const s = await pollDevice(dev, dead, 1000);
    expect(s.state).toBe("offline");
    expect(s.hashrateTHs).toBe(0);
  });
});
