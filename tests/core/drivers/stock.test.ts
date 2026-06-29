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
});
