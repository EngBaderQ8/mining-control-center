import { describe, it, expect } from "vitest";
import { VnishDriver } from "../../../src/core/drivers/vnish";
import type { Transport, HttpRequest } from "../../../src/core/drivers/types";
import type { Device } from "../../../src/core/model/device";

const dev: Device = {
  id: "d",
  siteId: "s",
  name: "n",
  model: "S19",
  firmware: "vnish",
  host: "h",
  apiPort: 4028,
  controlPort: 80,
};

function fakeHttp(reqs: HttpRequest[]): Transport {
  return {
    async tcp4028() {
      throw new Error("not used");
    },
    async http(req) {
      reqs.push(req);
      if (req.path.includes("unlock")) return { status: 200, body: JSON.stringify({ token: "T" }) };
      return { status: 200, body: "{}" };
    },
  };
}

describe("VnishDriver", () => {
  it("unlocks then restarts mining with bearer token", async () => {
    const reqs: HttpRequest[] = [];
    const r = await new VnishDriver().execute(dev, "restartMining", fakeHttp(reqs), "pw");
    expect(r.ok).toBe(true);
    expect(reqs[0]?.path).toContain("unlock");
    expect(reqs[1]?.path).toContain("/mining/restart");
    expect(reqs[1]?.auth?.token).toBe("T");
  });
});
