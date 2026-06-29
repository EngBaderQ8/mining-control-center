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
});
