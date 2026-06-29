import { request as httpsRequest } from "node:https";
import type { TLSSocket } from "node:tls";
import WebSocket from "ws";
import type { ClientMessage, ServerMessage } from "../../shared/protocol";
import type { ServerConnection } from "./runtime";
import type { ConnectionConfig } from "./config";

export type AuthResult = { ok: true; token: string } | { ok: false; error: string };

const normFp = (fp: string): string => fp.replace(/:/g, "").toUpperCase();

/**
 * Real connection to the v2 server: REST auth + WebSocket, both over TLS with
 * certificate-fingerprint pinning (trust-on-first-use, then enforce). Implements
 * ServerConnection so AgentRuntime can use it directly.
 */
export class ServerClient implements ServerConnection {
  private ws: WebSocket | null = null;
  private handlers: ((m: ServerMessage) => void)[] = [];
  private stateCb: (connected: boolean) => void = () => {};
  private wantConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private config: ConnectionConfig) {}

  /** Register a message handler. Multiple subscribers all receive every message. */
  onMessage(handler: (m: ServerMessage) => void): void {
    this.handlers.push(handler);
  }

  private dispatch(m: ServerMessage): void {
    for (const h of this.handlers) h(m);
  }
  onState(cb: (connected: boolean) => void): void {
    this.stateCb = cb;
  }

  private hostPort(): { host: string; port: number } {
    const addr = this.config.get().serverAddr ?? "";
    const [host, port] = addr.split(":");
    return { host: host || "localhost", port: Number(port) || 8443 };
  }

  /** Verify the peer cert fingerprint against the pinned one, pinning on first use. */
  private verifyPin(socket: TLSSocket): Error | null {
    const peer = socket.getPeerCertificate();
    const fp = peer && peer.fingerprint256 ? normFp(peer.fingerprint256) : "";
    if (!fp) return new Error("no server certificate");
    const pinned = this.config.get().fingerprint;
    if (!pinned) {
      const { host, port } = this.hostPort();
      this.config.setServer(`${host}:${port}`, fp); // trust on first use
      return null;
    }
    return normFp(pinned) === fp ? null : new Error("server certificate fingerprint mismatch");
  }

  private auth(path: string, email: string, password: string): Promise<AuthResult> {
    const { host, port } = this.hostPort();
    const body = JSON.stringify({ email, password });
    return new Promise((resolve) => {
      const req = httpsRequest(
        {
          host,
          port,
          path,
          method: "POST",
          rejectUnauthorized: false,
          headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
        },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data || "{}") as { token?: string; error?: string };
              if (res.statusCode === 200 && parsed.token) resolve({ ok: true, token: parsed.token });
              else resolve({ ok: false, error: parsed.error ?? `HTTP ${res.statusCode}` });
            } catch {
              resolve({ ok: false, error: "bad server response" });
            }
          });
        },
      );
      req.on("socket", (socket) => {
        socket.on("secureConnect", () => {
          const err = this.verifyPin(socket as TLSSocket);
          if (err) {
            req.destroy(err);
            resolve({ ok: false, error: err.message });
          }
        });
      });
      req.on("error", (e) => resolve({ ok: false, error: e.message }));
      req.write(body);
      req.end();
    });
  }

  signup(email: string, password: string): Promise<AuthResult> {
    return this.auth("/auth/signup", email, password);
  }
  login(email: string, password: string): Promise<AuthResult> {
    return this.auth("/auth/login", email, password);
  }

  connect(token: string): void {
    this.wantConnected = true;
    const { host, port } = this.hostPort();
    const ws = new WebSocket(`wss://${host}:${port}/?token=${encodeURIComponent(token)}`, {
      rejectUnauthorized: false,
    });
    this.ws = ws;

    ws.on("upgrade", (res) => {
      const err = this.verifyPin(res.socket as TLSSocket);
      if (err) ws.close(4400, err.message);
    });
    ws.on("open", () => this.stateCb(true));
    ws.on("message", (raw: WebSocket.RawData) => {
      try {
        this.dispatch(JSON.parse(raw.toString()) as ServerMessage);
      } catch {
        /* ignore malformed */
      }
    });
    ws.on("close", () => {
      this.stateCb(false);
      if (this.wantConnected) this.scheduleReconnect(token);
    });
    ws.on("error", () => {
      /* close handler will schedule reconnect */
    });
  }

  private scheduleReconnect(token: string): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantConnected) this.connect(token);
    }, 5000);
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  disconnect(): void {
    this.wantConnected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}
