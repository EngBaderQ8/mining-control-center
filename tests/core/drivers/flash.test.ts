import { describe, it, expect } from "vitest";
import { StockDriver } from "../../../src/core/drivers/stock";
import { LuxOsDriver } from "../../../src/core/drivers/luxos";
import { BraiinsDriver } from "../../../src/core/drivers/braiins";
import type {
  FlashTransport,
  HttpRequest,
  HttpResponse,
  HttpUploadRequest,
  FirmwareImage,
} from "../../../src/core/drivers/types";
import type { Device } from "../../../src/core/model/device";

const dev = (firmware: Device["firmware"]): Device => ({
  id: "d",
  siteId: "s",
  name: "n",
  model: "S19",
  firmware,
  host: "h",
  apiPort: 4028,
  controlPort: firmware === "luxos" ? 4028 : 80,
});

const image = (overrides: Partial<FirmwareImage> = {}): FirmwareImage => ({
  family: "stock",
  model: "S19",
  fileName: "S19-1.0.tar.gz",
  bytes: Buffer.from("FIRMWARE-BYTES"),
  keepSettings: true,
  ...overrides,
});

interface Recorder {
  uploads: HttpUploadRequest[];
  https: HttpRequest[];
  tcps: string[];
}

/** Build a FlashTransport whose http/httpUpload/tcp4028 return scripted responses. */
function fakeTransport(opts: {
  rec: Recorder;
  upload?: (req: HttpUploadRequest) => HttpResponse;
  http?: (req: HttpRequest) => HttpResponse;
  tcp?: (cmd: string) => string;
}): FlashTransport {
  return {
    async tcp4028(_h, _p, command) {
      opts.rec.tcps.push(command);
      return opts.tcp ? opts.tcp(command) : "{}";
    },
    async http(req) {
      opts.rec.https.push(req);
      return opts.http ? opts.http(req) : { status: 200, body: "ok" };
    },
    async httpUpload(req) {
      opts.rec.uploads.push(req);
      return opts.upload ? opts.upload(req) : { status: 200, body: "System Upgrade Successed" };
    },
  };
}

const rec = (): Recorder => ({ uploads: [], https: [], tcps: [] });

describe("StockDriver.flash", () => {
  it("multipart-POSTs the image as `datafile` to upgrade.cgi with digest auth", async () => {
    const r = rec();
    const t = fakeTransport({ rec: r, upload: () => ({ status: 200, body: "System Upgrade Successed" }) });
    const out = await new StockDriver().flash(dev("stock"), image(), t, "root:secret");
    expect(out.ack).toBe("flashed");
    expect(r.uploads[0]?.path).toBe("/cgi-bin/upgrade.cgi");
    expect(r.uploads[0]?.files[0]?.field).toBe("datafile");
    expect(r.uploads[0]?.files[0]?.data.toString()).toBe("FIRMWARE-BYTES");
    expect(r.uploads[0]?.auth).toMatchObject({ kind: "digest", user: "root", pass: "secret" });
  });

  it("REFUSES (device untouched) when the miner reports a signature/verify failure", async () => {
    const r = rec();
    const t = fakeTransport({ rec: r, upload: () => ({ status: 200, body: "Error: signature verify failed" }) });
    const out = await new StockDriver().flash(dev("stock"), image(), t, "root:root");
    expect(out.ack).toBe("refused");
  });

  it("refuses on an auth rejection (HTTP 401)", async () => {
    const r = rec();
    const t = fakeTransport({ rec: r, upload: () => ({ status: 401, body: "" }) });
    const out = await new StockDriver().flash(dev("stock"), image(), t, "root:wrong");
    expect(out.ack).toBe("refused");
  });
});

describe("LuxOsDriver.flash", () => {
  it("logs on then triggers updaterun (pull) — no bytes pushed", async () => {
    const r = rec();
    const t = fakeTransport({
      rec: r,
      tcp: (cmd) =>
        cmd.includes("logon")
          ? JSON.stringify({ STATUS: [{ STATUS: "S" }], SESSION: [{ SessionID: "abc" }] })
          : JSON.stringify({ STATUS: [{ STATUS: "S", Msg: "update started" }] }),
    });
    const out = await new LuxOsDriver().flash(dev("luxos"), image({ family: "luxos", bytes: Buffer.alloc(0) }), t);
    expect(out.ack).toBe("flashed");
    expect(r.uploads).toHaveLength(0); // pull-based: never uploads
    expect(r.tcps.some((c) => c.includes("updaterun"))).toBe(true);
  });

  it("refuses safely when there is no newer image", async () => {
    const r = rec();
    const t = fakeTransport({
      rec: r,
      tcp: (cmd) =>
        cmd.includes("logon")
          ? JSON.stringify({ SESSION: [{ SessionID: "abc" }] })
          : JSON.stringify({ STATUS: [{ STATUS: "E", Msg: "No update available" }] }),
    });
    const out = await new LuxOsDriver().flash(dev("luxos"), image({ family: "luxos", bytes: Buffer.alloc(0) }), t);
    expect(out.ack).toBe("refused");
  });
});

describe("BraiinsDriver.flash", () => {
  it("logs into LuCI, scrapes the CSRF token, then uploads `image` with keep settings", async () => {
    const r = rec();
    const t = fakeTransport({
      rec: r,
      http: (req) =>
        req.path === "/cgi-bin/luci"
          ? { status: 200, body: "", headers: { "set-cookie": "sysauth=deadbeef; path=/" } }
          : { status: 200, body: '<input type="hidden" name="token" value="0123abcd4567ef89" />' },
      upload: () => ({ status: 200, body: "Flashing firmware, the device will reboot" }),
    });
    const out = await new BraiinsDriver().flash(dev("braiins"), image({ family: "braiins" }), t, "root:pw");
    expect(out.ack).toBe("flashed");
    expect(r.uploads[0]?.path).toBe("/cgi-bin/luci/admin/system/flashops/sysupgrade");
    expect(r.uploads[0]?.files[0]?.field).toBe("image");
    expect(r.uploads[0]?.fields).toMatchObject({ token: "0123abcd4567ef89", keep: "1" });
    expect(r.uploads[0]?.headers?.["cookie"]).toContain("sysauth=deadbeef");
  });

  it("refuses when LuCI login fails (no session cookie)", async () => {
    const r = rec();
    const t = fakeTransport({ rec: r, http: () => ({ status: 403, body: "denied" }) });
    const out = await new BraiinsDriver().flash(dev("braiins"), image({ family: "braiins" }), t, "root:bad");
    expect(out.ack).toBe("refused");
    expect(r.uploads).toHaveLength(0); // never uploaded without a session
  });
});
