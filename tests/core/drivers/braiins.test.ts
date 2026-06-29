import { describe, it, expect } from "vitest";
import { BraiinsDriver } from "../../../src/core/drivers/braiins";
import type { Transport } from "../../../src/core/drivers/types";
import type { Device } from "../../../src/core/model/device";

const dev: Device = {
  id: "d",
  siteId: "s",
  name: "n",
  model: "S19",
  firmware: "braiins",
  host: "h",
  apiPort: 4028,
  controlPort: 4028,
};
const tcp = (seq: string[]): Transport => ({
  async tcp4028(_h, _p, cmd) {
    seq.push(cmd);
    return '{"STATUS":[{"STATUS":"S"}]}';
  },
  async http() {
    throw new Error("no");
  },
});

describe("BraiinsDriver", () => {
  it("maps commands to bosminer verbs", async () => {
    for (const [cmd, verb] of [
      ["stopMining", "pause"],
      ["startMining", "resume"],
      ["restartMining", "restart"],
    ] as const) {
      const seq: string[] = [];
      const r = await new BraiinsDriver().execute(dev, cmd, tcp(seq));
      expect(r.ok).toBe(true);
      expect(seq[0]).toContain(`"${verb}"`);
    }
  });

  it("reports failure when the miner replies STATUS E", async () => {
    const t: Transport = {
      async tcp4028() {
        return '{"STATUS":[{"STATUS":"E","Msg":"bad command"}]}';
      },
      async http() {
        throw new Error("no");
      },
    };
    const r = await new BraiinsDriver().execute(dev, "reboot", t);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("bad command");
  });

  it("setPool sends addpool with the pool url/user/pass", async () => {
    const seq: string[] = [];
    const r = await new BraiinsDriver().execute(dev, "setPool", tcp(seq), undefined, {
      url: "stratum+tcp://p:3333",
      user: "acct.w1",
      pass: "x",
    });
    expect(r.ok).toBe(true);
    expect(seq[0]).toContain('"addpool"');
    expect(seq[0]).toContain("stratum+tcp://p:3333");
    expect(seq[0]).toContain("acct.w1");
  });
});
