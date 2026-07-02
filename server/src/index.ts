import { createServer } from "node:https";
import { join } from "node:path";
import Database from "better-sqlite3";
import { WebSocketServer, type WebSocket } from "ws";
import { applySchema } from "./db/schema";
import { ServerRepo } from "./db/repo";
import { AuthService } from "./auth/service";
import { verifyToken } from "./auth/jwt";
import { CommandRouter } from "./router/commandRouter";
import {
  detectIncidents,
  readOwnerConfig,
  sendOwnerTelegram,
  type IncidentState,
} from "./monitor/ownerAlerts";
import { FlashSequencer } from "./firmware/sequencer";
import { ConnectionHub } from "./ws/hub";
import { createPrivateKey, sign as edSign, type KeyObject } from "node:crypto";
import { handleAuth } from "./http/authRoutes";
import { handleAdmin } from "./http/adminRoutes";
import { handleUpdatePublic } from "./http/updateRoutes";
import { handleDownload } from "./http/downloadRoute";
import { loadOrCreateTls } from "./tls";
import { isClientMessage, type ServerMessage } from "./protocol/messages";

// Never let a single malformed request (or any stray async error) take down the
// multi-tenant server: log and keep serving instead of the Node-default crash.
process.on("unhandledRejection", (e) => console.error("[server] unhandledRejection:", e));
process.on("uncaughtException", (e) => console.error("[server] uncaughtException:", e));

const PORT = Number(process.env["PORT"] ?? 8443);
const DATA_DIR = process.env["DATA_DIR"] ?? join(__dirname, "..", "..", "server", "data");
const JWT_SECRET = process.env["JWT_SECRET"] ?? "";
// Owner admin emails (comma-separated). Only these accounts can open /admin.
const ADMIN_EMAILS = new Set(
  (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

// Fail-closed: the whole auth/admin model trusts tokens signed with this secret.
// A missing/weak/known secret lets anyone forge an admin token — refuse to start.
if (!JWT_SECRET || JWT_SECRET.length < 16 || JWT_SECRET === "dev-insecure-secret-change-me") {
  console.error(
    "[server] FATAL: JWT_SECRET must be set to a strong random value (>=16 chars). Refusing to start.",
  );
  process.exit(1);
}

// Ed25519 private key for signing self-hosted update manifests (base64 of the PEM
// in env UPDATE_PRIVATE_KEY). Without it, the upload feature is disabled.
let updatePrivKey: KeyObject | null = null;
try {
  const b64 = process.env["UPDATE_PRIVATE_KEY"];
  if (b64) updatePrivKey = createPrivateKey(Buffer.from(b64, "base64").toString("utf8"));
} catch {
  console.warn("[server] UPDATE_PRIVATE_KEY is set but invalid — update uploads disabled");
}
function signManifest(payload: string): string | null {
  return updatePrivKey ? edSign(null, Buffer.from(payload), updatePrivKey).toString("base64") : null;
}

async function main(): Promise<void> {
  const { key, cert } = await loadOrCreateTls(DATA_DIR);

  const db = new Database(join(DATA_DIR, "app.db"));
  applySchema(db);
  const repo = new ServerRepo(db);
  // A crash/restart can leave a flash job pinned mid-flight (its in-memory watchdog is
  // gone). Fail those and stop their batches so nothing dangles and no half-finished
  // flash silently resumes.
  repo.reconcileInterruptedFlashJobs();
  const auth = new AuthService(repo, JWT_SECRET);
  const router = new CommandRouter();
  const flashSequencer = new FlashSequencer(repo, router, DATA_DIR);

  // Snapshot fleet-wide metrics every 10 min for the admin dashboard trend chart.
  const snapshotMetrics = (): void => {
    const o = repo.adminOverview();
    repo.recordMetric(Date.now(), o.hashrate, o.devices, o.online, o.users);
  };
  snapshotMetrics();
  setInterval(snapshotMetrics, 10 * 60 * 1000);

  // Owner incident monitor: every 2 min, compare each account to the previous run
  // and Telegram the owner on a mass-offline / hashrate-crash. First run just sets
  // the baseline (no prev state → no alerts), so it never fires on startup.
  let incidentState: IncidentState = {};
  const monitorIncidents = async (): Promise<void> => {
    try {
      const accts = repo.accountSummaries().map((a) => ({
        id: a.id,
        email: a.email,
        devices: a.devices,
        online: a.online,
        hashrate: a.hashrate,
      }));
      const { incidents, state } = detectIncidents(accts, incidentState, Date.now());
      incidentState = state;
      const cfg = readOwnerConfig(DATA_DIR);
      if (cfg.enabled && cfg.token && cfg.chatId)
        for (const inc of incidents) await sendOwnerTelegram(cfg.token, cfg.chatId, inc.message);
    } catch (e) {
      console.error("[owner-alerts] monitor run failed:", (e as Error).message);
    }
  };
  setInterval(() => void monitorIncidents(), 2 * 60 * 1000);

  // Sockets grouped by user, for broadcasting status updates.
  const userSockets = new Map<string, Set<WebSocket>>();
  function broadcast(userId: string, msg: ServerMessage): void {
    const set = userSockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const s of set) if (s.readyState === s.OPEN) s.send(data);
  }
  // Tell clients to check for an app update now. userId targets one customer's
  // installs; omitted = the whole fleet. Returns how many sockets were notified.
  function pushUpdate(userId?: string): number {
    const data = JSON.stringify({ type: "update.now" } satisfies ServerMessage);
    const sets = userId ? [userSockets.get(userId)] : [...userSockets.values()];
    let count = 0;
    for (const set of sets) {
      if (!set) continue;
      for (const s of set) if (s.readyState === s.OPEN) {
        s.send(data);
        count++;
      }
    }
    return count;
  }

  const server = createServer({ key, cert }, (req, res) => {
    void (async () => {
      // Public, secret-free health probe: reports whether update-signing is configured
      // (i.e. UPDATE_PRIVATE_KEY is set) so upload failures can be diagnosed without shell
      // access. Exposes only booleans — never any key material.
      if ((req.url ?? "").split("?")[0] === "/health" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
        res.end(JSON.stringify({ ok: true, signing: !!updatePrivKey }));
        return;
      }
      if (handleDownload(req, res, DATA_DIR)) return;
      if (handleUpdatePublic(req, res, DATA_DIR)) return;
      if (
        await handleAdmin(req, res, {
          repo,
          jwtSecret: JWT_SECRET,
          adminEmails: ADMIN_EMAILS,
          pushUpdate,
          router,
          flashSequencer,
          dataDir: DATA_DIR,
          signManifest,
        })
      )
        return;
      if (await handleAuth(req, res, auth)) return;
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    })().catch((e) => {
      // A handler threw (e.g. malformed input): log, return 500 if we still can, and
      // NEVER let it bubble to an unhandled rejection that could kill the process.
      console.error("[server] request handler error:", e);
      try {
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "internal error" }));
        }
      } catch {
        /* ignore */
      }
    });
  });

  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const userId = verifyToken(url.searchParams.get("token") ?? "", JWT_SECRET);
    if (!userId) {
      ws.close(4401, "unauthorized");
      return;
    }
    // Suspension cuts off data sync too (not just login) — block the handshake.
    if (repo.findUserById(userId)?.suspended) {
      ws.close(4403, "suspended");
      return;
    }
    let set = userSockets.get(userId);
    if (!set) {
      set = new Set();
      userSockets.set(userId, set);
    }
    set.add(ws);

    const hub = new ConnectionHub(
      userId,
      (m) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      },
      repo,
      router,
      broadcast,
      flashSequencer,
    );

    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (isClientMessage(parsed)) void hub.handleMessage(parsed);
    });

    ws.on("close", () => {
      hub.onClose();
      set.delete(ws);
    });
  });

  server.listen(PORT, () => console.log(`[server] listening on https://0.0.0.0:${PORT}`));
}

void main();
