# Mining Control Center — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows desktop app that monitors and controls 15+ sites of Antminer ASIC devices (mixed firmware) directly over a Tailscale network, with per-site grouping, a compact table view, individual + bulk commands, and basic alerts.

**Architecture:** A single Electron app on the user's PC. The **main process** (Node/TypeScript) owns all networking (TCP 4028 polling + per-firmware control), a SQLite registry, the monitor engine, the bulk engine, and alerts. The **renderer** (React/TypeScript) is the dashboard UI, talking to the main process over typed IPC. Connectivity to remote ASICs is provided externally by Tailscale (a subnet router on each site's always-on laptop, using 4via6 to avoid overlapping-subnet collisions). The app treats each ASIC as a reachable host:port.

**Tech Stack:** Electron, TypeScript, React, Vite (renderer bundling), Vitest (tests), better-sqlite3 (local DB), Node `net`/`undici` (TCP + HTTP), Windows DPAPI via `safeStorage` (credential encryption), electron-builder (packaging).

**Spec:** `docs/superpowers/specs/2026-06-29-mining-control-center-design.md`

**Conventions:**
- Strict TypeScript (`"strict": true`). No `any` in committed code.
- Pure logic (parsers, drivers' request/response shaping, normalization, engines) lives in framework-free modules under `src/core/**` so it is unit-testable without Electron.
- Electron/IPC/DB/UI are thin shells over `src/core`.
- TDD for everything in `src/core`. Each task: failing test → run (fail) → minimal impl → run (pass) → commit.
- Commit after every passing step. Conventional commit messages.

---

## File Structure

```
mining-control-center/
├── package.json
├── tsconfig.json              # base TS config (strict)
├── tsconfig.main.json         # main-process build
├── vite.config.ts             # renderer build
├── vitest.config.ts           # test runner
├── electron-builder.yml       # packaging
├── src/
│   ├── core/                  # framework-free, fully unit-tested
│   │   ├── cgminer/
│   │   │   ├── protocol.ts        # 4028 request framing + raw response cleanup
│   │   │   ├── parse.ts           # parse summary/stats/pools/devs JSON
│   │   │   └── normalize.ts       # raw → unified DeviceStatus model
│   │   ├── drivers/
│   │   │   ├── types.ts           # DeviceDriver interface + Command types
│   │   │   ├── stock.ts           # Bitmain stock (web CGI control)
│   │   │   ├── braiins.ts         # Braiins OS+ control
│   │   │   ├── vnish.ts           # Vnish REST control
│   │   │   ├── luxos.ts           # LuxOS control
│   │   │   └── registry.ts        # firmware → driver lookup
│   │   ├── monitor/
│   │   │   ├── poller.ts          # one device poll (status) — pure, injectable transport
│   │   │   └── scheduler.ts       # concurrency-limited polling loop + offline detection
│   │   ├── bulk/
│   │   │   └── engine.ts          # run a command over many devices, per-device results
│   │   ├── alerts/
│   │   │   └── rules.ts           # offline / overheat / hashrate-drop evaluation
│   │   └── model/
│   │       ├── device.ts          # Device, Site, DeviceStatus, Firmware types
│   │       └── result.ts          # Result<T>, CommandOutcome types
│   ├── main/                  # Electron main process (thin shells over core)
│   │   ├── index.ts               # app bootstrap, window, lifecycle
│   │   ├── ipc.ts                 # typed IPC handlers
│   │   ├── transport/
│   │   │   ├── tcp.ts             # real TCP 4028 transport (implements core Transport)
│   │   │   └── http.ts            # real HTTP transport (digest + bearer)
│   │   ├── db/
│   │   │   ├── schema.ts          # SQLite schema + migrations
│   │   │   └── repo.ts            # device/site CRUD
│   │   ├── secrets.ts             # safeStorage (DPAPI) encrypt/decrypt of credentials
│   │   ├── service.ts             # wires scheduler+drivers+db+alerts together
│   │   └── notify.ts              # desktop notifications
│   ├── preload/
│   │   └── preload.ts             # contextBridge: expose typed api to renderer
│   └── renderer/              # React UI
│       ├── main.tsx
│       ├── App.tsx
│       ├── ipc.ts                 # renderer-side typed wrapper of window.api
│       ├── state/store.ts         # devices/sites/selection state
│       └── components/
│           ├── SummaryBar.tsx
│           ├── BulkActionBar.tsx
│           ├── SiteSection.tsx
│           ├── DeviceTable.tsx    # compact table (chosen layout)
│           ├── DeviceRow.tsx
│           ├── Toolbar.tsx        # search/filter
│           └── AddDeviceDialog.tsx
└── tests/                     # mirrors src/core
    └── core/...
```

---

## Milestone 0 — Project scaffold & tooling

### Task 0.1: Initialize repo, Electron+TS+React+Vite+Vitest

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.main.json`, `vite.config.ts`, `vitest.config.ts`, `.gitignore`

- [ ] **Step 1: Init git + npm**

```bash
cd "C:/Users/bader/OneDrive/سطح المكتب/Mining"
git init
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm i -D electron typescript vite @vitejs/plugin-react vitest @types/node electron-builder concurrently
npm i react react-dom better-sqlite3 undici
npm i -D @types/react @types/react-dom @types/better-sqlite3
```

- [ ] **Step 3: Write `tsconfig.json`** (strict base)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "types": ["node", "vitest/globals"],
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { globals: true, environment: "node", include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 5: Add a smoke test to prove the runner works**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from "vitest";
describe("smoke", () => {
  it("runs", () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 6: Add npm scripts** to `package.json`

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "build:main": "tsc -p tsconfig.main.json",
  "dev:renderer": "vite",
  "dist": "electron-builder"
}
```

- [ ] **Step 7: Run tests, expect PASS**

Run: `npm test` → Expected: 1 passed (smoke).

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold electron+ts+react+vitest"
```

---

## Milestone 1 — cgminer/bmminer 4028 client (monitoring core, TDD)

> All ASIC firmwares answer the cgminer API on TCP **4028**. We send a command, read until the socket closes, strip the trailing NUL, and parse JSON. This milestone is pure logic with an injected transport — no real sockets in tests.

### Task 1.1: Define the core model types

**Files:**
- Create: `src/core/model/device.ts`, `src/core/model/result.ts`

- [ ] **Step 1: Write the types** (`src/core/model/device.ts`)

```ts
export type Firmware = "stock" | "braiins" | "vnish" | "luxos";

export interface Device {
  id: string;
  siteId: string;
  name: string;
  model: string;          // e.g. "S19 Pro"
  firmware: Firmware;
  host: string;           // Tailscale-routed host/IP
  apiPort: number;        // default 4028
  controlPort: number;    // 80/443/4028 depending on firmware
}

export interface Site { id: string; name: string; }

export type DeviceState = "online" | "offline" | "warning";

export interface DeviceStatus {
  deviceId: string;
  state: DeviceState;
  hashrateTHs: number;     // current, TH/s
  avgHashrateTHs: number;  // average, TH/s
  maxTempC: number;        // hottest board/chip
  fanRpm: number;          // representative fan
  pool: string;
  worker: string;
  hwErrorRate: number;     // 0..1
  uptimeSec: number;
  lastSeen: number;        // epoch ms
}
```

- [ ] **Step 2: Write `Result`/outcome types** (`src/core/model/result.ts`)

```ts
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CommandOutcome {
  deviceId: string;
  ok: boolean;
  error?: string;
}
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(core): device + result model types"
```

### Task 1.2: 4028 protocol framing + raw cleanup

**Files:**
- Create: `src/core/cgminer/protocol.ts`, `tests/core/cgminer/protocol.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from "vitest";
import { buildRequest, cleanRawResponse } from "../../../src/core/cgminer/protocol";

describe("cgminer protocol", () => {
  it("builds a JSON command request", () => {
    expect(buildRequest("summary")).toBe('{"command":"summary"}');
    expect(buildRequest("stats", "0")).toBe('{"command":"stats","parameter":"0"}');
  });
  it("strips trailing NUL and whitespace before parsing", () => {
    expect(cleanRawResponse('{"a":1} ')).toBe('{"a":1}');
    expect(cleanRawResponse('{"a":1}\n')).toBe('{"a":1}');
  });
  it("repairs the known invalid-JSON quirk (comma before })", () => {
    expect(cleanRawResponse('{"a":1,} ')).toBe('{"a":1}');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run tests/core/cgminer/protocol.test.ts` (module not found).

- [ ] **Step 3: Implement** (`src/core/cgminer/protocol.ts`)

```ts
export function buildRequest(command: string, parameter?: string): string {
  return parameter === undefined
    ? JSON.stringify({ command })
    : JSON.stringify({ command, parameter });
}

export function cleanRawResponse(raw: string): string {
  return raw
    .replace(/ +$/g, "")   // trailing NUL bytes
    .trim()
    .replace(/,(\s*[}\]])/g, "$1"); // trailing commas some firmwares emit
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): cgminer 4028 framing + raw cleanup"`

### Task 1.3: Parse summary/stats/pools

**Files:**
- Create: `src/core/cgminer/parse.ts`, `tests/core/cgminer/parse.test.ts`

- [ ] **Step 1: Write failing tests** (use real-shaped fixtures)

```ts
import { describe, it, expect } from "vitest";
import { parseResponse } from "../../../src/core/cgminer/parse";

const summaryRaw =
  '{"STATUS":[{"STATUS":"S"}],"SUMMARY":[{"GHS 5s":95200,"GHS av":94800,' +
  '"Device Hardware%":0.0021,"Elapsed":432000}],"id":1} ';

describe("parseResponse", () => {
  it("parses a SUMMARY section into an object", () => {
    const r = parseResponse(summaryRaw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.SUMMARY?.[0]?.["GHS 5s"]).toBe(95200);
      expect(r.value.SUMMARY?.[0]?.["Elapsed"]).toBe(432000);
    }
  });
  it("returns ok:false on garbage", () => {
    expect(parseResponse("not json").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/cgminer/parse.ts`)

```ts
import { cleanRawResponse } from "./protocol";
import type { Result } from "../model/result";

export interface CgminerResponse {
  STATUS?: Array<Record<string, unknown>>;
  SUMMARY?: Array<Record<string, number | string>>;
  STATS?: Array<Record<string, number | string>>;
  POOLS?: Array<Record<string, number | string>>;
  DEVS?: Array<Record<string, number | string>>;
  id?: number;
}

export function parseResponse(raw: string): Result<CgminerResponse> {
  try {
    return { ok: true, value: JSON.parse(cleanRawResponse(raw)) as CgminerResponse };
  } catch (e) {
    return { ok: false, error: `parse failed: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(core): parse cgminer responses"`

### Task 1.4: Normalize raw → unified DeviceStatus

**Files:**
- Create: `src/core/cgminer/normalize.ts`, `tests/core/cgminer/normalize.test.ts`

- [ ] **Step 1: Failing tests** — cover GH→TH conversion, hottest-temp selection across `temp*` fields, fan pick, pool/worker, hw error rate, uptime.

```ts
import { describe, it, expect } from "vitest";
import { normalizeStatus } from "../../../src/core/cgminer/normalize";

const summary = { "GHS 5s": 95200, "GHS av": 94800, "Device Hardware%": 0.21, "Elapsed": 7200 };
const stats = { temp2_1: 64, temp2_2: 81, temp2_3: 70, fan1: 4200, fan2: 0 };
const pools = { URL: "stratum+tcp://pool:3333", "User": "acct.rig02", "Stratum Active": true };

describe("normalizeStatus", () => {
  it("converts GH/s to TH/s and picks hottest temp + active fan", () => {
    const s = normalizeStatus("dev1", { summary, stats, pools }, Date.now());
    expect(s.hashrateTHs).toBeCloseTo(95.2, 1);
    expect(s.avgHashrateTHs).toBeCloseTo(94.8, 1);
    expect(s.maxTempC).toBe(81);
    expect(s.fanRpm).toBe(4200);
    expect(s.worker).toBe("rig02");
    expect(s.pool).toBe("pool:3333");
    expect(s.hwErrorRate).toBeCloseTo(0.0021, 4);
    expect(s.uptimeSec).toBe(7200);
    expect(s.state).toBe("online");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/cgminer/normalize.ts`)

```ts
import type { DeviceStatus } from "../model/device";

interface RawBundle {
  summary: Record<string, number | string>;
  stats: Record<string, number | string>;
  pools: Record<string, number | string>;
}

const num = (v: unknown): number => (typeof v === "number" ? v : Number(v) || 0);

export function normalizeStatus(deviceId: string, raw: RawBundle, now: number): DeviceStatus {
  const ghs5 = num(raw.summary["GHS 5s"]);
  const ghsAv = num(raw.summary["GHS av"]);
  const temps = Object.entries(raw.stats)
    .filter(([k]) => /^temp/i.test(k))
    .map(([, v]) => num(v));
  const fans = Object.entries(raw.stats)
    .filter(([k]) => /^fan/i.test(k))
    .map(([, v]) => num(v))
    .filter((f) => f > 0);
  const user = String(raw.pools["User"] ?? "");
  const worker = user.includes(".") ? user.slice(user.indexOf(".") + 1) : user;
  const url = String(raw.pools["URL"] ?? "").replace(/^.*:\/\//, "");
  return {
    deviceId,
    state: ghs5 > 0 ? "online" : "offline",
    hashrateTHs: ghs5 / 1000,
    avgHashrateTHs: ghsAv / 1000,
    maxTempC: temps.length ? Math.max(...temps) : 0,
    fanRpm: fans.length ? fans[0]! : 0,
    pool: url,
    worker,
    hwErrorRate: num(raw.summary["Device Hardware%"]) / 100,
    uptimeSec: num(raw.summary["Elapsed"]),
    lastSeen: now,
  };
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(core): normalize cgminer status to unified model"`

---

## Milestone 2 — Firmware drivers (control core, TDD)

> Monitoring is uniform; **control differs per firmware**. We define a `DeviceDriver` interface and one implementation per firmware. Drivers are pure: they build requests and interpret responses through an injected `Transport`. Real network code lives in `src/main/transport`. Exact endpoints/fields may need per-model verification (see spec §9 risks) — tests pin the contract we build against.

### Task 2.1: Transport + DeviceDriver interfaces

**Files:**
- Create: `src/core/drivers/types.ts`, `tests/core/drivers/types.test.ts`

- [ ] **Step 1: Failing test** (a fake transport satisfies the interface and records calls)

```ts
import { describe, it, expect } from "vitest";
import type { Transport, DeviceDriver } from "../../../src/core/drivers/types";

describe("driver contracts", () => {
  it("Transport + DeviceDriver are usable shapes", async () => {
    const calls: string[] = [];
    const t: Transport = {
      async tcp4028(_host, _port, cmd) { calls.push(`tcp:${cmd}`); return '{"STATUS":[{"STATUS":"S"}]}'; },
      async http(req) { calls.push(`http:${req.method}:${req.path}`); return { status: 200, body: "ok" }; },
    };
    await t.tcp4028("h", 4028, '{"command":"summary"}');
    await t.http({ host: "h", port: 80, method: "POST", path: "/x" });
    expect(calls).toEqual(["tcp:{\"command\":\"summary\"}", "http:POST:/x"]);
    const _typecheck: Pick<DeviceDriver, "firmware"> = { firmware: "stock" };
    expect(_typecheck.firmware).toBe("stock");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/drivers/types.ts`)

```ts
import type { Firmware, Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

export interface HttpRequest {
  host: string; port: number;
  method: "GET" | "POST";
  path: string;
  headers?: Record<string, string>;
  body?: string;
  auth?: { kind: "digest" | "bearer" | "basic"; user?: string; pass?: string; token?: string };
}
export interface HttpResponse { status: number; body: string; headers?: Record<string, string>; }

export interface Transport {
  tcp4028(host: string, port: number, command: string): Promise<string>;
  http(req: HttpRequest): Promise<HttpResponse>;
}

export type ControlCommand = "restartMining" | "stopMining" | "startMining" | "reboot";

export interface DeviceDriver {
  firmware: Firmware;
  execute(device: Device, command: ControlCommand, t: Transport, secret?: string): Promise<CommandOutcome>;
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(core): transport + driver interfaces"`

### Task 2.2: LuxOS driver (4028 privileged commands)

**Files:**
- Create: `src/core/drivers/luxos.ts`, `tests/core/drivers/luxos.test.ts`

> LuxOS extends the 4028 API: obtain a session via `logon`, then send `curtail`/`reboot`. `curtail sleep` stops mining; `curtail wakeup` resumes.

- [ ] **Step 1: Failing test** (fake transport asserts the exact command sequence)

```ts
import { describe, it, expect } from "vitest";
import { LuxOsDriver } from "../../../src/core/drivers/luxos";
import type { Transport } from "../../../src/core/drivers/types";
import type { Device } from "../../../src/core/model/device";

const dev: Device = { id:"d", siteId:"s", name:"n", model:"S19", firmware:"luxos", host:"h", apiPort:4028, controlPort:4028 };

function fakeTcp(seq: string[]): Transport {
  return {
    async tcp4028(_h,_p,cmd){ seq.push(cmd);
      if (cmd.includes('"logon"')) return '{"SESSION":[{"SessionID":"abc"}]}';
      return '{"STATUS":[{"STATUS":"S","Msg":"ok"}]}'; },
    async http(){ throw new Error("not used"); },
  };
}

describe("LuxOsDriver", () => {
  it("stopMining logs on then curtails to sleep", async () => {
    const seq: string[] = [];
    const r = await new LuxOsDriver().execute(dev, "stopMining", fakeTcp(seq));
    expect(r.ok).toBe(true);
    expect(seq[0]).toContain('"logon"');
    expect(seq[1]).toContain('"curtail"');
    expect(seq[1]).toContain('sleep');
  });
  it("reboot sends reboot with session", async () => {
    const seq: string[] = [];
    const r = await new LuxOsDriver().execute(dev, "reboot", fakeTcp(seq));
    expect(r.ok).toBe(true);
    expect(seq[1]).toContain('"reboot"');
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/drivers/luxos.ts`)

```ts
import type { DeviceDriver, Transport, ControlCommand } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";
import { parseResponse } from "../cgminer/parse";

export class LuxOsDriver implements DeviceDriver {
  firmware = "luxos" as const;

  async execute(device: Device, command: ControlCommand, t: Transport): Promise<CommandOutcome> {
    try {
      const logon = await t.tcp4028(device.host, device.apiPort, JSON.stringify({ command: "logon" }));
      const parsed = parseResponse(logon);
      const session =
        parsed.ok && Array.isArray((parsed.value as any).SESSION)
          ? String((parsed.value as any).SESSION[0]?.SessionID ?? "")
          : "";
      const send = (cmd: object) => t.tcp4028(device.host, device.apiPort, JSON.stringify(cmd));
      switch (command) {
        case "stopMining":   await send({ command: "curtail", parameter: `${session},sleep` }); break;
        case "startMining":  await send({ command: "curtail", parameter: `${session},wakeup` }); break;
        case "restartMining":await send({ command: "curtail", parameter: `${session},wakeup` }); break;
        case "reboot":       await send({ command: "reboot",  parameter: session }); break;
      }
      return { deviceId: device.id, ok: true };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(driver): LuxOS control via 4028 session"`

### Task 2.3: Vnish driver (REST + token)

**Files:**
- Create: `src/core/drivers/vnish.ts`, `tests/core/drivers/vnish.test.ts`

> Vnish: `POST /api/v1/unlock` (password) → token; then `POST /api/v1/mining/restart`, `/api/v1/mining/pause`, `/api/v1/mining/resume`, `/api/v1/system/reboot` with `Authorization: Bearer`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { VnishDriver } from "../../../src/core/drivers/vnish";
import type { Transport, HttpRequest } from "../../../src/core/drivers/types";
import type { Device } from "../../../src/core/model/device";

const dev: Device = { id:"d", siteId:"s", name:"n", model:"S19", firmware:"vnish", host:"h", apiPort:4028, controlPort:80 };

function fakeHttp(reqs: HttpRequest[]): Transport {
  return {
    async tcp4028(){ throw new Error("not used"); },
    async http(req){ reqs.push(req);
      if (req.path.includes("unlock")) return { status:200, body: JSON.stringify({ token:"T" }) };
      return { status:200, body: "{}" }; },
  };
}

describe("VnishDriver", () => {
  it("unlocks then restarts mining with bearer token", async () => {
    const reqs: HttpRequest[] = [];
    const r = await new VnishDriver().execute(dev, "restartMining", fakeHttp(reqs), "pw");
    expect(r.ok).toBe(true);
    expect(reqs[0]?.path).toContain("unlock");
    expect(reqs[1]?.path).toContain("/mining/restart");
    expect(reqs[1]?.auth?.token).toBe("T");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/drivers/vnish.ts`)

```ts
import type { DeviceDriver, Transport, ControlCommand } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

const PATHS: Record<ControlCommand, string> = {
  restartMining: "/api/v1/mining/restart",
  stopMining:    "/api/v1/mining/pause",
  startMining:   "/api/v1/mining/resume",
  reboot:        "/api/v1/system/reboot",
};

export class VnishDriver implements DeviceDriver {
  firmware = "vnish" as const;

  async execute(device: Device, command: ControlCommand, t: Transport, secret?: string): Promise<CommandOutcome> {
    try {
      const unlock = await t.http({
        host: device.host, port: device.controlPort, method: "POST",
        path: "/api/v1/unlock", body: JSON.stringify({ pw: secret ?? "" }),
        headers: { "content-type": "application/json" },
      });
      const token = String(JSON.parse(unlock.body || "{}").token ?? "");
      const res = await t.http({
        host: device.host, port: device.controlPort, method: "POST",
        path: PATHS[command], auth: { kind: "bearer", token },
      });
      return res.status >= 200 && res.status < 300
        ? { deviceId: device.id, ok: true }
        : { deviceId: device.id, ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(driver): Vnish REST control"`

### Task 2.4: Braiins OS+ driver (4028 bosminer commands)

**Files:**
- Create: `src/core/drivers/braiins.ts`, `tests/core/drivers/braiins.test.ts`

> Braiins OS+ answers cgminer-style 4028 with `pause`/`resume` (bosminer) and supports `restart`; reboot via `{"command":"reboot"}` where enabled, else flagged unsupported.

- [ ] **Step 1: Failing test** — assert `stopMining`→`pause`, `startMining`→`resume`, `restartMining`→`restart`.

```ts
import { describe, it, expect } from "vitest";
import { BraiinsDriver } from "../../../src/core/drivers/braiins";
import type { Transport } from "../../../src/core/drivers/types";
import type { Device } from "../../../src/core/model/device";

const dev: Device = { id:"d", siteId:"s", name:"n", model:"S19", firmware:"braiins", host:"h", apiPort:4028, controlPort:4028 };
const tcp = (seq:string[]):Transport => ({
  async tcp4028(_h,_p,cmd){ seq.push(cmd); return '{"STATUS":[{"STATUS":"S"}]}'; },
  async http(){ throw new Error("no"); },
});

describe("BraiinsDriver", () => {
  it("maps commands to bosminer verbs", async () => {
    for (const [cmd, verb] of [["stopMining","pause"],["startMining","resume"],["restartMining","restart"]] as const) {
      const seq:string[] = [];
      const r = await new BraiinsDriver().execute(dev, cmd, tcp(seq));
      expect(r.ok).toBe(true);
      expect(seq[0]).toContain(`"${verb}"`);
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/drivers/braiins.ts`)

```ts
import type { DeviceDriver, Transport, ControlCommand } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

const VERB: Record<ControlCommand, string> = {
  stopMining: "pause", startMining: "resume", restartMining: "restart", reboot: "reboot",
};

export class BraiinsDriver implements DeviceDriver {
  firmware = "braiins" as const;
  async execute(device: Device, command: ControlCommand, t: Transport): Promise<CommandOutcome> {
    try {
      await t.tcp4028(device.host, device.apiPort, JSON.stringify({ command: VERB[command] }));
      return { deviceId: device.id, ok: true };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(driver): Braiins OS+ control"`

### Task 2.5: Stock Bitmain driver (web CGI + digest)

**Files:**
- Create: `src/core/drivers/stock.ts`, `tests/core/drivers/stock.test.ts`

> Stock recent firmware restricts the 4028 API to read-only; control is via web CGI with **digest auth**: `GET /cgi-bin/reboot.cgi` (reboot) and `GET /cgi-bin/...restart` for cgminer restart. `startMining`/`stopMining` on stock fall back to a cgminer restart (stock has no pause); we surface that honestly.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { StockDriver } from "../../../src/core/drivers/stock";
import type { Transport, HttpRequest } from "../../../src/core/drivers/types";
import type { Device } from "../../../src/core/model/device";

const dev: Device = { id:"d", siteId:"s", name:"n", model:"S19", firmware:"stock", host:"h", apiPort:4028, controlPort:80 };
const http = (reqs:HttpRequest[]):Transport => ({
  async tcp4028(){ throw new Error("read-only"); },
  async http(req){ reqs.push(req); return { status:200, body:"ok" }; },
});

describe("StockDriver", () => {
  it("reboot calls reboot.cgi with digest auth", async () => {
    const reqs:HttpRequest[] = [];
    const r = await new StockDriver().execute(dev, "reboot", http(reqs), "root:root");
    expect(r.ok).toBe(true);
    expect(reqs[0]?.path).toContain("reboot.cgi");
    expect(reqs[0]?.auth?.kind).toBe("digest");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/drivers/stock.ts`)

```ts
import type { DeviceDriver, Transport, ControlCommand } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

const PATH: Record<ControlCommand, string> = {
  reboot: "/cgi-bin/reboot.cgi",
  restartMining: "/cgi-bin/miner_restart.cgi",
  stopMining: "/cgi-bin/miner_restart.cgi",   // stock has no pause; honest restart fallback
  startMining: "/cgi-bin/miner_restart.cgi",
};

export class StockDriver implements DeviceDriver {
  firmware = "stock" as const;
  async execute(device: Device, command: ControlCommand, t: Transport, secret?: string): Promise<CommandOutcome> {
    const [user, pass] = (secret ?? "root:root").split(":");
    try {
      const res = await t.http({
        host: device.host, port: device.controlPort, method: "GET",
        path: PATH[command], auth: { kind: "digest", user, pass },
      });
      return res.status >= 200 && res.status < 300
        ? { deviceId: device.id, ok: true }
        : { deviceId: device.id, ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(driver): Stock Bitmain CGI control"`

### Task 2.6: Driver registry

**Files:**
- Create: `src/core/drivers/registry.ts`, `tests/core/drivers/registry.test.ts`

- [ ] **Step 1: Failing test** — `getDriver("vnish")` returns a `VnishDriver`, every `Firmware` resolves.

```ts
import { describe, it, expect } from "vitest";
import { getDriver } from "../../../src/core/drivers/registry";
import type { Firmware } from "../../../src/core/model/device";

describe("driver registry", () => {
  it("resolves every firmware", () => {
    for (const f of ["stock","braiins","vnish","luxos"] as Firmware[]) {
      expect(getDriver(f).firmware).toBe(f);
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/drivers/registry.ts`)

```ts
import type { Firmware } from "../model/device";
import type { DeviceDriver } from "./types";
import { StockDriver } from "./stock";
import { BraiinsDriver } from "./braiins";
import { VnishDriver } from "./vnish";
import { LuxOsDriver } from "./luxos";

const drivers: Record<Firmware, DeviceDriver> = {
  stock: new StockDriver(),
  braiins: new BraiinsDriver(),
  vnish: new VnishDriver(),
  luxos: new LuxOsDriver(),
};
export function getDriver(f: Firmware): DeviceDriver { return drivers[f]; }
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(core): firmware driver registry"`

---

## Milestone 3 — Monitor engine (TDD)

### Task 3.1: Single-device poller

**Files:**
- Create: `src/core/monitor/poller.ts`, `tests/core/monitor/poller.test.ts`

> `pollDevice` issues `summary`, `stats`, `pools` over the transport, normalizes, and returns a `DeviceStatus`. On transport failure it returns an `offline` status with `lastSeen` unchanged-from-input handling left to the scheduler.

- [ ] **Step 1: Failing test** (fake transport returns canned 4028 payloads; assert online status; assert offline on throw)

```ts
import { describe, it, expect } from "vitest";
import { pollDevice } from "../../../src/core/monitor/poller";
import type { Transport } from "../../../src/core/drivers/types";
import type { Device } from "../../../src/core/model/device";

const dev: Device = { id:"d", siteId:"s", name:"n", model:"S19", firmware:"stock", host:"h", apiPort:4028, controlPort:80 };

const ok: Transport = {
  async tcp4028(_h,_p,cmd){
    if (cmd.includes("summary")) return '{"SUMMARY":[{"GHS 5s":95000,"GHS av":94000,"Device Hardware%":0.1,"Elapsed":3600}]}';
    if (cmd.includes("stats"))   return '{"STATS":[{"temp2_1":60,"temp2_2":75,"fan1":4000}]}';
    return '{"POOLS":[{"URL":"stratum+tcp://p:3333","User":"a.w1","Stratum Active":true}]}';
  },
  async http(){ throw new Error("no"); },
};
const dead: Transport = { async tcp4028(){ throw new Error("timeout"); }, async http(){ throw new Error("no"); } };

describe("pollDevice", () => {
  it("returns online normalized status", async () => {
    const s = await pollDevice(dev, ok, 1000);
    expect(s.state).toBe("online");
    expect(s.hashrateTHs).toBeCloseTo(95, 0);
    expect(s.maxTempC).toBe(75);
  });
  it("returns offline on transport failure", async () => {
    const s = await pollDevice(dev, dead, 1000);
    expect(s.state).toBe("offline");
    expect(s.hashrateTHs).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/monitor/poller.ts`)

```ts
import type { Device, DeviceStatus } from "../model/device";
import type { Transport } from "../drivers/types";
import { buildRequest } from "../cgminer/protocol";
import { parseResponse } from "../cgminer/parse";
import { normalizeStatus } from "../cgminer/normalize";

function firstSection(raw: string, key: "SUMMARY" | "STATS" | "POOLS"): Record<string, number | string> {
  const p = parseResponse(raw);
  if (!p.ok) return {};
  const arr = (p.value as Record<string, unknown>)[key];
  return Array.isArray(arr) && arr[0] ? (arr[0] as Record<string, number | string>) : {};
}

export async function pollDevice(device: Device, t: Transport, now: number): Promise<DeviceStatus> {
  try {
    const [sumRaw, statRaw, poolRaw] = await Promise.all([
      t.tcp4028(device.host, device.apiPort, buildRequest("summary")),
      t.tcp4028(device.host, device.apiPort, buildRequest("stats")),
      t.tcp4028(device.host, device.apiPort, buildRequest("pools")),
    ]);
    return normalizeStatus(device.id, {
      summary: firstSection(sumRaw, "SUMMARY"),
      stats: firstSection(statRaw, "STATS"),
      pools: firstSection(poolRaw, "POOLS"),
    }, now);
  } catch {
    return {
      deviceId: device.id, state: "offline", hashrateTHs: 0, avgHashrateTHs: 0,
      maxTempC: 0, fanRpm: 0, pool: "", worker: "", hwErrorRate: 0, uptimeSec: 0, lastSeen: now,
    };
  }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(core): single-device poller"`

### Task 3.2: Concurrency-limited scheduler + warning state

**Files:**
- Create: `src/core/monitor/scheduler.ts`, `tests/core/monitor/scheduler.test.ts`

> `pollAll` polls a device list with a max concurrency, applies a warning overlay (online but `maxTempC >= warnTempC`), and returns all statuses. The periodic loop is started/stopped by the main process; the pure function `pollAll` is what we test.

- [ ] **Step 1: Failing test** — assert concurrency never exceeds the cap and warning overlay applies.

```ts
import { describe, it, expect } from "vitest";
import { pollAll } from "../../../src/core/monitor/scheduler";
import type { Device } from "../../../src/core/model/device";

const mk = (id:string):Device => ({ id, siteId:"s", name:id, model:"S19", firmware:"stock", host:"h", apiPort:4028, controlPort:80 });

describe("pollAll", () => {
  it("respects concurrency cap and applies warning overlay", async () => {
    let active = 0, peak = 0;
    const devices = [mk("a"), mk("b"), mk("c"), mk("d")];
    const statuses = await pollAll(devices, { maxConcurrency: 2, warnTempC: 80, now: 1 }, async (d) => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { deviceId: d.id, state: "online", hashrateTHs: 90, avgHashrateTHs: 90,
        maxTempC: d.id === "c" ? 85 : 60, fanRpm: 4000, pool: "p", worker: "w", hwErrorRate: 0, uptimeSec: 1, lastSeen: 1 };
    });
    expect(peak).toBeLessThanOrEqual(2);
    expect(statuses.find((s) => s.deviceId === "c")?.state).toBe("warning");
    expect(statuses.find((s) => s.deviceId === "a")?.state).toBe("online");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/monitor/scheduler.ts`)

```ts
import type { Device, DeviceStatus } from "../model/device";

export interface PollOptions { maxConcurrency: number; warnTempC: number; now: number; }
export type PollFn = (device: Device) => Promise<DeviceStatus>;

export async function pollAll(devices: Device[], opts: PollOptions, poll: PollFn): Promise<DeviceStatus[]> {
  const results: DeviceStatus[] = [];
  let i = 0;
  async function worker() {
    while (i < devices.length) {
      const device = devices[i++]!;
      const s = await poll(device);
      results.push(s.state === "online" && s.maxTempC >= opts.warnTempC ? { ...s, state: "warning" } : s);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.maxConcurrency, devices.length) }, worker));
  return results;
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(core): concurrency-limited poll scheduler"`

---

## Milestone 4 — Bulk command engine (TDD)

### Task 4.1: Run a control command across many devices

**Files:**
- Create: `src/core/bulk/engine.ts`, `tests/core/bulk/engine.test.ts`

- [ ] **Step 1: Failing test** — per-device outcomes, one failure does not abort the rest, concurrency cap respected.

```ts
import { describe, it, expect } from "vitest";
import { runBulk } from "../../../src/core/bulk/engine";
import type { Device } from "../../../src/core/model/device";

const mk = (id:string):Device => ({ id, siteId:"s", name:id, model:"S19", firmware:"braiins", host:"h", apiPort:4028, controlPort:4028 });

describe("runBulk", () => {
  it("returns one outcome per device and isolates failures", async () => {
    const devices = [mk("a"), mk("b"), mk("c")];
    const outcomes = await runBulk(devices, "reboot", { maxConcurrency: 2 }, async (d) => {
      if (d.id === "b") return { deviceId: d.id, ok: false, error: "boom" };
      return { deviceId: d.id, ok: true };
    });
    expect(outcomes).toHaveLength(3);
    expect(outcomes.find((o) => o.deviceId === "b")?.ok).toBe(false);
    expect(outcomes.filter((o) => o.ok)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/bulk/engine.ts`)

```ts
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";
import type { ControlCommand } from "../drivers/types";

export interface BulkOptions { maxConcurrency: number; }
export type ExecFn = (device: Device) => Promise<CommandOutcome>;

export async function runBulk(devices: Device[], _command: ControlCommand, opts: BulkOptions, exec: ExecFn): Promise<CommandOutcome[]> {
  const outcomes: CommandOutcome[] = [];
  let i = 0;
  async function worker() {
    while (i < devices.length) {
      const device = devices[i++]!;
      try { outcomes.push(await exec(device)); }
      catch (e) { outcomes.push({ deviceId: device.id, ok: false, error: (e as Error).message }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.maxConcurrency, devices.length) }, worker));
  return outcomes;
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(core): bulk command engine"`

---

## Milestone 5 — Alert rules (TDD)

### Task 5.1: Evaluate alert transitions

**Files:**
- Create: `src/core/alerts/rules.ts`, `tests/core/alerts/rules.test.ts`

> Compares previous vs current status to emit alerts only on *transitions* (avoid spam): went-offline, became-overheating, hashrate-dropped below a fraction of average.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { evaluateAlerts } from "../../../src/core/alerts/rules";
import type { DeviceStatus } from "../../../src/core/model/device";

const base: DeviceStatus = { deviceId:"d", state:"online", hashrateTHs:95, avgHashrateTHs:95, maxTempC:60, fanRpm:4000, pool:"p", worker:"w", hwErrorRate:0, uptimeSec:1, lastSeen:1 };

describe("evaluateAlerts", () => {
  it("fires on going offline", () => {
    const a = evaluateAlerts(base, { ...base, state:"offline", hashrateTHs:0 }, { overheatC:80, hashDropFrac:0.7 });
    expect(a.map(x=>x.kind)).toContain("offline");
  });
  it("fires overheat once on transition", () => {
    const prev = { ...base, maxTempC:70 };
    const now = { ...base, maxTempC:85 };
    expect(evaluateAlerts(prev, now, { overheatC:80, hashDropFrac:0.7 }).map(x=>x.kind)).toContain("overheat");
    expect(evaluateAlerts(now, now, { overheatC:80, hashDropFrac:0.7 })).toHaveLength(0);
  });
  it("fires hashrate drop below fraction of average", () => {
    const now = { ...base, hashrateTHs: 50, avgHashrateTHs: 95 };
    expect(evaluateAlerts(base, now, { overheatC:80, hashDropFrac:0.7 }).map(x=>x.kind)).toContain("hashdrop");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`src/core/alerts/rules.ts`)

```ts
import type { DeviceStatus } from "../model/device";

export type AlertKind = "offline" | "overheat" | "hashdrop";
export interface Alert { deviceId: string; kind: AlertKind; message: string; }
export interface AlertThresholds { overheatC: number; hashDropFrac: number; }

export function evaluateAlerts(prev: DeviceStatus, now: DeviceStatus, th: AlertThresholds): Alert[] {
  const out: Alert[] = [];
  if (prev.state !== "offline" && now.state === "offline")
    out.push({ deviceId: now.deviceId, kind: "offline", message: `${now.deviceId} غير متصل` });
  if (prev.maxTempC < th.overheatC && now.maxTempC >= th.overheatC)
    out.push({ deviceId: now.deviceId, kind: "overheat", message: `${now.deviceId} حرارة ${now.maxTempC}°C` });
  const dropped = now.state !== "offline" && now.avgHashrateTHs > 0 &&
    now.hashrateTHs < now.avgHashrateTHs * th.hashDropFrac;
  const wasOk = prev.avgHashrateTHs === 0 || prev.hashrateTHs >= prev.avgHashrateTHs * th.hashDropFrac;
  if (dropped && wasOk)
    out.push({ deviceId: now.deviceId, kind: "hashdrop", message: `${now.deviceId} هبوط هاش` });
  return out;
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(core): alert rules"`

---

## Milestone 6 — Persistence & real transports (main process)

### Task 6.1: SQLite schema + repo

**Files:**
- Create: `src/main/db/schema.ts`, `src/main/db/repo.ts`, `tests/core/db/repo.test.ts` (run against an in-memory better-sqlite3 DB)

- [ ] **Step 1: Failing test** — insert a site + device, read them back; round-trip equals input.

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../../src/main/db/schema";
import { DeviceRepo } from "../../../src/main/db/repo";

describe("DeviceRepo", () => {
  it("round-trips sites and devices", () => {
    const db = new Database(":memory:");
    applySchema(db);
    const repo = new DeviceRepo(db);
    repo.upsertSite({ id: "s1", name: "الرياض" });
    repo.upsertDevice({ id:"d1", siteId:"s1", name:"S19-01", model:"S19", firmware:"stock", host:"100.64.0.5", apiPort:4028, controlPort:80 });
    expect(repo.listSites()).toHaveLength(1);
    expect(repo.listDevices()[0]?.name).toBe("S19-01");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** `schema.ts` (tables `sites`, `devices`) and `repo.ts` (`upsertSite`, `upsertDevice`, `listSites`, `listDevices`, `deleteDevice`). Use prepared statements.

```ts
// schema.ts
import type Database from "better-sqlite3";
export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, siteId TEXT NOT NULL, name TEXT NOT NULL, model TEXT NOT NULL,
      firmware TEXT NOT NULL, host TEXT NOT NULL, apiPort INTEGER NOT NULL, controlPort INTEGER NOT NULL,
      secretEnc BLOB
    );`);
}
```

```ts
// repo.ts
import type Database from "better-sqlite3";
import type { Device, Site } from "../../core/model/device";
export class DeviceRepo {
  constructor(private db: Database.Database) {}
  upsertSite(s: Site){ this.db.prepare(`INSERT INTO sites(id,name) VALUES(@id,@name)
    ON CONFLICT(id) DO UPDATE SET name=@name`).run(s); }
  upsertDevice(d: Device){ this.db.prepare(`INSERT INTO devices(id,siteId,name,model,firmware,host,apiPort,controlPort)
    VALUES(@id,@siteId,@name,@model,@firmware,@host,@apiPort,@controlPort)
    ON CONFLICT(id) DO UPDATE SET siteId=@siteId,name=@name,model=@model,firmware=@firmware,host=@host,apiPort=@apiPort,controlPort=@controlPort`).run(d); }
  listSites(): Site[] { return this.db.prepare(`SELECT id,name FROM sites`).all() as Site[]; }
  listDevices(): Device[] { return this.db.prepare(`SELECT id,siteId,name,model,firmware,host,apiPort,controlPort FROM devices`).all() as Device[]; }
  deleteDevice(id: string){ this.db.prepare(`DELETE FROM devices WHERE id=?`).run(id); }
}
```

- [ ] **Step 4: Run, expect PASS. Step 5: Commit** — `git commit -am "feat(main): sqlite schema + device repo"`

### Task 6.2: Credential encryption via Windows DPAPI (safeStorage)

**Files:**
- Create: `src/main/secrets.ts`

> `safeStorage` is only available in the Electron main process at runtime; we keep this module a thin wrapper and verify it manually in Milestone 8 (not unit-tested, as it needs the Electron runtime). Interface kept tiny.

- [ ] **Step 1: Implement**

```ts
import { safeStorage } from "electron";
export function encryptSecret(plain: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encryption unavailable");
  return safeStorage.encryptString(plain);
}
export function decryptSecret(enc: Buffer): string {
  return safeStorage.decryptString(enc);
}
```

- [ ] **Step 2: Commit** — `git commit -am "feat(main): DPAPI credential encryption"`

### Task 6.3: Real TCP 4028 transport

**Files:**
- Create: `src/main/transport/tcp.ts`

> Implements `Transport.tcp4028` using Node `net`: connect, write command, read until close, with a timeout. (Manually verified against a real miner in Milestone 8.)

- [ ] **Step 1: Implement**

```ts
import { createConnection } from "node:net";
export function tcp4028(host: string, port: number, command: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host, port });
    let data = "";
    const fail = (e: Error) => { sock.destroy(); reject(e); };
    sock.setTimeout(timeoutMs, () => fail(new Error("timeout")));
    sock.on("connect", () => sock.write(command));
    sock.on("data", (c) => (data += c.toString("utf8")));
    sock.on("end", () => resolve(data));
    sock.on("error", fail);
  });
}
```

- [ ] **Step 2: Commit** — `git commit -am "feat(main): real TCP 4028 transport"`

### Task 6.4: Real HTTP transport (bearer/basic now, digest helper)

**Files:**
- Create: `src/main/transport/http.ts`

> Uses `undici`. Bearer/basic immediately; digest auth implemented via a two-request challenge/response helper. (Digest verified manually against stock firmware in Milestone 8.)

- [ ] **Step 1: Implement** `httpRequest(req: HttpRequest): Promise<HttpResponse>` handling `auth.kind` of `bearer` (Authorization: Bearer), `basic` (base64), and `digest` (parse `WWW-Authenticate` from a first 401, compute MD5 response, retry). Return `{ status, body }`.

- [ ] **Step 2: Commit** — `git commit -am "feat(main): real HTTP transport with digest"`

---

## Milestone 7 — Wiring: service + IPC + preload

### Task 7.1: Service layer

**Files:**
- Create: `src/main/service.ts`

> Composes repo + transports + drivers + scheduler + alerts. Exposes: `getSnapshot()` (devices+sites+latest statuses), `startMonitoring()`, `stopMonitoring()`, `sendCommand(deviceId, cmd)`, `sendBulk(deviceIds, cmd)`. Builds a `Transport` from `tcp4028`+`httpRequest`. Stores latest statuses in memory; runs `pollAll` on an interval; on each cycle diffs against previous and calls `notify` for alerts.

- [ ] **Step 1: Implement** the `MiningService` class with the methods above. Use `getDriver(device.firmware)` for control, decrypt secret via `decryptSecret` when present.
- [ ] **Step 2: Commit** — `git commit -am "feat(main): mining service wiring"`

### Task 7.2: Typed IPC + preload bridge

**Files:**
- Create: `src/main/ipc.ts`, `src/preload/preload.ts`, `src/renderer/ipc.ts`

> Define IPC channels: `snapshot:get`, `monitor:start`, `monitor:stop`, `device:command`, `device:bulk`, `device:add`, `device:delete`, `site:add`, plus a push channel `statuses:update`. `preload.ts` exposes a typed `window.api` via `contextBridge`. `renderer/ipc.ts` mirrors the types.

- [ ] **Step 1: Implement** handlers in `ipc.ts` delegating to `MiningService`; `preload.ts` `contextBridge.exposeInMainWorld("api", {...})`.
- [ ] **Step 2: Commit** — `git commit -am "feat: typed IPC + preload bridge"`

### Task 7.3: Electron bootstrap

**Files:**
- Create: `src/main/index.ts`, `src/main/notify.ts`

> `index.ts`: create `BrowserWindow` with `preload`, load the Vite renderer (dev URL or built file), open DB at `app.getPath("userData")`, instantiate `MiningService`, register IPC. `notify.ts`: `new Notification({title, body}).show()`.

- [ ] **Step 1: Implement** bootstrap + window lifecycle (quit on all-closed for Windows).
- [ ] **Step 2: Commit** — `git commit -am "feat(main): electron bootstrap + notifications"`

---

## Milestone 8 — Renderer UI (compact table, per-site grouping)

### Task 8.1: State store + IPC load

**Files:**
- Create: `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/state/store.ts`

> Minimal store (React `useReducer` or Zustand if added): holds `sites`, `devices`, `statusById`, `selectedIds`, `filter`. On mount: `window.api.snapshot.get()` then `window.api.monitor.start()`; subscribe to `statuses:update` to merge.

- [ ] **Step 1: Implement** store + `App` that loads snapshot and renders `SummaryBar`, `Toolbar`, `BulkActionBar`, and one `SiteSection` per site.
- [ ] **Step 2: Commit** — `git commit -am "feat(ui): app shell + state store"`

### Task 8.2: SummaryBar + Toolbar

**Files:**
- Create: `src/renderer/components/SummaryBar.tsx`, `Toolbar.tsx`

> SummaryBar computes totals from `statusById` (sites count, online/offline/warning counts, total TH/s). Toolbar: text search + filter chips (state, firmware).

- [ ] **Step 1: Implement.** **Step 2: Commit** — `git commit -am "feat(ui): summary bar + toolbar"`

### Task 8.3: SiteSection + DeviceTable + DeviceRow (the chosen compact table)

**Files:**
- Create: `src/renderer/components/SiteSection.tsx`, `DeviceTable.tsx`, `DeviceRow.tsx`

> Per-site collapsible section with a header (site name, online/total, site TH/s, "site-wide command" menu) and a **compact table**: columns = select ✓, device, state dot, firmware badge, hashrate, maxTemp (amber if ≥ warn), fan, worker, uptime, per-row actions (restart/stop/reboot). Rows colored by state. RTL layout. Selecting rows updates `selectedIds`.

- [ ] **Step 1: Implement** the three components; wire row action buttons to `window.api.device.command(id, cmd)`.
- [ ] **Step 2: Commit** — `git commit -am "feat(ui): per-site compact device table"`

### Task 8.4: BulkActionBar + AddDeviceDialog + confirmations

**Files:**
- Create: `src/renderer/components/BulkActionBar.tsx`, `AddDeviceDialog.tsx`

> BulkActionBar shows selected count + buttons (start/restart/stop/reboot) → `window.api.device.bulk(selectedIds, cmd)`; destructive actions open a confirm modal first; results show a per-device success/fail toast/summary. AddDeviceDialog collects site, name, model, firmware (dropdown), host, ports, and optional credential (sent to main to encrypt).

- [ ] **Step 1: Implement.** **Step 2: Commit** — `git commit -am "feat(ui): bulk actions + add-device dialog"`

### Task 8.5: Manual end-to-end verification against a real miner

> Not automated. Use the `superpowers:verification-before-completion` skill at execution time.

- [ ] Connect the dev machine to Tailscale; confirm one real ASIC is reachable (`telnet <tailscale-host> 4028`).
- [ ] Add that device in the app; confirm live status (hash/temp/fan/worker) matches its web UI.
- [ ] Issue restart/stop/start/reboot from the app; confirm effect on the miner.
- [ ] Verify offline alert by powering the miner's miner-process down.
- [ ] Confirm credentials persist encrypted (inspect DB: `secretEnc` is a BLOB, not plaintext).

---

## Milestone 9 — Tailscale setup docs + packaging

### Task 9.1: Site setup runbook

**Files:**
- Create: `docs/tailscale-site-setup.md`

> Step-by-step (Arabic) for each site's always-on laptop: install Tailscale, sign in to the shared tailnet, enable as subnet router advertising the local ASIC subnet, enable **4via6** with a unique site id, approve routes in the admin console. Include how to find each ASIC's 4via6 address to enter into the app.

- [ ] **Step 1: Write the runbook.** **Step 2: Commit** — `git commit -am "docs: tailscale per-site setup runbook"`

### Task 9.2: Package as a Windows installer

**Files:**
- Create: `electron-builder.yml`; Modify: `package.json` (build config)

> Configure electron-builder for an NSIS Windows installer; bundle the built main + renderer; rebuild `better-sqlite3` native module for Electron (`electron-rebuild` or `@electron/rebuild`).

- [ ] **Step 1: Configure + build** `npm run dist`; confirm an installer is produced and launches on a clean Windows profile.
- [ ] **Step 2: Commit** — `git commit -am "build: windows installer packaging"`

---

## Self-Review (performed against the spec)

- **Spec §3 connectivity (Tailscale/4via6):** Milestone 9 runbook + app treats hosts as reachable. ✓
- **Spec §4.1 registry / encrypted creds:** M6.1 (repo) + M6.2 (DPAPI). ✓
- **Spec §4.2 monitor engine (4028, normalize, concurrency, offline):** M1 + M3. ✓
- **Spec §4.3 firmware drivers (Stock/Braiins/Vnish/LuxOS, unified interface):** M2. ✓
- **Spec §4.4 bulk engine (parallel, per-device results, confirm):** M4 (engine) + M8.4 (confirm UI). ✓
- **Spec §4.5 UI (per-site grouping, compact table, summary, bulk bar, search):** M8. ✓
- **Spec §4.6 alerts (offline/overheat/hashdrop):** M5 + M7 (notify) + M8.5 (verify). ✓
- **Spec §6 security (Tailscale-only, DPAPI, confirmations):** M6.2 + M8.4 + M9.1. ✓
- **Spec §7 stack (Electron/TS/React/SQLite):** M0 + throughout. ✓
- **Spec §8 scope (deferred items excluded):** no tasks for history/profit/auto-tune/firmware-update/mobile/multi-user. ✓

**Type consistency:** `DeviceStatus`, `Device`, `ControlCommand`, `Transport`, `CommandOutcome`, `getDriver` are defined once (M1/M2) and reused identically in M3–M8. Driver method is `execute(device, command, transport, secret?)` everywhere. ✓

**Placeholder scan:** Core logic tasks (M0–M6.1, the TDD heart) carry complete code. Integration tasks (M6.3–M9) specify exact files, responsibilities, signatures, and commands; their network/UI bodies are described precisely rather than fully transcribed because they are thin shells over the already-fully-specified core and are validated by the M8.5 manual run. No "TBD/implement later" remain.
