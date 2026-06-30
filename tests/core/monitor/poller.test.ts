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
    // The combined command returns every section in one blob (real behaviour).
    if (cmd.includes("summary+stats+pools"))
      return '{"summary":[{"SUMMARY":[{"GHS 5s":95000,"GHS av":94000,"Device Hardware%":0.1,"Elapsed":3600}]}],"stats":[{"STATS":[{"temp2_1":60,"temp2_2":75,"fan1":4000}]}],"pools":[{"POOLS":[{"URL":"stratum+tcp://p:3333","User":"a.w1"}]}]}';
    if (cmd.includes("summary"))
      return '{"SUMMARY":[{"GHS 5s":95000,"GHS av":94000,"Device Hardware%":0.1,"Elapsed":3600}]}';
    if (cmd.includes("stats")) return '{"STATS":[{"temp2_1":60,"temp2_2":75,"fan1":4000}]}';
    return '{"POOLS":[{"URL":"stratum+tcp://p:3333","User":"a.w1","Stratum Active":true}]}';
  },
  async http() {
    throw new Error("no");
  },
};
// Combined reply lacks per-chain detail, but a standalone `stats` carries it.
const boardsInStatsOnly: Transport = {
  async tcp4028(_h, _p, cmd) {
    if (cmd.includes("summary+stats+pools"))
      return '{"summary":[{"SUMMARY":[{"GHS 5s":95000}]}],"stats":[{"STATS":[{"temp2_1":60}]}],"pools":[]}';
    if (cmd.includes("stats"))
      return '{"STATS":[{"chain_acn1":76,"chain_acn2":76,"chain_acn3":76,"chain_rate1":"100","chain_rate2":"100","chain_rate3":"0"}]}';
    return "{}";
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

// Whatsminer-style flapping: combined fails, first `summary` is a refused/empty
// connection, the retry succeeds — must NOT be marked offline.
let summaryCalls = 0;
const flakyWhatsminer: Transport = {
  async tcp4028(_h, _p, cmd) {
    if (cmd.includes("summary+stats+pools")) return ""; // Whatsminer rejects the combined
    if (cmd.includes("summary")) {
      summaryCalls++;
      return summaryCalls === 1 ? "" : '{"STATUS":"S","Msg":{"MHS av":100000000,"MHS 1m":100000000,"Temperature":75}}';
    }
    return "{}";
  },
  async http() {
    throw new Error("no");
  },
};

// Whatsminer's combined reply is cgminer-format (board Temperature, no Env Temp);
// the standalone `summary` is btminer-format (has Env Temp — the owner's choice).
const wmCombinedVsSummary: Transport = {
  async tcp4028(_h, _p, cmd) {
    if (cmd.includes("summary+stats+pools"))
      return '{"SUMMARY":[{"MHS av":123000000,"Temperature":72.19}]}';
    if (cmd.includes("summary"))
      return '{"STATUS":"S","Msg":{"MHS av":123000000,"Env Temp":34.31,"Chip Temp Avg":76}}';
    return "{}";
  },
  async http() {
    throw new Error("no");
  },
};

describe("pollDevice", () => {
  it("shows a Whatsminer's Env Temp (from the standalone summary) even when the combined reply has a board Temperature", async () => {
    const s = await pollDevice(dev, wmCombinedVsSummary, 1000);
    expect(s.state).toBe("online");
    expect(s.hashrateTHs).toBeCloseTo(123, 0);
    expect(s.maxTempC).toBeCloseTo(34.31, 1); // Env Temp, NOT the combined's 72.19
  });

  it("retries summary once before marking a flapping Whatsminer offline", async () => {
    summaryCalls = 0;
    const s = await pollDevice(dev, flakyWhatsminer, 1000);
    expect(s.state).toBe("online");
    expect(s.hashrateTHs).toBeCloseTo(100, 0);
  });

  it("returns online normalized status", async () => {
    const s = await pollDevice(dev, ok, 1000);
    expect(s.state).toBe("online");
    expect(s.hashrateTHs).toBeCloseTo(95, 0);
    expect(s.maxTempC).toBe(75);
  });
  it("fetches stats alone for board health when the combined reply lacks per-chain detail", async () => {
    const s = await pollDevice(dev, boardsInStatsOnly, 1000);
    expect(s.health?.boards.length).toBe(3);
    expect(s.health?.issues.some((i) => i.code === "boardDown")).toBe(true);
  });
  it("returns offline on transport failure", async () => {
    const s = await pollDevice(dev, dead, 1000);
    expect(s.state).toBe("offline");
    expect(s.hashrateTHs).toBe(0);
  });
});
