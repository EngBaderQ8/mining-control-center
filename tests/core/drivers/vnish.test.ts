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

  it("fails (no second request) when unlock returns 401", async () => {
    const reqs: HttpRequest[] = [];
    const t: Transport = {
      async tcp4028() {
        throw new Error("n/a");
      },
      async http(req) {
        reqs.push(req);
        return { status: 401, body: "unauthorized" };
      },
    };
    const r = await new VnishDriver().execute(dev, "reboot", t, "wrong");
    expect(r.ok).toBe(false);
    expect(reqs).toHaveLength(1); // never sends the privileged command
  });

  it("fails when unlock returns no token", async () => {
    const reqs: HttpRequest[] = [];
    const t: Transport = {
      async tcp4028() {
        throw new Error("n/a");
      },
      async http(req) {
        reqs.push(req);
        return { status: 200, body: "{}" }; // no token field
      },
    };
    const r = await new VnishDriver().execute(dev, "reboot", t, "pw");
    expect(r.ok).toBe(false);
    expect(reqs).toHaveLength(1);
  });

  it("setPool posts the pool config with the given url/user", async () => {
    const reqs: HttpRequest[] = [];
    const r = await new VnishDriver().execute(dev, "setPool", fakeHttp(reqs), "pw", {
      url: "stratum+tcp://p:3333",
      user: "acct.w1",
      pass: "x",
    });
    expect(r.ok).toBe(true);
    expect(reqs[1]?.path).toContain("/pools");
    expect(reqs[1]?.body).toContain("stratum+tcp://p:3333");
    expect(reqs[1]?.body).toContain("acct.w1");
  });
});
