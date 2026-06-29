# Mining Control Center v2 — Phase 1: Backend Server — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the VPS backend that authenticates accounts, stores sites/devices/status, and routes commands between viewer clients and the site agents that can reach each ASIC — over TLS WebSocket.

**Architecture:** A standalone Node + TypeScript service in `server/`, separate from the Electron app but in the same repo, reusing `src/core/model` types and a new shared protocol module. Pure logic (password hashing, JWT, auth service, command router, message validation) lives in framework-free modules and is unit-tested with Vitest. The HTTP(S)+WS wiring is a thin shell over that core. Storage is server-side SQLite (plain Node — no Electron, so no ABI concerns).

**Tech Stack:** Node, TypeScript, `ws` (WebSocket), `jsonwebtoken`, `bcryptjs`, `better-sqlite3` (server-only), `tsx` (run/dev), Node `https`/`tls` with a self-signed certificate. Vitest for tests.

**Spec:** `docs/superpowers/specs/2026-06-29-mining-control-center-v2-design.md` (§5 data model, §6 auth, §7 protocol).

**Conventions:** Strict TS, no `any`. TDD for everything in `server/src/{auth,db,router,protocol}`. Commit after each passing step. The server reuses `Device`, `Site`, `DeviceStatus`, `Firmware` from `src/core/model/device.ts` and `ControlCommand` from `src/core/drivers/types.ts`.

---

## File Structure

```
server/
├── tsconfig.json              # extends root, CommonJS/node16, includes server/src + src/core
├── src/
│   ├── protocol/
│   │   └── messages.ts        # shared WS message envelope + payload types (agent/viewer <-> server)
│   ├── db/
│   │   ├── schema.ts          # sqlite schema (users, agents, sites, devices, device_status)
│   │   └── repo.ts            # ServerRepo CRUD over the schema
│   ├── auth/
│   │   ├── password.ts        # hashPassword / verifyPassword (bcryptjs)
│   │   ├── jwt.ts             # signToken / verifyToken (jsonwebtoken)
│   │   └── service.ts         # AuthService: signup / login (uses repo + password + jwt)
│   ├── router/
│   │   └── commandRouter.ts   # agentId -> sender registry; routeCommand + resolveResult (promise correlation)
│   ├── ws/
│   │   └── hub.ts             # ConnectionHub: validates messages, applies them to repo/router (transport-free)
│   ├── http/
│   │   └── authRoutes.ts      # tiny request handler for /auth/signup and /auth/login
│   ├── tls.ts                 # load-or-generate self-signed cert (selfsigned)
│   └── index.ts               # bootstrap: https server + ws server + wiring
└── data/                      # runtime sqlite file (gitignored)
tests/server/                  # mirrors server/src
```

---

## Task 1: Server scaffold & dependencies

**Files:**
- Create: `server/tsconfig.json`
- Modify: `package.json` (deps + scripts), `.gitignore`

- [ ] **Step 1: Install server dependencies**

```bash
npm i ws jsonwebtoken bcryptjs better-sqlite3 selfsigned
npm i -D @types/ws @types/jsonwebtoken @types/bcryptjs @types/better-sqlite3 tsx
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "module": "node16",
    "moduleResolution": "node16",
    "outDir": "../dist-server",
    "rootDir": "..",
    "types": ["node"],
    "noEmit": false
  },
  "include": ["src", "../src/core"]
}
```

- [ ] **Step 3: Add scripts to root `package.json`**

```json
"server:dev": "tsx watch server/src/index.ts",
"server:start": "tsx server/src/index.ts",
"server:build": "tsc -p server/tsconfig.json"
```

- [ ] **Step 4: Add to `.gitignore`**

```
server/data/
dist-server/
*.pem
```

- [ ] **Step 5: Verify install** — Run: `npx tsc -p server/tsconfig.json --noEmit` → Expected: no output, exit 0 (empty project typechecks).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "chore(server): scaffold v2 backend deps + tsconfig"`

---

## Task 2: Shared protocol message types

**Files:**
- Create: `server/src/protocol/messages.ts`, `tests/server/protocol/messages.test.ts`

> A single discriminated union for every message crossing the WebSocket, plus a type guard. Reuses `Device`, `Site`, `DeviceStatus` and `ControlCommand`.

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { isClientMessage } from "../../../server/src/protocol/messages";

describe("protocol messages", () => {
  it("accepts a well-formed command.send and rejects junk", () => {
    expect(isClientMessage({ type: "command.send", commandId: "c1", deviceId: "d1", command: "reboot" })).toBe(true);
    expect(isClientMessage({ type: "nope" })).toBe(false);
    expect(isClientMessage(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`server/src/protocol/messages.ts`)

```ts
import type { Device, Site, DeviceStatus } from "../../../src/core/model/device";
import type { ControlCommand } from "../../../src/core/drivers/types";
import type { CommandOutcome } from "../../../src/core/model/result";

// Agent -> Server
export interface AgentHello { type: "agent.hello"; agentId: string; name: string; }
export interface DeviceRegister { type: "device.register"; device: Device; }
export interface StatusUpdate { type: "status.update"; statuses: DeviceStatus[]; }
export interface CommandResult { type: "command.result"; commandId: string; outcome: CommandOutcome; }

// Viewer -> Server
export interface SnapshotRequest { type: "snapshot.request"; }
export interface CommandSend {
  type: "command.send"; commandId: string; deviceId: string;
  command: ControlCommand; params?: Record<string, string>;
}

// Server -> Viewer
export interface SnapshotMsg { type: "snapshot"; sites: Site[]; devices: Device[]; statuses: DeviceStatus[]; }
export interface CommandAck { type: "command.ack"; commandId: string; outcome: CommandOutcome; }

// Server -> Agent
export interface CommandExec {
  type: "command.exec"; commandId: string; deviceId: string;
  command: ControlCommand; params?: Record<string, string>;
}

export type AgentMessage = AgentHello | DeviceRegister | StatusUpdate | CommandResult;
export type ViewerMessage = SnapshotRequest | CommandSend;
export type ClientMessage = AgentMessage | ViewerMessage;
export type ServerMessage = SnapshotMsg | CommandAck | CommandExec | StatusUpdate;

const CLIENT_TYPES = new Set([
  "agent.hello", "device.register", "status.update", "command.result",
  "snapshot.request", "command.send",
]);

export function isClientMessage(v: unknown): v is ClientMessage {
  return !!v && typeof v === "object" && "type" in v &&
    typeof (v as { type: unknown }).type === "string" &&
    CLIENT_TYPES.has((v as { type: string }).type);
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(server): shared ws protocol messages"`

---

## Task 3: Password hashing

**Files:**
- Create: `server/src/auth/password.ts`, `tests/server/auth/password.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../../server/src/auth/password";

describe("password", () => {
  it("hashes and verifies, rejecting wrong passwords", async () => {
    const h = await hashPassword("s3cret");
    expect(h).not.toBe("s3cret");
    expect(await verifyPassword("s3cret", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`server/src/auth/password.ts`)

```ts
import bcrypt from "bcryptjs";
export function hashPassword(plain: string): Promise<string> { return bcrypt.hash(plain, 10); }
export function verifyPassword(plain: string, hash: string): Promise<boolean> { return bcrypt.compare(plain, hash); }
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(server): bcrypt password hashing"`

---

## Task 4: JWT sign/verify

**Files:**
- Create: `server/src/auth/jwt.ts`, `tests/server/auth/jwt.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "../../../server/src/auth/jwt";

describe("jwt", () => {
  it("round-trips a userId and rejects tampered tokens", () => {
    const t = signToken("user-1", "secret");
    expect(verifyToken(t, "secret")).toBe("user-1");
    expect(verifyToken(t + "x", "secret")).toBeNull();
    expect(verifyToken(t, "other-secret")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`server/src/auth/jwt.ts`)

```ts
import jwt from "jsonwebtoken";
export function signToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "30d" });
}
export function verifyToken(token: string, secret: string): string | null {
  try {
    const d = jwt.verify(token, secret);
    return typeof d === "object" && d && typeof d.sub === "string" ? d.sub : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(server): jwt sign/verify"`

---

## Task 5: Server SQLite schema + repo

**Files:**
- Create: `server/src/db/schema.ts`, `server/src/db/repo.ts`, `tests/server/db/repo.test.ts`

> Server-side better-sqlite3 (plain Node — no Electron ABI issue). Tables: users, agents, sites, devices, device_status. All rows scoped by `userId`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../../server/src/db/schema";
import { ServerRepo } from "../../../server/src/db/repo";

describe("ServerRepo", () => {
  it("creates a user, scopes sites/devices, and stores status", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const repo = new ServerRepo(db);
    const uid = repo.createUser("a@b.com", "hash");
    expect(repo.findUserByEmail("a@b.com")?.id).toBe(uid);
    repo.upsertSite({ id: "s1", userId: uid, name: "الرياض" });
    repo.upsertDevice({ id: "d1", userId: uid, siteId: "s1", agentId: "ag1",
      name: "S19-01", model: "S19", firmware: "stock", host: "192.168.1.50", apiPort: 4028, controlPort: 80 });
    expect(repo.listDevices(uid)).toHaveLength(1);
    repo.upsertStatus(uid, { deviceId: "d1", state: "online", hashrateTHs: 95, avgHashrateTHs: 95,
      maxTempC: 60, fanRpm: 4000, pool: "p", worker: "w", hwErrorRate: 0, uptimeSec: 1, lastSeen: 1 });
    expect(repo.listStatuses(uid)[0]?.state).toBe("online");
    expect(repo.deviceAgent(uid, "d1")).toBe("ag1");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement `schema.ts`**

```ts
import type Database from "better-sqlite3";
export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, lastSeenAt INTEGER);
    CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, siteId TEXT NOT NULL, agentId TEXT NOT NULL,
      name TEXT NOT NULL, model TEXT NOT NULL, firmware TEXT NOT NULL, host TEXT NOT NULL,
      apiPort INTEGER NOT NULL, controlPort INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS device_status (
      deviceId TEXT PRIMARY KEY, userId TEXT NOT NULL, state TEXT, hashrateTHs REAL, avgHashrateTHs REAL,
      maxTempC REAL, fanRpm REAL, pool TEXT, worker TEXT, hwErrorRate REAL, uptimeSec INTEGER, lastSeen INTEGER);
  `);
}
```

- [ ] **Step 4: Implement `repo.ts`** with `ServerRepo` exposing: `createUser(email,hash):string` (returns generated id via `crypto.randomUUID()`), `findUserByEmail(email)`, `upsertSite(SiteRow)`, `upsertDevice(DeviceRow)`, `listSites(userId)`, `listDevices(userId)`, `deleteDevice(userId,id)`, `upsertStatus(userId,DeviceStatus)`, `listStatuses(userId)`, `deviceAgent(userId,deviceId)`, `touchAgent(id,userId,name)`. Use prepared statements; `SiteRow = Site & {userId}`, `DeviceRow = Device & {userId, agentId}`. Import `randomUUID` from `node:crypto`.

```ts
import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Site, Device, DeviceStatus } from "../../../src/core/model/device";

export type SiteRow = Site & { userId: string };
export type DeviceRow = Device & { userId: string; agentId: string };
export interface UserRow { id: string; email: string; passwordHash: string; createdAt: number; }

export class ServerRepo {
  constructor(private db: Database.Database) {}
  createUser(email: string, passwordHash: string): string {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO users(id,email,passwordHash,createdAt) VALUES(?,?,?,?)`)
      .run(id, email, passwordHash, Date.now());
    return id;
  }
  findUserByEmail(email: string): UserRow | undefined {
    return this.db.prepare(`SELECT id,email,passwordHash,createdAt FROM users WHERE email=?`).get(email) as UserRow | undefined;
  }
  upsertSite(s: SiteRow): void {
    this.db.prepare(`INSERT INTO sites(id,userId,name) VALUES(@id,@userId,@name)
      ON CONFLICT(id) DO UPDATE SET name=@name`).run(s);
  }
  upsertDevice(d: DeviceRow): void {
    this.db.prepare(`INSERT INTO devices(id,userId,siteId,agentId,name,model,firmware,host,apiPort,controlPort)
      VALUES(@id,@userId,@siteId,@agentId,@name,@model,@firmware,@host,@apiPort,@controlPort)
      ON CONFLICT(id) DO UPDATE SET siteId=@siteId,agentId=@agentId,name=@name,model=@model,
        firmware=@firmware,host=@host,apiPort=@apiPort,controlPort=@controlPort`).run(d);
  }
  listSites(userId: string): Site[] {
    return this.db.prepare(`SELECT id,name FROM sites WHERE userId=?`).all(userId) as Site[];
  }
  listDevices(userId: string): Device[] {
    return this.db.prepare(`SELECT id,siteId,name,model,firmware,host,apiPort,controlPort FROM devices WHERE userId=?`).all(userId) as Device[];
  }
  deleteDevice(userId: string, id: string): void {
    this.db.prepare(`DELETE FROM devices WHERE userId=? AND id=?`).run(userId, id);
    this.db.prepare(`DELETE FROM device_status WHERE userId=? AND deviceId=?`).run(userId, id);
  }
  deviceAgent(userId: string, deviceId: string): string | null {
    const r = this.db.prepare(`SELECT agentId FROM devices WHERE userId=? AND id=?`).get(userId, deviceId) as { agentId: string } | undefined;
    return r?.agentId ?? null;
  }
  upsertStatus(userId: string, s: DeviceStatus): void {
    this.db.prepare(`INSERT INTO device_status(deviceId,userId,state,hashrateTHs,avgHashrateTHs,maxTempC,fanRpm,pool,worker,hwErrorRate,uptimeSec,lastSeen)
      VALUES(@deviceId,@userId,@state,@hashrateTHs,@avgHashrateTHs,@maxTempC,@fanRpm,@pool,@worker,@hwErrorRate,@uptimeSec,@lastSeen)
      ON CONFLICT(deviceId) DO UPDATE SET state=@state,hashrateTHs=@hashrateTHs,avgHashrateTHs=@avgHashrateTHs,
        maxTempC=@maxTempC,fanRpm=@fanRpm,pool=@pool,worker=@worker,hwErrorRate=@hwErrorRate,uptimeSec=@uptimeSec,lastSeen=@lastSeen`)
      .run({ ...s, userId });
  }
  listStatuses(userId: string): DeviceStatus[] {
    return this.db.prepare(`SELECT deviceId,state,hashrateTHs,avgHashrateTHs,maxTempC,fanRpm,pool,worker,hwErrorRate,uptimeSec,lastSeen FROM device_status WHERE userId=?`).all(userId) as DeviceStatus[];
  }
  touchAgent(id: string, userId: string, name: string): void {
    this.db.prepare(`INSERT INTO agents(id,userId,name,lastSeenAt) VALUES(?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,lastSeenAt=excluded.lastSeenAt`).run(id, userId, name, Date.now());
  }
}
```

- [ ] **Step 5: Run, expect PASS. Step 6: Commit** — `git commit -am "feat(server): sqlite schema + ServerRepo"`

---

## Task 6: AuthService (signup/login)

**Files:**
- Create: `server/src/auth/service.ts`, `tests/server/auth/service.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../../server/src/db/schema";
import { ServerRepo } from "../../../server/src/db/repo";
import { AuthService } from "../../../server/src/auth/service";

function svc() {
  const db = new Database(":memory:"); applySchema(db);
  return new AuthService(new ServerRepo(db), "test-secret");
}

describe("AuthService", () => {
  it("signs up then logs in, issuing a token; rejects dup email and bad creds", async () => {
    const s = svc();
    const t1 = await s.signup("a@b.com", "pw");
    expect(t1.ok).toBe(true);
    expect((await s.signup("a@b.com", "pw")).ok).toBe(false); // duplicate
    const login = await s.login("a@b.com", "pw");
    expect(login.ok).toBe(true);
    expect((await s.login("a@b.com", "nope")).ok).toBe(false);
    expect((await s.login("missing@b.com", "pw")).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`server/src/auth/service.ts`)

```ts
import type { ServerRepo } from "../db/repo";
import { hashPassword, verifyPassword } from "./password";
import { signToken } from "./jwt";

export type AuthResult = { ok: true; token: string; userId: string } | { ok: false; error: string };

export class AuthService {
  constructor(private repo: ServerRepo, private secret: string) {}
  async signup(email: string, password: string): Promise<AuthResult> {
    if (this.repo.findUserByEmail(email)) return { ok: false, error: "email already registered" };
    const userId = this.repo.createUser(email, await hashPassword(password));
    return { ok: true, token: signToken(userId, this.secret), userId };
  }
  async login(email: string, password: string): Promise<AuthResult> {
    const user = this.repo.findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      return { ok: false, error: "invalid credentials" };
    return { ok: true, token: signToken(user.id, this.secret), userId: user.id };
  }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(server): auth service signup/login"`

---

## Task 7: Command router (correlation)

**Files:**
- Create: `server/src/router/commandRouter.ts`, `tests/server/router/commandRouter.test.ts`

> Holds `agentId -> send(exec)` for connected agents. `routeCommand` forwards a `command.exec` to the owning agent and returns a promise that resolves when `resolveResult(commandId, outcome)` is called (or rejects on timeout / unknown agent).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { CommandRouter } from "../../../server/src/router/commandRouter";

describe("CommandRouter", () => {
  it("forwards to the owning agent and resolves on result", async () => {
    const router = new CommandRouter();
    const sent: unknown[] = [];
    router.attachAgent("ag1", (exec) => sent.push(exec));
    const p = router.routeCommand("ag1", { type: "command.exec", commandId: "c1", deviceId: "d1", command: "reboot" });
    expect(sent).toHaveLength(1);
    router.resolveResult("c1", { deviceId: "d1", ok: true });
    await expect(p).resolves.toMatchObject({ ok: true });
  });
  it("rejects when the agent is not connected", async () => {
    const router = new CommandRouter();
    await expect(
      router.routeCommand("ghost", { type: "command.exec", commandId: "c2", deviceId: "d", command: "reboot" }),
    ).rejects.toThrow(/agent not connected/);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`server/src/router/commandRouter.ts`)

```ts
import type { CommandExec } from "../protocol/messages";
import type { CommandOutcome } from "../../../src/core/model/result";

type Sender = (exec: CommandExec) => void;
interface Pending { resolve: (o: CommandOutcome) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; }

export class CommandRouter {
  private agents = new Map<string, Sender>();
  private pending = new Map<string, Pending>();

  attachAgent(agentId: string, send: Sender): void { this.agents.set(agentId, send); }
  detachAgent(agentId: string): void { this.agents.delete(agentId); }

  routeCommand(agentId: string, exec: CommandExec, timeoutMs = 15000): Promise<CommandOutcome> {
    const send = this.agents.get(agentId);
    if (!send) return Promise.reject(new Error("agent not connected"));
    return new Promise<CommandOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(exec.commandId);
        reject(new Error("command timed out"));
      }, timeoutMs);
      this.pending.set(exec.commandId, { resolve, reject, timer });
      send(exec);
    });
  }

  resolveResult(commandId: string, outcome: CommandOutcome): void {
    const p = this.pending.get(commandId);
    if (!p) return;
    clearTimeout(p.timer);
    this.pending.delete(commandId);
    p.resolve(outcome);
  }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(server): command router with result correlation"`

---

## Task 8: ConnectionHub (message application, transport-free)

**Files:**
- Create: `server/src/ws/hub.ts`, `tests/server/ws/hub.test.ts`

> The hub takes an authenticated `userId`, a `send` function (to that socket), the repo, the router, and a broadcaster. `handleMessage` applies each `ClientMessage`: agent.hello → touchAgent + attach to router; device.register → upsertDevice; status.update → upsertStatus + broadcast to viewers; command.result → router.resolveResult; snapshot.request → send snapshot; command.send → look up device agent, routeCommand, reply command.ack. This is fully unit-testable with fakes.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../../server/src/db/schema";
import { ServerRepo } from "../../../server/src/db/repo";
import { CommandRouter } from "../../../server/src/router/commandRouter";
import { ConnectionHub } from "../../../server/src/ws/hub";
import type { ServerMessage } from "../../../server/src/protocol/messages";

function setup() {
  const db = new Database(":memory:"); applySchema(db);
  const repo = new ServerRepo(db);
  const uid = repo.createUser("a@b.com", "h");
  const router = new CommandRouter();
  const broadcasts: ServerMessage[] = [];
  return { repo, router, uid, broadcasts,
    broadcast: (_u: string, m: ServerMessage) => broadcasts.push(m) };
}

describe("ConnectionHub", () => {
  it("registers an agent + device, then a viewer command routes to the agent", async () => {
    const { repo, router, uid, broadcast } = setup();
    const agentSent: ServerMessage[] = [];
    const agentHub = new ConnectionHub(uid, (m) => agentSent.push(m), repo, router, broadcast);
    agentHub.handleMessage({ type: "agent.hello", agentId: "ag1", name: "site1" });
    agentHub.handleMessage({ type: "device.register", device: {
      id: "d1", siteId: "s1", name: "S19", model: "S19", firmware: "stock", host: "192.168.1.50", apiPort: 4028, controlPort: 80 } });
    // agent.hello must also create the site implicitly? No — device.register carries siteId; ensure site row exists:
    repo.upsertSite({ id: "s1", userId: uid, name: "site1" });

    const viewerSent: ServerMessage[] = [];
    const viewerHub = new ConnectionHub(uid, (m) => viewerSent.push(m), repo, router, broadcast);
    const done = viewerHub.handleMessage({ type: "command.send", commandId: "c1", deviceId: "d1", command: "reboot" });

    // agent receives the exec
    expect(agentSent.find((m) => m.type === "command.exec")).toBeTruthy();
    // agent replies with result
    agentHub.handleMessage({ type: "command.result", commandId: "c1", outcome: { deviceId: "d1", ok: true } });
    await done;
    expect(viewerSent.find((m) => m.type === "command.ack")).toMatchObject({ type: "command.ack", outcome: { ok: true } });
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`server/src/ws/hub.ts`)

```ts
import type { ServerRepo } from "../db/repo";
import type { CommandRouter } from "../router/commandRouter";
import type { ClientMessage, ServerMessage } from "../protocol/messages";

type Send = (m: ServerMessage) => void;
type Broadcast = (userId: string, m: ServerMessage) => void;

export class ConnectionHub {
  private agentId: string | null = null;
  constructor(
    private userId: string,
    private send: Send,
    private repo: ServerRepo,
    private router: CommandRouter,
    private broadcast: Broadcast,
  ) {}

  async handleMessage(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case "agent.hello":
        this.agentId = msg.agentId;
        this.repo.touchAgent(msg.agentId, this.userId, msg.name);
        this.router.attachAgent(msg.agentId, (exec) => this.send(exec));
        break;
      case "device.register":
        this.repo.upsertDevice({ ...msg.device, userId: this.userId, agentId: this.agentId ?? "" });
        break;
      case "status.update":
        for (const s of msg.statuses) this.repo.upsertStatus(this.userId, s);
        this.broadcast(this.userId, { type: "status.update", statuses: msg.statuses });
        break;
      case "command.result":
        this.router.resolveResult(msg.commandId, msg.outcome);
        break;
      case "snapshot.request":
        this.send({ type: "snapshot", sites: this.repo.listSites(this.userId),
          devices: this.repo.listDevices(this.userId), statuses: this.repo.listStatuses(this.userId) });
        break;
      case "command.send": {
        const agentId = this.repo.deviceAgent(this.userId, msg.deviceId);
        if (!agentId) { this.send({ type: "command.ack", commandId: msg.commandId, outcome: { deviceId: msg.deviceId, ok: false, error: "unknown device" } }); break; }
        try {
          const outcome = await this.router.routeCommand(agentId, {
            type: "command.exec", commandId: msg.commandId, deviceId: msg.deviceId, command: msg.command, params: msg.params });
          this.send({ type: "command.ack", commandId: msg.commandId, outcome });
        } catch (e) {
          this.send({ type: "command.ack", commandId: msg.commandId, outcome: { deviceId: msg.deviceId, ok: false, error: (e as Error).message } });
        }
        break;
      }
    }
  }

  onClose(): void { if (this.agentId) this.router.detachAgent(this.agentId); }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(server): connection hub message handling"`

---

## Task 9: Self-signed TLS material

**Files:**
- Create: `server/src/tls.ts`

> On first run, generate a self-signed cert/key into `server/data/` (if absent) and return them. Uses `selfsigned`.

- [ ] **Step 1: Implement**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import selfsigned from "selfsigned";

export function loadOrCreateTls(dir: string): { key: string; cert: string } {
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
  }
  const pems = selfsigned.generate([{ name: "commonName", value: "mining-control-center" }], { days: 3650, keySize: 2048 });
  writeFileSync(keyPath, pems.private);
  writeFileSync(certPath, pems.cert);
  return { key: pems.private, cert: pems.cert };
}
```

- [ ] **Step 2: Commit** — `git commit -am "feat(server): self-signed tls material"`

---

## Task 10: Auth HTTP routes

**Files:**
- Create: `server/src/http/authRoutes.ts`

> A tiny request handler (no framework) for `POST /auth/signup` and `POST /auth/login`, reading a JSON body and returning `{token,userId}` or an error. Used by `index.ts`.

- [ ] **Step 1: Implement** `handleAuth(req, res, auth)` that: matches `req.url`/`req.method`, reads the body, calls `auth.signup`/`auth.login`, writes JSON with status 200 (ok) / 400 (error) / 404 (no match → returns false so index.ts can continue). Returns `Promise<boolean>` (handled or not).
- [ ] **Step 2: Commit** — `git commit -am "feat(server): auth http routes"`

---

## Task 11: Server bootstrap (https + ws wiring)

**Files:**
- Create: `server/src/index.ts`

> Compose everything: load TLS, open SQLite at `server/data/app.db`, build repo/auth/router, create an `https` server (auth routes), attach a `ws` `WebSocketServer` with `server` option. On each WS connection: read `token` from the query string, `verifyToken` → userId (close 4401 if invalid); maintain a per-user set of viewer sockets for broadcast; build a `ConnectionHub` per socket; parse incoming JSON, `isClientMessage` guard, `hub.handleMessage`; on close `hub.onClose()` and remove from the user set. Read `PORT`, `JWT_SECRET`, `DATA_DIR` from env with defaults. Log `server listening on :PORT`.

- [ ] **Step 1: Implement** the bootstrap per the description (composition only — all logic already lives in tested modules).
- [ ] **Step 2: Manual smoke (local):** Run `npm run server:start`; expect log `server listening`. With a tiny `wscat`/Node script: signup via `curl -k https://localhost:PORT/auth/signup`, connect WS with the token, send `snapshot.request`, receive a `snapshot` message.
- [ ] **Step 3: Commit** — `git commit -am "feat(server): https + ws bootstrap"`

---

## Task 12: Deploy runbook (VPS, self-signed)

**Files:**
- Create: `docs/server-deploy.md`

> Arabic runbook: provision a VPS, install Node, copy `server/`, set `JWT_SECRET` + `PORT`, open the firewall port, run under a process manager (`pm2` or a systemd unit), and note the self-signed cert fingerprint the app must pin. Include how to find the fingerprint: `openssl x509 -in server/data/cert.pem -noout -fingerprint -sha256`.

- [ ] **Step 1: Write the runbook. Step 2: Commit** — `git commit -am "docs: v2 server deploy runbook"`

---

## Self-Review (against the spec)

- **§5 data model (users/agents/sites/devices/status):** Task 5 schema+repo. ✓
- **§6 auth (signup/login, bcrypt, JWT):** Tasks 3,4,6,10. ✓
- **§7 protocol (all message types + routing):** Tasks 2,7,8. ✓
- **§4 tech (Node/TS/ws/sqlite/JWT, TLS self-signed):** Tasks 1,9,11. ✓
- **§10 security (bcrypt, JWT, per-user isolation, TLS):** repo scopes by userId; hub uses authed userId; Tasks 9,11. ✓
- **§3 command routing (viewer→server→agent→result):** Tasks 7,8. ✓
- **Deploy (VPS, self-signed):** Task 12. ✓

**Out of Phase 1 (own later plans):** agent mode in the app (Phase 2), viewer mode in the app (Phase 3), `setPool` driver command (Phase 4), packaging/role-selection UI (Phase 5). Tracked in the v2 spec §11.

**Type consistency:** `ServerRepo` methods, `CommandRouter.routeCommand/resolveResult/attachAgent/detachAgent`, `ConnectionHub.handleMessage/onClose`, and the `messages.ts` union are referenced identically across Tasks 5–11. Protocol reuses `Device`/`Site`/`DeviceStatus`/`ControlCommand`/`CommandOutcome` from v1 core. ✓

**Placeholder scan:** Testable core (Tasks 2–9) carries full code. Tasks 10–12 (HTTP glue, bootstrap composition, docs) specify exact files, signatures, env vars, and behavior precisely; their bodies are thin composition over already-fully-specified tested modules and are validated by the Task 11 manual smoke. No "TBD" remain.
