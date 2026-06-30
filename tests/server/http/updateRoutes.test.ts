import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleUpdatePublic } from "../../../server/src/http/updateRoutes";

function fakeRes(): ServerResponse & { statusCode: number } {
  const sink = new Writable({ write(_c, _e, cb) { cb(); } }) as unknown as ServerResponse & {
    statusCode: number;
    headersSent: boolean;
  };
  sink.statusCode = 0;
  (sink as { headersSent: boolean }).headersSent = false;
  sink.writeHead = ((s: number) => {
    sink.statusCode = s;
    (sink as { headersSent: boolean }).headersSent = true;
    return sink;
  }) as ServerResponse["writeHead"];
  return sink;
}
const req = (url: string): IncomingMessage => ({ method: "GET", url }) as unknown as IncomingMessage;

describe("handleUpdatePublic", () => {
  it("does NOT throw on malformed percent-encoding — returns 404 (one-request DoS fixed)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-"));
    for (const u of ["/firmware/%", "/firmware/%zz", "/updates/%", "/updates/%e0%a4"]) {
      const res = fakeRes();
      expect(() => handleUpdatePublic(req(u), res, dir)).not.toThrow();
      expect(res.statusCode).toBe(404);
    }
  });

  it("serves a firmware file ONLY if it is in the catalog allow-list (never .part/catalog.json)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ur-"));
    const fwDir = join(dir, "firmware");
    mkdirSync(fwDir, { recursive: true });
    writeFileSync(join(fwDir, "img.bin"), "FW");
    writeFileSync(join(fwDir, "img.bin.part"), "PARTIAL"); // in-flight upload temp
    writeFileSync(
      join(fwDir, "catalog.json"),
      JSON.stringify([
        { id: "1", family: "stock", model: "S19", version: "1", file: "img.bin", sha256: "x", size: 2, sig: "s", uploadedAt: 1 },
      ]),
    );

    const ok = fakeRes();
    handleUpdatePublic(req("/firmware/img.bin"), ok, dir);
    expect(ok.statusCode).toBe(200); // catalogued → served

    for (const u of ["/firmware/img.bin.part", "/firmware/catalog.json", "/firmware/notlisted.bin"]) {
      const res = fakeRes();
      handleUpdatePublic(req(u), res, dir);
      expect(res.statusCode).toBe(404); // not in allow-list → refused
    }
  });
});
