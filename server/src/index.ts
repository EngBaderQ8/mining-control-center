import { createServer } from "node:https";
import { join } from "node:path";
import Database from "better-sqlite3";
import { WebSocketServer, type WebSocket } from "ws";
import { applySchema } from "./db/schema";
import { ServerRepo } from "./db/repo";
import { AuthService } from "./auth/service";
import { verifyToken } from "./auth/jwt";
import { CommandRouter } from "./router/commandRouter";
import { ConnectionHub } from "./ws/hub";
import { handleAuth } from "./http/authRoutes";
import { handleDownload } from "./http/downloadRoute";
import { loadOrCreateTls } from "./tls";
import { isClientMessage, type ServerMessage } from "./protocol/messages";

const PORT = Number(process.env["PORT"] ?? 8443);
const DATA_DIR = process.env["DATA_DIR"] ?? join(__dirname, "..", "..", "server", "data");
const JWT_SECRET = process.env["JWT_SECRET"] ?? "dev-insecure-secret-change-me";

if (JWT_SECRET === "dev-insecure-secret-change-me")
  console.warn("[server] WARNING: using default JWT_SECRET — set JWT_SECRET in production");

async function main(): Promise<void> {
  const { key, cert } = await loadOrCreateTls(DATA_DIR);

  const db = new Database(join(DATA_DIR, "app.db"));
  applySchema(db);
  const repo = new ServerRepo(db);
  const auth = new AuthService(repo, JWT_SECRET);
  const router = new CommandRouter();

  // Sockets grouped by user, for broadcasting status updates.
  const userSockets = new Map<string, Set<WebSocket>>();
  function broadcast(userId: string, msg: ServerMessage): void {
    const set = userSockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const s of set) if (s.readyState === s.OPEN) s.send(data);
  }

  const server = createServer({ key, cert }, (req, res) => {
    void (async () => {
      if (handleDownload(req, res, DATA_DIR)) return;
      if (await handleAuth(req, res, auth)) return;
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    })();
  });

  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws, req) => {
    const url = new URL(req.url ?? "", "http://localhost");
    const userId = verifyToken(url.searchParams.get("token") ?? "", JWT_SECRET);
    if (!userId) {
      ws.close(4401, "unauthorized");
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
