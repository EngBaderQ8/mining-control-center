import { describe, it, expect } from "vitest";
import { StockDriver } from "../../../src/core/drivers/stock";
import type { Transport, HttpRequest } from "../../../src/core/drivers/types";
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
const http = (reqs: HttpRequest[]): Transport => ({
  async tcp4028() {
    throw new Error("read-only");
  },
  async http(req) {
    reqs.push(req);
    return { status: 200, body: "ok" };
  },
});

describe("StockDriver", () => {
  it("reboot calls reboot.cgi with digest auth", async () => {
    const reqs: HttpRequest[] = [];
    const r = await new StockDriver().execute(dev, "reboot", http(reqs), "root:root");
    expect(r.ok).toBe(true);
    expect(reqs[0]?.path).toContain("reboot.cgi");
    expect(reqs[0]?.auth?.kind).toBe("digest");
  });

  it("keeps colons in the password (splits only on the first ':')", async () => {
    const reqs: HttpRequest[] = [];
    await new StockDriver().execute(dev, "reboot", http(reqs), "root:pa:ss:word");
    expect(reqs[0]?.auth?.user).toBe("root");
    expect(reqs[0]?.auth?.pass).toBe("pa:ss:word");
  });

  it("setPool posts the pool config to set_miner_conf.cgi with digest auth", async () => {
    const reqs: HttpRequest[] = [];
    const r = await new StockDriver().execute(dev, "setPool", http(reqs), "root:root", {
      url: "stratum+tcp://p:3333",
      user: "acct.w1",
      pass: "x",
    });
    expect(r.ok).toBe(true);
    expect(reqs[0]?.path).toContain("set_miner_conf.cgi");
    expect(reqs[0]?.method).toBe("POST");
    expect(reqs[0]?.auth?.kind).toBe("digest");
    expect(reqs[0]?.body).toContain("stratum+tcp://p:3333");
  });
});
