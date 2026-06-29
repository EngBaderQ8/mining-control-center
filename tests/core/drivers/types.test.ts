import { describe, it, expect } from "vitest";
import type { Transport, DeviceDriver } from "../../../src/core/drivers/types";

describe("driver contracts", () => {
  it("Transport + DeviceDriver are usable shapes", async () => {
    const calls: string[] = [];
    const t: Transport = {
      async tcp4028(_host, _port, cmd) {
        calls.push(`tcp:${cmd}`);
        return '{"STATUS":[{"STATUS":"S"}]}';
      },
      async http(req) {
        calls.push(`http:${req.method}:${req.path}`);
        return { status: 200, body: "ok" };
      },
    };
    await t.tcp4028("h", 4028, '{"command":"summary"}');
    await t.http({ host: "h", port: 80, method: "POST", path: "/x" });
    expect(calls).toEqual(['tcp:{"command":"summary"}', "http:POST:/x"]);
    const _typecheck: Pick<DeviceDriver, "firmware"> = { firmware: "stock" };
    expect(_typecheck.firmware).toBe("stock");
  });
});
