import { app } from "electron";
import { createWriteStream, createReadStream, mkdirSync, existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash, verify as cryptoVerify } from "node:crypto";
import { spawn } from "node:child_process";
import { get as httpsGet } from "node:https";
import { UPDATE_PUBLIC_KEY } from "./updateKey";

interface Manifest {
  version: string;
  file: string;
  sha256: string;
  size: number;
  uploadedAt: number;
  sig: string; // base64 Ed25519 sig over `${version}:${sha256}:${size}:${uploadedAt}:${file}`
}

/** Is `a` a strictly newer x.y.z than `b`? */
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map((x) => Number(x) || 0);
  const pb = b.split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

// Persisted highest manifest freshness ever accepted — blocks replay of an older
// (but validly-signed) manifest over the unauthenticated connection.
function stateFile(): string {
  return join(app.getPath("userData"), "serverUpdateState.json");
}
function lastUploadedAt(): number {
  try {
    return Number((JSON.parse(readFileSync(stateFile(), "utf8")) as { lastUploadedAt?: number }).lastUploadedAt) || 0;
  } catch {
    return 0;
  }
}
function rememberUploadedAt(n: number): void {
  try {
    writeFileSync(stateFile(), JSON.stringify({ lastUploadedAt: n }));
  } catch {
    /* ignore */
  }
}

function fetchManifest(url: string): Promise<Manifest | null> {
  return new Promise((resolve) => {
    const req = httpsGet(url, { rejectUnauthorized: false, timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        resolve(null);
        return;
      }
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(d) as Manifest);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function download(url: string, dest: string): Promise<boolean> {
  return new Promise((resolve) => {
    const file = createWriteStream(dest);
    const req = httpsGet(url, { rejectUnauthorized: false, timeout: 180000 }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        file.close();
        resolve(false);
        return;
      }
      res.pipe(file);
      file.on("finish", () => file.close(() => resolve(true)));
      file.on("error", () => resolve(false));
    });
    req.on("error", () => {
      file.close();
      resolve(false);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function sha256File(p: string): Promise<string> {
  return new Promise((resolve) => {
    const h = createHash("sha256");
    const s = createReadStream(p);
    s.on("data", (c) => h.update(c));
    s.on("end", () => resolve(h.digest("hex")));
    s.on("error", () => resolve(""));
  });
}

let busy = false;

/**
 * Owner's private update channel. Pull a SIGNED manifest from the owner's server
 * and, only if every check passes, download + install. Trust comes ENTIRELY from
 * the Ed25519 signature (not the connection, which is self-signed):
 *   1. validate field formats; 2. must be a newer version than running AND fresher
 *   than the last accepted manifest (anti-rollback/replay); 3. verify the signature
 *   over the WHOLE manifest with the embedded public key; 4. download; 5. verify
 *   the SHA-256 matches the signed hash; 6. run the silent installer (relaunches).
 * No-op in dev/unpackaged.
 */
export async function checkServerUpdate(
  serverBase: string,
  log: (s: string) => void,
  onInstalling: () => void,
): Promise<void> {
  if (busy || !app.isPackaged || !serverBase) return;
  busy = true;
  try {
    const m = await fetchManifest(`${serverBase}/update-manifest`);
    if (!m) return;
    const sha = String(m.sha256 ?? "").toLowerCase();
    if (
      !/^\d+\.\d+\.\d+$/.test(m.version) ||
      !/^[0-9a-f]{64}$/.test(sha) ||
      !/^[A-Za-z0-9._-]+\.exe$/.test(m.file ?? "") ||
      !Number.isInteger(m.size) ||
      !Number.isInteger(m.uploadedAt) ||
      !m.sig
    ) {
      log("server manifest rejected: bad format");
      return;
    }
    if (!isNewer(m.version, app.getVersion())) return;
    if (m.uploadedAt <= lastUploadedAt()) {
      log(`server manifest ${m.version} rejected: not fresher than last accepted (replay?)`);
      return;
    }
    // Verify the signature over the WHOLE manifest BEFORE downloading anything.
    const payload = Buffer.from(`${m.version}:${sha}:${m.size}:${m.uploadedAt}:${m.file}`);
    let okSig = false;
    try {
      okSig = cryptoVerify(null, payload, UPDATE_PUBLIC_KEY, Buffer.from(m.sig, "base64"));
    } catch {
      okSig = false;
    }
    if (!okSig) {
      log(`server update ${m.version} REJECTED: bad signature`);
      return;
    }
    const dir = join(app.getPath("userData"), "updates");
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, `mcc-update-${m.version}.exe`);
    log(`downloading server update ${m.version}…`);
    if (!(await download(`${serverBase}/updates/${encodeURIComponent(m.file)}`, dest))) {
      log("server update download failed");
      return;
    }
    if ((await sha256File(dest)).toLowerCase() !== sha) {
      log("server update hash mismatch — aborted");
      try {
        rmSync(dest, { force: true });
      } catch {
        /* ignore */
      }
      return;
    }
    // Record freshness BEFORE launching, so a crash can't reopen the replay window.
    rememberUploadedAt(m.uploadedAt);
    log(`installing server update ${m.version}…`);
    onInstalling();
    // Silent NSIS install relaunches the app afterwards (same as electron-updater).
    spawn(dest, ["/S", "--force-run"], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => app.quit(), 3000);
  } catch (e) {
    log(`server update error: ${(e as Error).message}`);
  } finally {
    busy = false;
  }
}
