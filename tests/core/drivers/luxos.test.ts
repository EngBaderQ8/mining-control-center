import { describe, it, expect } from "vitest";
import { LuxOsDriver } from "../../../src/core/drivers/luxos";
import type { Transport } from "../../../src/core/drivers/types";
import type { Device } from "../../../src/core/model/device";

const dev: Device = {
  id: "d",
  siteId: "s",
  name: "n",
  model: "S19",
  firmware: "luxos",
  host: "h",
  apiPort: 4028,
  controlPort: 4028,
};

function fakeTcp(seq: string[]): Transport {
  return {
    async tcp4028(_h, _p, cmd) {
      seq.push(cmd);
      if (cmd.includes('"logon"')) return '{"SESSION":[{"SessionID":"abc"}]}';
      return '{"STATUS":[{"STATUS":"S","Msg":"ok"}]}';
    },
    async http() {
      throw new Error("not used");
    },
  };
}

describe("LuxOsDriver", () => {
  it("stopMining logs on then curtails to sleep", async () => {
    const seq: string[] = [];
    const r = await new LuxOsDriver().execute(dev, "stopMining", fakeTcp(seq));
    expect(r.ok).toBe(true);
    expect(seq[0]).toContain('"logon"');
    expect(seq[1]).toContain('"curtail"');
    expect(seq[1]).toContain("sleep");
  });
  it("reboot sends reboot with session", async () => {
    const seq: string[] = [];
    const r = await new LuxOsDriver().execute(dev, "reboot", fakeTcp(seq));
    expect(r.ok).toBe(true);
    expect(seq[1]).toContain('"reboot"');
  });
});
