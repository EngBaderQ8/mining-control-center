# Mining Control Center v2 — Phase 2: Client (server connection + agent runtime) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Make the Electron app connect to the v2 server: authenticate, register the devices added on this install (anchored to this agent), push their status, execute commands routed from the server, and feed the all-account snapshot/updates to the UI.

**Architecture:** Every install is both an **agent** (for the devices added on it) and a **viewer** (sees all account devices via the server). A framework-free `AgentRuntime` orchestrates agent behavior over an abstract `ServerConnection`; a real `ServerClient` implements that connection with WebSocket + REST auth and cert-fingerprint pinning. Protocol message types move to a shared module imported by both app and server.

**Tech Stack:** Reuses existing drivers/poller/`MiningService`; adds `ws` client + `undici` REST in the main process. TDD for the runtime; integration code (ServerClient, wiring) verified against the running server.

**Spec:** `docs/superpowers/specs/2026-06-29-mining-control-center-v2-design.md`.

---

## Task 1: Relocate protocol to a shared module

**Files:**
- Create: `src/shared/protocol.ts` (moved content of `server/src/protocol/messages.ts`)
- Modify: `server/src/protocol/messages.ts` → re-export from shared; update `server/tsconfig.json` include
- Test: existing `tests/server/protocol/messages.test.ts` keeps passing

- [ ] **Step 1:** Create `src/shared/protocol.ts` with the exact content currently in `server/src/protocol/messages.ts`, but importing core types via `../core/...` (it's under `src/`).
- [ ] **Step 2:** Replace `server/src/protocol/messages.ts` body with `export * from "../../../src/shared/protocol";`.
- [ ] **Step 3:** Add `"../src/shared"` to `server/tsconfig.json` `include`.
- [ ] **Step 4:** Run `npx vitest run tests/server/protocol` → PASS; `npx tsc -p server/tsconfig.json --noEmit` → clean.
- [ ] **Step 5:** Commit — `git commit -am "refactor: share ws protocol between app and server"`

---

## Task 2: AgentRuntime (TDD)

**Files:**
- Create: `src/main/agent/runtime.ts`, `tests/core/agent/runtime.test.ts`

> `AgentRuntime` wires an abstract connection to local execution. On `start()` it sends `agent.hello` then a `device.register` per local device, and routes incoming `command.exec` to an injected executor, replying with `command.result`. `pushStatuses` sends `status.update`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { AgentRuntime, type ServerConnection } from "../../../src/main/agent/runtime";
import type { ClientMessage, ServerMessage } from "../../../src/shared/protocol";
import type { Device } from "../../../src/core/model/device";

const dev: Device = { id: "d1", siteId: "s1", name: "n", model: "S19", firmware: "stock", host: "192.168.1.5", apiPort: 4028, controlPort: 80 };

function fakeConn() {
  const sent: ClientMessage[] = [];
  let handler: (m: ServerMessage) => void = () => {};
  const conn: ServerConnection = { send: (m) => sent.push(m), onMessage: (h) => (handler = h) };
  return { conn, sent, emit: (m: ServerMessage) => handler(m) };
}

describe("AgentRuntime", () => {
  it("registers devices on start and answers command.exec with a result", async () => {
    const f = fakeConn();
    const calls: string[] = [];
    const rt = new AgentRuntime({
      agentId: "ag1", agentName: "site1", conn: f.conn,
      listDevices: () => [dev],
      execute: async (deviceId, command) => { calls.push(`${deviceId}:${command}`); return { deviceId, ok: true }; },
    });
    rt.start();
    expect(f.sent[0]).toMatchObject({ type: "agent.hello", agentId: "ag1" });
    expect(f.sent.find((m) => m.type === "device.register")).toMatchObject({ type: "device.register" });

    f.emit({ type: "command.exec", commandId: "c1", deviceId: "d1", command: "reboot" });
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual(["d1:reboot"]);
    expect(f.sent.find((m) => m.type === "command.result")).toMatchObject({ type: "command.result", commandId: "c1", outcome: { ok: true } });
  });

  it("pushStatuses sends a status.update", () => {
    const f = fakeConn();
    const rt = new AgentRuntime({ agentId: "ag1", agentName: "s", conn: f.conn, listDevices: () => [], execute: async () => ({ deviceId: "x", ok: true }) });
    rt.pushStatuses([{ deviceId: "d1", state: "online", hashrateTHs: 95, avgHashrateTHs: 95, maxTempC: 60, fanRpm: 4000, pool: "p", worker: "w", hwErrorRate: 0, uptimeSec: 1, lastSeen: 1 }]);
    expect(f.sent[0]).toMatchObject({ type: "status.update" });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/main/agent/runtime.ts`)

```ts
import type { ClientMessage, ServerMessage } from "../../shared/protocol";
import type { Device, DeviceStatus } from "../../core/model/device";
import type { ControlCommand } from "../../core/drivers/types";
import type { CommandOutcome } from "../../core/model/result";

export interface ServerConnection {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): void;
}

export interface AgentDeps {
  agentId: string;
  agentName: string;
  conn: ServerConnection;
  listDevices: () => Device[];
  execute: (deviceId: string, command: ControlCommand, params?: Record<string, string>) => Promise<CommandOutcome>;
}

export class AgentRuntime {
  constructor(private deps: AgentDeps) {}

  start(): void {
    this.deps.conn.onMessage((m) => this.onMessage(m));
    this.deps.conn.send({ type: "agent.hello", agentId: this.deps.agentId, name: this.deps.agentName });
    for (const device of this.deps.listDevices())
      this.deps.conn.send({ type: "device.register", device });
  }

  registerDevice(device: Device): void {
    this.deps.conn.send({ type: "device.register", device });
  }

  pushStatuses(statuses: DeviceStatus[]): void {
    this.deps.conn.send({ type: "status.update", statuses });
  }

  private onMessage(m: ServerMessage): void {
    if (m.type !== "command.exec") return;
    void this.deps
      .execute(m.deviceId, m.command, m.params)
      .then((outcome) => this.deps.conn.send({ type: "command.result", commandId: m.commandId, outcome }))
      .catch((e: Error) =>
        this.deps.conn.send({ type: "command.result", commandId: m.commandId, outcome: { deviceId: m.deviceId, ok: false, error: e.message } }));
  }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(agent): agent runtime (register/execute/push status)"`

---

## Task 3: ServerClient (WS + REST + cert pinning) — integration

**Files:**
- Create: `src/main/agent/serverClient.ts`

> Implements `ServerConnection` plus REST auth. `signup`/`login` POST to `https://<addr>/auth/*` via `undici` with a custom TLS check that pins the server cert SHA-256 fingerprint (from config). `connect(token)` opens `wss://<addr>/?token=...` with the same pinning, exposes `send`/`onMessage`, and auto-reconnects with backoff.

- [ ] **Step 1: Implement** `ServerClient` with: `setServer(addr, fingerprint)`, `signup(email,pw)`, `login(email,pw)` (return `{token}|error`), `connect(token)`, `send(msg)`, `onMessage(h)`, `onState(cb)` (connected/disconnected). Pin the cert by comparing the peer certificate fingerprint to the configured one (undici `connect`/`ws` `checkServerIdentity`/`ca` or `rejectUnauthorized:false` + manual fingerprint compare on the socket's `getPeerCertificate()`).
- [ ] **Step 2: Manual check** against the running server (`npm run server:start`): from a small script, `login` then `connect`, send `snapshot.request`, log the `snapshot`. (Mirrors the Phase 1 smoke but through `ServerClient`.)
- [ ] **Step 3: Commit** — `git commit -am "feat(agent): server client (ws+rest+cert pinning)"`

---

## Task 4: Config store (server address, token, agentId)

**Files:**
- Create: `src/main/agent/config.ts`, `tests/core/agent/config.test.ts`

> A tiny JSON config (in `userData/connection.json`) holding `serverAddr`, `fingerprint`, `token`, `agentId` (generated once), `agentName`. TDD the read/write/default-agentId behavior (in-memory + file like the device repo).

- [ ] **Step 1: Failing test** — new config has a generated `agentId`; set/get round-trips; persists to a file and reloads.
- [ ] **Step 2: Implement** `ConnectionConfig` (constructor optional path; `get()`, `setServer`, `setToken`, `clearToken`; auto-generate `agentId` via `crypto.randomUUID()` on first construction and persist).
- [ ] **Step 3: Run PASS. Commit** — `git commit -am "feat(agent): connection config store"`

---

## Task 5: Wire main process to dual role

**Files:**
- Modify: `src/main/service.ts`, `src/main/index.ts`, `src/main/ipc.ts`, `src/preload/preload.ts`, `src/shared/api.ts`

> Repurpose the local `MiningService` as the agent's local engine (poll local devices, execute commands with local secrets). Add a `ServerBridge` that: builds `ServerClient`+`AgentRuntime`+`ConnectionConfig`; on login/connect, starts the agent (register local devices, poll loop → `pushStatuses`); subscribes to server `snapshot`/`status.update` and forwards them to the renderer; routes renderer commands as `command.send` to the server (ack relayed back). Add IPC: `auth:signup`, `auth:login`, `auth:status`, `server:set` (addr+fingerprint). Keep `device:add` (now also `registerDevice` on the agent). `snapshot:get`/`statuses:update` now serve server data.

- [ ] **Step 1: Implement** the `ServerBridge` and IPC additions; the local engine executes commands for this agent's devices; the UI feed comes from the server.
- [ ] **Step 2: Commit** — `git commit -am "feat(main): dual-role server bridge + auth ipc"`

---

## Task 6 (→ Phase 3): Renderer login + server-driven dashboard
Tracked separately as Phase 3 (login/signup screen, server-address+fingerprint setup, dashboard reads server feed, commands go through the server).

---

## Self-Review
- Protocol shared (T1); agent register/execute/status (T2 tested); real transport + pinning (T3); config+agentId (T4 tested); dual-role wiring + auth IPC (T5). Renderer auth UI deferred to Phase 3 (spec §11). Types reuse `ClientMessage`/`ServerMessage`/`Device`/`DeviceStatus`/`ControlCommand`/`CommandOutcome`. TDD covers the runtime + config; ServerClient/bridge are integration verified against the live server.
