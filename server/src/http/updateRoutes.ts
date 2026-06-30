import type { IncomingMessage, ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";

/**
 * Public serving of the owner's self-hosted update feed:
 *   GET /update-manifest        → the signed manifest.json
 *   GET /updates/<installer.exe> → the installer binary
 * Clients verify the manifest signature + the binary SHA-256 before installing,
 * so these can be public. basename() blocks path traversal.
 */
export function handleUpdatePublic(req: IncomingMessage, res: ServerResponse, dataDir: string): boolean {
  if (req.method !== "GET") return false;
  const path = (req.url ?? "").split("?")[0] ?? "";
  const updatesDir = join(dataDir, "updates");

  if (path === "/update-manifest") {
    const f = join(updatesDir, "manifest.json");
    if (!existsSync(f)) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end("{}");
      return true;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    createReadStream(f).pipe(res);
    return true;
  }

  if (path.startsWith("/updates/")) {
    const name = basename(decodeURIComponent(path.slice("/updates/".length)));
    const f = join(updatesDir, name);
    if (!name || name === "manifest.json" || !existsSync(f) || !statSync(f).isFile()) {
      res.writeHead(404);
      res.end();
      return true;
    }
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": String(statSync(f).size),
    });
    createReadStream(f).pipe(res);
    return true;
  }
  return false;
}
