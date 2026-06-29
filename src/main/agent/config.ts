import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface ConnectionState {
  agentId: string;
  agentName: string;
  serverAddr?: string; // host:port of the VPS
  fingerprint?: string; // pinned server cert SHA-256 fingerprint
  token?: string; // JWT from login
}

/**
 * Local, persistent connection settings for this install. The `agentId` is
 * generated once and kept stable so the server can anchor this install's devices.
 */
export class ConnectionConfig {
  private state: ConnectionState;

  constructor(private path?: string) {
    let loaded: Partial<ConnectionState> = {};
    if (path && existsSync(path)) {
      try {
        loaded = JSON.parse(readFileSync(path, "utf8")) as Partial<ConnectionState>;
      } catch {
        loaded = {};
      }
    }
    const generatedId = loaded.agentId === undefined;
    this.state = {
      agentId: loaded.agentId ?? randomUUID(),
      agentName: loaded.agentName ?? "agent",
      ...(loaded.serverAddr !== undefined ? { serverAddr: loaded.serverAddr } : {}),
      ...(loaded.fingerprint !== undefined ? { fingerprint: loaded.fingerprint } : {}),
      ...(loaded.token !== undefined ? { token: loaded.token } : {}),
    };
    // Only write on first run (when we minted a new agentId); never let a write
    // failure crash startup.
    if (generatedId) this.persist();
  }

  private persist(): void {
    if (!this.path) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.state, null, 2), "utf8");
    } catch {
      /* best-effort: keep running with in-memory state */
    }
  }

  get(): ConnectionState {
    return { ...this.state };
  }

  setServer(serverAddr: string, fingerprint: string): void {
    this.state.serverAddr = serverAddr;
    this.state.fingerprint = fingerprint;
    this.persist();
  }

  setAgentName(name: string): void {
    this.state.agentName = name;
    this.persist();
  }

  setToken(token: string): void {
    this.state.token = token;
    this.persist();
  }

  clearToken(): void {
    delete this.state.token;
    this.persist();
  }
}
