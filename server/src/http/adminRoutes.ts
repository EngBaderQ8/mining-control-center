import type { IncomingMessage, ServerResponse } from "node:http";
import { createWriteStream, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, basename, resolve } from "node:path";
import type { ServerRepo } from "../db/repo";
import type { CommandRouter } from "../router/commandRouter";
import { verifyToken } from "../auth/jwt";
import { hashPassword } from "../auth/password";
import { getNetworkStats } from "../profit/networkStats";
import { btcPerDay, powerKwFromHashrate } from "../../../src/core/profit/calc";
import { lookupSpec } from "../../../src/core/devices/catalog";
import type { ControlCommand } from "../../../src/core/drivers/types";
import type { CommandOutcome } from "../../../src/core/model/result";
import { readOwnerConfig, writeOwnerConfig, sendOwnerTelegram } from "../monitor/ownerAlerts";

/** Control ops the admin may route to any account's miners (whitelist). */
const ADMIN_COMMANDS: ControlCommand[] = [
  "restartMining",
  "stopMining",
  "startMining",
  "reboot",
  "setPool",
  "setProfile",
  "diagnose",
];

export interface AdminDeps {
  repo: ServerRepo;
  jwtSecret: string;
  adminEmails: Set<string>; // lowercased
  pushUpdate: (userId?: string) => number; // tell clients to update now
  router: CommandRouter; // route control commands to the owning agent (remote control)
  dataDir: string;
  signManifest?: (payload: string) => string | null; // Ed25519 sign (needs UPDATE_PRIVATE_KEY)
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

/** Append-only audit line for state-changing admin actions (pm2 captures stdout). */
function audit(req: IncomingMessage, actor: string, action: string, target: string): void {
  const ip = (req.socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
  console.log(`[admin-audit] actor=${actor} action=${action} target=${target} ip=${ip} at=${new Date().toISOString()}`);
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (v: Record<string, unknown>): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024) {
        req.destroy();
        finish({});
        return;
      }
      chunks.push(Buffer.from(c));
    });
    req.on("end", () => {
      try {
        finish(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>);
      } catch {
        finish({});
      }
    });
    req.on("error", () => finish({}));
    req.on("close", () => finish({}));
  });
}

/** Returns the admin's userId if the request bears a valid admin token, else null. */
function adminUserId(req: IncomingMessage, deps: AdminDeps): string | null {
  const raw = req.headers["authorization"];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const m = /^Bearer\s+(.+)$/.exec(header ?? "");
  if (!m) return null;
  const uid = verifyToken(m[1]!, deps.jwtSecret);
  if (!uid) return null;
  const u = deps.repo.findUserById(uid);
  if (!u) return null;
  if (u.suspended) return null; // suspension = immediate revocation
  return deps.adminEmails.has(u.email.toLowerCase()) ? uid : null;
}

/** Cross-account analytics for the overview (hashrate, revenue, power, fleet mix). */
async function overview(repo: ServerRepo): Promise<unknown> {
  const devs = repo.devicesForAdmin();
  let hashrate = 0;
  let online = 0;
  let warning = 0;
  let hot = 0;
  const byVendor: Record<string, number> = {};
  const byFirmware: Record<string, number> = {};
  for (const d of devs) {
    hashrate += d.hashrateTHs ?? 0;
    if (d.state === "online") online++;
    if (d.state === "warning") warning++;
    if ((d.maxTempC ?? 0) >= 80) hot++;
    byFirmware[d.firmware] = (byFirmware[d.firmware] ?? 0) + 1;
    const spec = lookupSpec(d.model) ?? lookupSpec(d.name);
    const v = spec?.vendor ?? "غير معروف";
    byVendor[v] = (byVendor[v] ?? 0) + 1;
  }
  const base = repo.adminOverview();
  const net = await getNetworkStats();
  const btc = btcPerDay(hashrate, net);
  return {
    users: base.users,
    sites: base.sites,
    devices: devs.length,
    online,
    offline: Math.max(0, devs.length - online),
    warning,
    hot,
    hashrate,
    btcDay: btc,
    usdDay: btc * net.priceUsd,
    powerKw: powerKwFromHashrate(hashrate),
    priceUsd: net.priceUsd,
    byVendor,
    byFirmware,
  };
}

interface Incident {
  email: string;
  name: string;
  host: string;
  type: "offline" | "hot" | "under";
  detail: string;
}

/**
 * Intelligent operations report across ALL customers — unique features:
 *  - Underperformance: each device's live hashrate vs its model's RATED hashrate
 *    (from the device knowledge base) → flags miners running below 85%.
 *  - Live incident feed: offline / overheating / underperforming, fleet-wide.
 *  - Per-customer health score (0–100) for instant triage.
 *  - Fleet efficiency % (actual vs rated) and estimated lost hashrate.
 */
function opsReport(repo: ServerRepo): unknown {
  const devs = repo.devicesForAdmin();
  const incidents: Incident[] = [];
  const perUser: Record<string, { total: number; online: number; hot: number; under: number }> = {};
  let ratedTotal = 0;
  let actualTotal = 0;
  let underCount = 0;
  let lost = 0;
  for (const d of devs) {
    const u = (perUser[d.userId] ??= { total: 0, online: 0, hot: 0, under: 0 });
    u.total++;
    const hr = d.hashrateTHs ?? 0;
    const online = d.state === "online";
    if (online) u.online++;
    if ((d.maxTempC ?? 0) >= 80) {
      u.hot++;
      incidents.push({ email: d.email, name: d.name, host: d.host, type: "hot", detail: `${Math.round(d.maxTempC ?? 0)}°` });
    }
    if (d.state === "offline") {
      incidents.push({ email: d.email, name: d.name, host: d.host, type: "offline", detail: "غير متصل" });
    }
    const spec = lookupSpec(d.model) ?? lookupSpec(d.name);
    const rated = spec?.nominalTHs ?? 0;
    if (rated > 0 && online) {
      ratedTotal += rated;
      actualTotal += hr;
      if (hr < rated * 0.85) {
        u.under++;
        underCount++;
        lost += rated - hr;
        incidents.push({
          email: d.email,
          name: d.name,
          host: d.host,
          type: "under",
          detail: `${Math.round(hr)}/${rated} TH (${Math.round((hr / rated) * 100)}%)`,
        });
      }
    }
  }
  const health: Record<string, { score: number; under: number; hot: number; online: number; total: number }> = {};
  for (const uid of Object.keys(perUser)) {
    const u = perUser[uid]!;
    let score = 100;
    score -= (1 - (u.total ? u.online / u.total : 1)) * 50;
    score -= Math.min(20, u.hot * 5);
    score -= Math.min(20, u.under * 3);
    health[uid] = { score: Math.max(0, Math.round(score)), under: u.under, hot: u.hot, online: u.online, total: u.total };
  }
  const order = { offline: 0, hot: 1, under: 2 } as const;
  incidents.sort((a, b) => order[a.type] - order[b.type]);
  return {
    fleet: {
      ratedTotal: Math.round(ratedTotal),
      actualTotal: Math.round(actualTotal),
      efficiencyPct: ratedTotal > 0 ? Math.round((actualTotal / ratedTotal) * 100) : null,
      underCount,
      lost: Math.round(lost),
    },
    incidents: incidents.slice(0, 60),
    health,
  };
}

/** Owner admin dashboard: serves the page and the cross-account API. */
export async function handleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AdminDeps,
): Promise<boolean> {
  const path = (req.url ?? "").split("?")[0] ?? "";
  if (!path.startsWith("/admin")) return false;

  if ((path === "/admin" || path === "/admin/") && req.method === "GET") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
    });
    res.end(ADMIN_HTML);
    return true;
  }

  if (path.startsWith("/admin/api/")) {
    const uid = adminUserId(req, deps);
    if (!uid) {
      send(res, 403, { error: "forbidden" });
      return true;
    }
    const repo = deps.repo;
    if (path === "/admin/api/overview" && req.method === "GET") {
      send(res, 200, await overview(repo));
      return true;
    }
    if (path === "/admin/api/accounts" && req.method === "GET") {
      send(res, 200, { accounts: repo.accountSummaries() });
      return true;
    }
    if (path === "/admin/api/agents" && req.method === "GET") {
      send(res, 200, { agents: repo.listAllAgents() });
      return true;
    }
    if (path === "/admin/api/ops" && req.method === "GET") {
      send(res, 200, opsReport(repo));
      return true;
    }
    if (path === "/admin/api/devices" && req.method === "GET") {
      send(res, 200, { devices: repo.devicesForAdmin() });
      return true;
    }
    if (path === "/admin/api/history" && req.method === "GET") {
      send(res, 200, { history: repo.listHistory(Date.now() - 7 * 24 * 60 * 60 * 1000) });
      return true;
    }
    if (path === "/admin/api/account" && req.method === "GET") {
      const q = new URL(req.url ?? "", "http://local");
      const tid = q.searchParams.get("userId") ?? "";
      send(res, 200, {
        sites: repo.listSites(tid),
        devices: repo.listDevices(tid),
        statuses: repo.listStatuses(tid),
      });
      return true;
    }
    if (path === "/admin/api/suspend" && req.method === "POST") {
      const b = await readBody(req);
      if (typeof b["userId"] === "string") {
        repo.setSuspended(b["userId"], !!b["suspended"]);
        audit(req, uid, b["suspended"] ? "suspend" : "unsuspend", b["userId"]);
      }
      send(res, 200, { ok: true });
      return true;
    }
    if (path === "/admin/api/reset-password" && req.method === "POST") {
      const b = await readBody(req);
      const pw = typeof b["password"] === "string" ? b["password"] : "";
      if (typeof b["userId"] === "string" && pw.length >= 6) {
        repo.setUserPassword(b["userId"], await hashPassword(pw));
        audit(req, uid, "reset-password", b["userId"]);
        send(res, 200, { ok: true });
      } else {
        send(res, 400, { error: "password must be >= 6 chars" });
      }
      return true;
    }
    if (path === "/admin/api/control" && req.method === "POST") {
      const b = await readBody(req);
      const deviceId = typeof b["deviceId"] === "string" ? b["deviceId"] : "";
      const command = (typeof b["command"] === "string" ? b["command"] : "") as ControlCommand;
      if (!deviceId || !ADMIN_COMMANDS.includes(command)) {
        send(res, 400, { error: "bad request" });
        return true;
      }
      const owner = repo.deviceOwner(deviceId);
      if (!owner) {
        send(res, 404, { error: "device not found" });
        return true;
      }
      // Coerce every param VALUE to a string so a crafted nested object can't reach
      // the agent/driver (e.g. setPool url/user/pass).
      let params: Record<string, string> | undefined;
      const rawParams = b["params"];
      if (rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)) {
        params = {};
        for (const [k, v] of Object.entries(rawParams as Record<string, unknown>)) {
          if (typeof v === "string" || typeof v === "number" || typeof v === "boolean")
            params[k] = String(v);
        }
      }
      audit(req, uid, `control:${command}`, deviceId); // log intent before acting
      try {
        const outcome = await deps.router.routeCommand(owner.agentId, {
          type: "command.exec",
          commandId: randomUUID(),
          deviceId,
          command,
          ...(params ? { params } : {}),
        });
        audit(req, uid, `control:${command}:${outcome.ok ? "ok" : "fail"}`, deviceId);
        send(res, 200, outcome);
      } catch (e) {
        audit(req, uid, `control:${command}:error`, deviceId);
        send(res, 200, { deviceId, ok: false, error: (e as Error).message });
      }
      return true;
    }
    if (path === "/admin/api/killswitch" && req.method === "POST") {
      // Stop (or start) EVERY miner a customer owns — e.g. to cut off a non-payer.
      const b = await readBody(req);
      const userId = typeof b["userId"] === "string" ? b["userId"] : "";
      const command: ControlCommand = b["action"] === "start" ? "startMining" : "stopMining";
      if (!userId || !repo.findUserById(userId)) {
        send(res, 400, { error: "bad request" });
        return true;
      }
      const all = repo.devicesWithAgent(userId);
      const devices = all.filter((d) => d.agentId); // skip rows with no agent yet
      audit(req, uid, `killswitch:${command}`, `${userId} (${all.length} devices)`);
      // Fan out in bounded batches (not all at once) so a large account doesn't
      // flood the agent socket / pin a flood of pending command timers.
      const BATCH = 10;
      let ok = 0;
      let failed = 0;
      for (let i = 0; i < devices.length; i += BATCH) {
        const results = await Promise.allSettled(
          devices.slice(i, i + BATCH).map((d) =>
            deps.router.routeCommand(d.agentId, {
              type: "command.exec",
              commandId: randomUUID(),
              deviceId: d.id,
              command,
            }),
          ),
        );
        for (const r of results) {
          if (r.status === "fulfilled" && (r.value as CommandOutcome).ok) ok++;
          else failed++;
        }
      }
      // `unreachable` = devices we couldn't even attempt (offline/unregistered agent)
      // so the operator knows those miners were NOT actually stopped.
      send(res, 200, {
        total: all.length,
        ok,
        failed,
        unreachable: all.length - devices.length,
        action: command,
      });
      return true;
    }
    if (path === "/admin/api/owner-alerts" && req.method === "GET") {
      const c = readOwnerConfig(deps.dataDir);
      // Never return the bot token — only whether one is set.
      send(res, 200, { configured: !!c.token, chatId: c.chatId, enabled: c.enabled });
      return true;
    }
    if (path === "/admin/api/owner-alerts" && req.method === "POST") {
      const b = await readBody(req);
      const token = typeof b["token"] === "string" ? b["token"].trim() : "";
      const chatId = typeof b["chatId"] === "string" ? b["chatId"].trim() : "";
      const enabled = !!b["enabled"];
      const cur = readOwnerConfig(deps.dataDir);
      // Keep the saved token/chatId when the field is left blank (don't wipe on edit).
      const finalToken = token || cur.token;
      const finalChat = chatId || cur.chatId;
      writeOwnerConfig(deps.dataDir, {
        token: finalToken,
        chatId: finalChat,
        // Can't be "enabled" without a token+chatId (avoid a misleading on-state).
        enabled: enabled && !!finalToken && !!finalChat,
      });
      audit(req, uid, "owner-alerts:save", `enabled=${enabled}`);
      send(res, 200, { ok: true });
      return true;
    }
    if (path === "/admin/api/owner-alerts/test" && req.method === "POST") {
      const c = readOwnerConfig(deps.dataDir);
      const ok = await sendOwnerTelegram(
        c.token,
        c.chatId,
        "✅ اختبار تنبيهات المالك — التنبيهات تعمل!",
      );
      send(res, 200, { ok });
      return true;
    }
    if (path === "/admin/api/upload-update" && req.method === "POST") {
      const q = new URL(req.url ?? "", "http://local");
      const version = (q.searchParams.get("version") ?? "").trim();
      const name = basename(q.searchParams.get("name") ?? "");
      // Strict allowlist (no traversal/odd chars) — the filename is signed + served.
      if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[A-Za-z0-9._-]+\.exe$/.test(name)) {
        send(res, 400, { error: "need ?version=x.y.z & name=safe-name.exe" });
        return true;
      }
      if (!deps.signManifest) {
        send(res, 400, { error: "الخادم بدون UPDATE_PRIVATE_KEY — التوقيع معطّل" });
        return true;
      }
      const dir = join(deps.dataDir, "updates");
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, name);
      const part = `${dest}.part`;
      // Defense-in-depth: never let a crafted name escape updates/.
      if (resolve(dest) !== join(resolve(dir), name)) {
        send(res, 400, { error: "bad name" });
        return true;
      }
      const hash = createHash("sha256");
      let size = 0;
      let tooBig = false;
      const file = createWriteStream(part);
      try {
        await new Promise<void>((res2, reject) => {
          req.on("data", (c: Buffer) => {
            size += c.length;
            if (size > 600 * 1024 * 1024) {
              tooBig = true;
              req.destroy();
              file.destroy();
              reject(new Error("too large"));
              return;
            }
            hash.update(c);
          });
          req.pipe(file);
          file.on("finish", () => res2());
          file.on("error", reject);
          req.on("error", reject);
        });
      } catch {
        try {
          rmSync(part, { force: true });
        } catch {
          /* ignore */
        }
        send(res, tooBig ? 413 : 400, { error: tooBig ? "الملف كبير جداً (>600MB)" : "فشل الرفع" });
        return true;
      }
      const sha256 = hash.digest("hex");
      const uploadedAt = Date.now();
      // Sign the WHOLE manifest (version + content hash + size + freshness +
      // filename), so nothing can be swapped or an old manifest replayed.
      const sig = deps.signManifest(`${version}:${sha256}:${size}:${uploadedAt}:${name}`);
      if (!sig) {
        rmSync(part, { force: true });
        send(res, 500, { error: "signing failed" });
        return true;
      }
      renameSync(part, dest); // publish only after hash + sign succeed
      writeFileSync(
        join(dir, "manifest.json"),
        JSON.stringify({ version, file: name, sha256, size, sig, uploadedAt }),
      );
      audit(req, uid, "upload-update", `${version} sha=${sha256.slice(0, 12)}`);
      const notified = deps.pushUpdate(); // ask all connected clients to update now
      send(res, 200, { ok: true, version, sha256, size, notified });
      return true;
    }
    if (path === "/admin/api/push-update" && req.method === "POST") {
      const b = await readBody(req);
      const target = typeof b["userId"] === "string" && b["userId"] ? b["userId"] : undefined;
      const notified = deps.pushUpdate(target);
      audit(req, uid, "push-update", target ?? "ALL");
      send(res, 200, { ok: true, notified });
      return true;
    }
    if (path === "/admin/api/delete" && req.method === "POST") {
      const b = await readBody(req);
      if (typeof b["userId"] === "string" && b["userId"] !== uid) {
        repo.deleteUser(b["userId"]);
        audit(req, uid, "delete", b["userId"]);
      }
      send(res, 200, { ok: true });
      return true;
    }
    send(res, 404, { error: "not found" });
    return true;
  }
  return false;
}

// Self-contained advanced dashboard. Data loads via fetch with the admin bearer
// token; all customer text is HTML-escaped, and only server UUIDs ever reach
// inline onclick handlers (never customer-controlled strings).
const ADMIN_HTML = `<!doctype html><html lang="ar" dir="rtl"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>لوحة تحكم المالك — مركز التحكم بالتعدين</title>
<style>
:root{--bg:#0a0c11;--card:#151922;--card2:#1b202b;--bd:#262c38;--tx:#e9ecf2;--mut:#8b93a3;--acc:#5b7cfa;--grn:#2dd4a7;--red:#f87171;--amb:#fbbf24}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:'Segoe UI',Tahoma,sans-serif;font-size:14px}
.wrap{max-width:1240px;margin:0 auto;padding:18px}
.hd{display:flex;align-items:center;gap:10px;padding-bottom:14px;border-bottom:1px solid var(--bd);margin-bottom:16px}
.logo{width:36px;height:36px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(150deg,#5b7cfa,#3b5bdb);font-size:19px;box-shadow:0 4px 14px rgba(91,124,250,.4)}
.btn{background:var(--card2);border:1px solid var(--bd);color:var(--tx);border-radius:9px;padding:8px 13px;cursor:pointer;font-size:13px}
.btn:hover{border-color:var(--acc)}.btn.primary{background:var(--acc);border-color:var(--acc);color:#fff}.btn.danger{color:var(--red)}.btn.sm{padding:5px 9px;font-size:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:18px}
.card{background:linear-gradient(180deg,#1b202b,#151922);border:1px solid var(--bd);border-radius:14px;padding:14px 16px;position:relative;overflow:hidden}
.card .n{font-size:23px;font-weight:800}.card .l{font-size:12px;color:var(--mut);margin-top:2px}
.card .bar{position:absolute;inset-block:0;inset-inline-end:0;width:3px;opacity:.6}
.grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:14px;margin-bottom:8px}
@media(max-width:880px){.grid2{grid-template-columns:1fr}}
.panel{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:14px 16px;margin-bottom:14px}
h2{font-size:15px;margin:0 0 10px}
table{width:100%;border-collapse:collapse}
th,td{padding:9px 10px;text-align:right;font-size:13px;border-bottom:1px solid var(--bd);white-space:nowrap}
th{color:var(--mut);font-weight:600;cursor:pointer;user-select:none}th:hover{color:var(--tx)}
tr:last-child td{border-bottom:0}
.pill{font-size:11px;padding:2px 8px;border-radius:999px}.on{background:rgba(45,212,167,.15);color:var(--grn)}.off{background:rgba(248,113,113,.15);color:var(--red)}.wn{background:rgba(251,191,36,.15);color:var(--amb)}
.in{background:#0d1016;border:1px solid var(--bd);color:var(--tx);border-radius:9px;padding:9px 12px}
.center{max-width:360px;margin:8vh auto;background:var(--card);border:1px solid var(--bd);border-radius:16px;padding:22px}
.err{color:var(--red);font-size:13px;margin:6px 0}.muted{color:var(--mut)}.grn{color:var(--grn)}.amb{color:var(--amb)}
.hide{display:none}.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.bars div{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12.5px}
.bars .t{width:110px;color:var(--mut);text-align:right;overflow:hidden;text-overflow:ellipsis}
.bars .b{height:9px;border-radius:5px;background:linear-gradient(90deg,#5b7cfa,#3b5bdb);min-width:2px}
.scroll{overflow:auto}
</style></head><body>
<div id="login" class="center">
  <div class="hd" style="border:0;padding:0;margin-bottom:14px"><div class="logo">⛏️</div><b>لوحة تحكم المالك</b></div>
  <input id="em" class="in" style="width:100%;margin:6px 0" placeholder="البريد (حساب المدير)" autocomplete="username">
  <input id="pw" class="in" style="width:100%;margin:6px 0" type="password" placeholder="كلمة المرور" autocomplete="current-password">
  <div id="le" class="err"></div>
  <button class="btn primary" style="width:100%" onclick="doLogin()">دخول</button>
</div>
<div id="dash" class="wrap hide">
  <div class="hd">
    <div class="logo">⛏️</div>
    <div><div style="font-weight:700">لوحة تحكم المالك</div><div class="muted" style="font-size:12px">إشراف مباشر على كل العملاء</div></div>
    <span style="margin-inline-start:auto"></span>
    <span id="price" class="muted" style="font-size:12px"></span>
    <button class="btn sm" style="border-color:var(--acc);color:var(--acc)" onclick="pushAll()">🚀 حدّث الكل الآن</button>
    <button class="btn sm" onclick="loadAll()">🔄 تحديث</button>
    <span id="live" class="muted" style="font-size:12px"></span>
    <button class="btn sm" onclick="logout()">خروج</button>
  </div>
  <div id="cards" class="cards"></div>
  <div id="cards2" class="cards"></div>
  <div class="panel" style="border-color:#3a2530"><h2>🚨 مركز العمليات — مشاكل حيّة عبر كل العملاء</h2><div class="scroll"><div id="ops"></div></div></div>
  <div class="panel"><h2>🔔 تنبيهات المالك (تيليجرام)</h2>
    <div class="muted" style="font-size:12.5px;margin-bottom:8px">يصلك تنبيه فوري لمّا أسطول أي عميل يهبط (offline جماعي أو هبوط هاش حاد) — بدون ما تراقب اللوحة.</div>
    <div class="row" style="flex-wrap:wrap;gap:8px;align-items:center">
      <input id="oaToken" type="password" placeholder="Bot Token" style="min-width:280px;background:#0d1117;border:1px solid #2a2f3a;color:var(--tx);padding:7px 9px;border-radius:7px">
      <input id="oaChat" placeholder="Chat ID" style="min-width:150px;background:#0d1117;border:1px solid #2a2f3a;color:var(--tx);padding:7px 9px;border-radius:7px">
      <label class="muted" style="font-size:13px"><input type="checkbox" id="oaEnabled"> مفعّل</label>
      <button class="btn sm" style="border-color:var(--acc);color:var(--acc)" onclick="saveOA()">حفظ</button>
      <button class="btn sm" onclick="testOA()">اختبار</button>
      <span id="oaStatus" class="muted" style="font-size:12px"></span>
    </div>
  </div>
  <div class="grid2">
    <div class="panel"><h2>📈 الهاش الكلي (آخر ٧ أيام)</h2><div id="chart"></div></div>
    <div class="panel"><h2>🏭 تركيبة الأسطول</h2><div id="fleet"></div></div>
  </div>
  <div class="panel">
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">👥 الحسابات</h2>
      <div class="row">
        <input id="acsearch" class="in" placeholder="بحث بالبريد…" oninput="renderAccts()" style="font-size:12.5px">
        <select id="acfilter" class="in" onchange="renderAccts()" style="font-size:12.5px"><option value="all">الكل</option><option value="active">نشط</option><option value="suspended">موقوف</option></select>
      </div>
    </div>
    <div class="scroll"><div id="accounts"></div></div>
  </div>
  <div id="detail"></div>
  <div class="panel">
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">🔎 بحث عن جهاز (كل العملاء)</h2>
      <input id="dvsearch" class="in" placeholder="اسم/آي بي/وركر/بريد…" oninput="renderDevices()" style="font-size:12.5px;min-width:240px"></div>
    <div class="scroll"><div id="devices"></div></div>
  </div>
  <div class="panel"><h2>📤 رفع تحديث للبرنامج (يوزّع لكل الأجهزة)</h2>
    <div id="updcur" class="muted" style="font-size:12.5px;margin-bottom:8px"></div>
    <div class="row">
      <input type="file" id="updfile" accept=".exe" class="in" style="font-size:12px">
      <input id="updver" class="in" placeholder="النسخة (مثل 0.1.53)" style="font-size:12.5px;width:160px">
      <button class="btn primary" onclick="uploadUpd()">رفع وتوزيع</button>
    </div>
    <div id="updstatus" style="font-size:12.5px;margin-top:8px"></div>
    <div class="muted" style="font-size:11.5px;margin-top:6px">ارفع ملف التثبيت (.exe) اللي بناه المطوّر واكتب رقم نسخته. يُوقّع تلقائياً (Ed25519) ويُدفع لكل الأجهزة المتصلة لتحدّث نفسها — وكل جهاز يتحقق من التوقيع والبصمة قبل التثبيت.</div>
  </div>
  <div class="panel"><h2>🖥️ صحة الوكلاء (لابتوبات المواقع)</h2><div class="scroll"><div id="agents"></div></div></div>
</div>
<script>
var TOKEN=localStorage.getItem('mcc_admin_token')||'';
var ACCTS=[],DEVS=[],SORT={k:'hashrate',d:-1},OPS_HEALTH={};
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function n(v){return (Number(v)||0).toLocaleString('en-US',{maximumFractionDigits:0});}
function n1(v){return (Number(v)||0).toLocaleString('en-US',{maximumFractionDigits:1});}
function ago(t){if(!t)return '—';var s=Math.floor((Date.now()-t)/1000);if(s<60)return 'الآن';if(s<3600)return Math.floor(s/60)+' د';if(s<86400)return Math.floor(s/3600)+' س';return Math.floor(s/86400)+' ي';}
function api(p,o){o=o||{};o.headers=Object.assign({'authorization':'Bearer '+TOKEN,'content-type':'application/json'},o.headers||{});return fetch(p,o);}
function doLogin(){var em=document.getElementById('em').value.trim(),pw=document.getElementById('pw').value;document.getElementById('le').textContent='';
  fetch('/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:em,password:pw})}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j};});}).then(function(x){if(!x.ok){document.getElementById('le').textContent=x.j.error||'فشل الدخول';return;}TOKEN=x.j.token;localStorage.setItem('mcc_admin_token',TOKEN);start();}).catch(function(){document.getElementById('le').textContent='تعذّر الاتصال';});}
function logout(){TOKEN='';localStorage.removeItem('mcc_admin_token');location.reload();}
function start(){api('/admin/api/overview').then(function(r){if(r.status===403){document.getElementById('le').textContent='هذا الحساب ليس مديراً.';logout();return;}document.getElementById('login').classList.add('hide');document.getElementById('dash').classList.remove('hide');loadAll();}).catch(function(){document.getElementById('le').textContent='تعذّر الاتصال';});}
var AUTO=null;
function loadAll(){ov();ops();chart();accounts();devices();agents();loadManifest();loadOA();startAuto();}
function startAuto(){if(AUTO)return;AUTO=setInterval(function(){ov();ops();accounts();agents();var d=new Date();document.getElementById('live').textContent='🔴 مباشر · '+d.toLocaleTimeString('ar-SA');},15000);}
function loadOA(){api('/admin/api/owner-alerts').then(function(r){return r.json();}).then(function(c){document.getElementById('oaChat').value=c.chatId||'';document.getElementById('oaEnabled').checked=!!c.enabled;document.getElementById('oaToken').placeholder=c.configured?'(توكن محفوظ — اتركه فاضي للإبقاء عليه)':'Bot Token';}).catch(function(){});}
function saveOA(){var body={token:document.getElementById('oaToken').value,chatId:document.getElementById('oaChat').value,enabled:document.getElementById('oaEnabled').checked};api('/admin/api/owner-alerts',{method:'POST',body:JSON.stringify(body)}).then(function(r){return r.json();}).then(function(){document.getElementById('oaStatus').textContent='✅ حُفظ';document.getElementById('oaToken').value='';loadOA();}).catch(function(){document.getElementById('oaStatus').textContent='❌ فشل الحفظ';});}
function testOA(){document.getElementById('oaStatus').textContent='… جاري الإرسال';api('/admin/api/owner-alerts/test',{method:'POST',body:'{}'}).then(function(r){return r.json();}).then(function(j){document.getElementById('oaStatus').textContent=j.ok?'✅ وصلتك رسالة الاختبار على تيليجرام':'❌ فشل — تأكد من التوكن و Chat ID والتفعيل';}).catch(function(){document.getElementById('oaStatus').textContent='❌ تعذّر الإرسال';});}
function loadManifest(){fetch('/update-manifest').then(function(r){return r.json();}).then(function(m){document.getElementById('updcur').innerHTML=(m&&m.version)?('النسخة المستضافة حالياً: <b style="color:var(--acc)">'+esc(m.version)+'</b> · '+esc(m.file||'')):'لا توجد نسخة مرفوعة بعد.';}).catch(function(){});}
function uploadUpd(){var f=document.getElementById('updfile').files[0],v=document.getElementById('updver').value.trim(),st=document.getElementById('updstatus');
  if(!f){st.innerHTML='<span class="amb">اختر ملف .exe أول</span>';return;}
  if(!/^\\d+\\.\\d+\\.\\d+$/.test(v)){st.innerHTML='<span class="amb">اكتب النسخة بصيغة x.y.z</span>';return;}
  var xhr=new XMLHttpRequest();xhr.open('POST','/admin/api/upload-update?version='+encodeURIComponent(v)+'&name='+encodeURIComponent(f.name));xhr.setRequestHeader('authorization','Bearer '+TOKEN);
  xhr.upload.onprogress=function(e){if(e.lengthComputable)st.innerHTML='⬆ جاري الرفع… '+Math.round(e.loaded/e.total*100)+'%';};
  xhr.onload=function(){try{var j=JSON.parse(xhr.responseText);if(j.ok){st.innerHTML='<span class="grn">✅ تم الرفع والتوقيع (نسخة '+esc(j.version)+') ودُفع لـ '+(j.notified||0)+' جهاز متصل.</span>';loadManifest();}else{st.innerHTML='<span class="amb">'+esc(j.error||'فشل')+'</span>';}}catch(e){st.innerHTML='<span class="amb">فشل ('+xhr.status+')</span>';}};
  xhr.onerror=function(){st.innerHTML='<span class="amb">تعذّر الاتصال</span>';};st.innerHTML='⬆ جاري الرفع…';xhr.send(f);}
function ops(){api('/admin/api/ops').then(function(r){return r.json();}).then(function(o){var f=o.fleet||{};OPS_HEALTH=o.health||{};
  document.getElementById('cards2').innerHTML=
    card((f.efficiencyPct!=null?f.efficiencyPct+'%':'—'),'كفاءة الأسطول (الفعلي/الاسمي)',(f.efficiencyPct!=null&&f.efficiencyPct<85)?'var(--amb)':'var(--grn)')+
    card(n(f.underCount),'أجهزة دون الأداء','var(--amb)')+
    card(n(f.lost)+' TH','هاش مفقود تقديري','var(--red)')+
    card(n(f.ratedTotal)+' TH','الطاقة الاسمية الكلية','var(--mut)');
  var lab={offline:'🔴 غير متصل',hot:'🌡️ سخونة',under:'📉 دون الأداء'};
  var rows=(o.incidents||[]).map(function(i){return '<tr><td>'+lab[i.type]+'</td><td>'+esc(i.name)+'</td><td class="muted">'+esc(i.host)+'</td><td class="muted">'+esc(i.email)+'</td><td>'+esc(i.detail)+'</td></tr>';}).join('');
  document.getElementById('ops').innerHTML='<table><thead><tr><th>النوع</th><th>الجهاز</th><th>العنوان</th><th>العميل</th><th>التفاصيل</th></tr></thead><tbody>'+(rows||'<tr><td colspan="5" class="grn">✅ ما فيه مشاكل — كل الأجهزة بخير</td></tr>')+'</tbody></table>';
  renderAccts();
});}
function card(v,l,c){return '<div class="card"><div class="n" style="color:'+(c||'var(--tx)')+'">'+v+'</div><div class="l">'+l+'</div><div class="bar" style="background:'+(c||'var(--acc)')+'"></div></div>';}
function ov(){api('/admin/api/overview').then(function(r){return r.json();}).then(function(o){
  document.getElementById('price').textContent=o.priceUsd?('BTC ≈ $'+n(o.priceUsd)):'';
  document.getElementById('cards').innerHTML=
   card(n(o.hashrate)+' <span style="font-size:13px">TH/s</span>','الهاش الكلي','var(--acc)')+
   card('$ '+n(o.usdDay),'إيراد تقديري/يوم','var(--grn)')+
   card('₿ '+(Number(o.btcDay)||0).toFixed(4),'BTC/يوم')+
   card(n(o.powerKw)+' <span style="font-size:13px">kW</span>','الطاقة التقديرية','var(--amb)')+
   card(n(o.users),'الحسابات')+card(n(o.devices),'الأجهزة')+
   card(n(o.online),'أونلاين','var(--grn)')+card(n(o.offline),'أوفلاين','var(--red)')+
   card(n(o.hot),'ساخنة (≥80°)','var(--amb)');
  fleet(o.byVendor,o.byFirmware);
});}
function fleet(v,f){function bars(obj,label){var ks=Object.keys(obj).sort(function(a,b){return obj[b]-obj[a];});var mx=Math.max(1,Math.max.apply(null,ks.map(function(k){return obj[k];})));var h='<div class="muted" style="font-size:12px;margin:6px 0 2px">'+label+'</div><div class="bars">';ks.forEach(function(k){h+='<div><span class="t">'+esc(k)+'</span><span class="b" style="width:'+Math.round(obj[k]/mx*150)+'px"></span><span>'+obj[k]+'</span></div>';});return h+'</div>';}
  document.getElementById('fleet').innerHTML=bars(v,'حسب الشركة')+bars(f,'حسب الفرمور');}
function chart(){api('/admin/api/history').then(function(r){return r.json();}).then(function(d){var h=d.history||[];var el=document.getElementById('chart');
  if(h.length<2){el.innerHTML='<div class="muted" style="font-size:12.5px;padding:20px 0;text-align:center">يتجمّع التاريخ تلقائياً (نقطة كل ١٠ دقائق)…</div>';return;}
  var W=640,H=150,p=6;var xs=h.map(function(r){return r.at;}),ys=h.map(function(r){return r.hashrate;});var x0=Math.min.apply(null,xs),x1=Math.max.apply(null,xs),y1=Math.max.apply(null,ys)||1;
  var pts=h.map(function(r){var x=p+(r.at-x0)/(x1-x0||1)*(W-2*p);var y=H-p-(r.hashrate/y1)*(H-2*p);return x.toFixed(1)+','+y.toFixed(1);}).join(' ');
  el.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:150px"><polyline fill="none" stroke="#5b7cfa" stroke-width="2" points="'+pts+'"/><polyline fill="rgba(91,124,250,.12)" stroke="none" points="'+pts+' '+(W-p)+','+(H-p)+' '+p+','+(H-p)+'"/></svg><div class="muted" style="font-size:11px;text-align:center">الأحدث ← '+n(ys[ys.length-1])+' TH/s</div>';
});}
function sortBy(k){if(SORT.k===k)SORT.d=-SORT.d;else{SORT.k=k;SORT.d=-1;}renderAccts();}
function accounts(){api('/admin/api/accounts').then(function(r){return r.json();}).then(function(d){ACCTS=d.accounts||[];renderAccts();});}
function renderAccts(){var q=(document.getElementById('acsearch').value||'').toLowerCase(),f=document.getElementById('acfilter').value;
  var list=ACCTS.filter(function(a){if(f==='active'&&a.suspended)return false;if(f==='suspended'&&!a.suspended)return false;return (a.email||'').toLowerCase().indexOf(q)>=0;});
  function gv(a,k){return k==='health'?((OPS_HEALTH[a.id]||{}).score==null?100:OPS_HEALTH[a.id].score):a[k];}
  list.sort(function(a,b){var x=gv(a,SORT.k),y=gv(b,SORT.k);if(typeof x==='string'){x=(x||'').toLowerCase();y=(y||'').toLowerCase();}return (x>y?1:x<y?-1:0)*SORT.d;});
  function thh(k,t){return '<th onclick="sortBy(\\''+k+'\\')">'+t+(SORT.k===k?(SORT.d<0?' ▼':' ▲'):'')+'</th>';}
  var rows=list.map(function(a){var st=a.suspended?'<span class="pill off">موقوف</span>':'<span class="pill on">نشط</span>';
    var h=OPS_HEALTH[a.id]||{},hs=(h.score==null?100:h.score),hc=hs>=85?'var(--grn)':(hs>=60?'var(--amb)':'var(--red)');
    var hcell='<td><b style="color:'+hc+'">'+hs+'</b>'+(h.under?' <span class="muted" style="font-size:11px">📉'+h.under+'</span>':'')+(h.hot?' <span class="amb" style="font-size:11px">🌡️'+h.hot+'</span>':'')+'</td>';
    return '<tr><td>'+esc(a.email)+'</td><td>'+a.sites+'</td><td>'+a.devices+'</td><td class="grn">'+a.online+'</td><td>'+n(a.hashrate)+' TH</td>'+hcell+'<td class="muted">'+ago(a.lastSeen)+'</td><td>'+st+'</td><td><div class="row">'+
      '<button class="btn sm" onclick="detail(\\''+a.id+'\\')">تفصيل</button>'+
      '<button class="btn sm" onclick="susp(\\''+a.id+'\\','+(a.suspended?0:1)+')">'+(a.suspended?'تفعيل':'إيقاف')+'</button>'+
      '<button class="btn sm" onclick="resetpw(\\''+a.id+'\\')">باسورد</button>'+
      '<button class="btn sm" onclick="pushUser(\\''+a.id+'\\')">🚀 تحديث</button>'+
      '<button class="btn sm danger" onclick="killsw(\\''+a.id+'\\',\\'stop\\')" title="إيقاف تعدين كل أجهزة هذا الحساب">⛔ أطفِ</button>'+
      '<button class="btn sm" onclick="killsw(\\''+a.id+'\\',\\'start\\')" title="تشغيل تعدين كل أجهزة هذا الحساب">▶️ شغّل</button>'+
      '<button class="btn sm danger" onclick="del(\\''+a.id+'\\')">حذف</button></div></td></tr>';}).join('');
  document.getElementById('accounts').innerHTML='<table><thead><tr>'+thh('email','البريد')+thh('sites','المواقع')+thh('devices','الأجهزة')+thh('online','أونلاين')+thh('hashrate','الهاش')+thh('health','الصحة')+thh('lastSeen','آخر ظهور')+thh('suspended','الحالة')+'<th>إجراءات</th></tr></thead><tbody>'+(rows||'<tr><td colspan="9" class="muted">لا نتائج</td></tr>')+'</tbody></table>';}
function devices(){api('/admin/api/devices').then(function(r){return r.json();}).then(function(d){DEVS=d.devices||[];renderDevices();});}
function renderDevices(){var q=(document.getElementById('dvsearch').value||'').toLowerCase();if(!q){document.getElementById('devices').innerHTML='<div class="muted" style="font-size:12.5px">اكتب للبحث في كل أجهزة العملاء…</div>';return;}
  var list=DEVS.filter(function(d){return ((d.name||'')+(d.host||'')+(d.worker||'')+(d.email||'')+(d.firmware||'')).toLowerCase().indexOf(q)>=0;}).slice(0,200);
  var rows=list.map(function(d){var s=d.state==='online'?'<span class="pill on">أونلاين</span>':(d.state==='warning'?'<span class="pill wn">تحذير</span>':'<span class="pill off">'+esc(d.state||'—')+'</span>');
    var ctl='<div class="row">'+
      '<button class="btn sm" onclick="ctrl(\\''+d.id+'\\',\\'startMining\\')" title="تشغيل">▶</button>'+
      '<button class="btn sm danger" onclick="ctrl(\\''+d.id+'\\',\\'stopMining\\')" title="إيقاف">⏸</button>'+
      '<button class="btn sm" onclick="ctrl(\\''+d.id+'\\',\\'reboot\\')" title="إعادة تشغيل">↻</button></div>';
    return '<tr><td>'+esc(d.name)+'</td><td class="muted">'+esc(d.email)+'</td><td class="muted">'+esc(d.host)+'</td><td>'+esc(d.firmware)+'</td><td>'+s+'</td><td>'+(d.hashrateTHs?n1(d.hashrateTHs)+' TH':'—')+'</td><td>'+(d.maxTempC?Math.round(d.maxTempC)+'°':'—')+'</td><td>'+ctl+'</td></tr>';}).join('');
  document.getElementById('devices').innerHTML='<table><thead><tr><th>الجهاز</th><th>العميل</th><th>العنوان</th><th>الفرمور</th><th>الحالة</th><th>الهاش</th><th>الحرارة</th><th>تحكّم</th></tr></thead><tbody>'+(rows||'<tr><td colspan="8" class="muted">لا نتائج</td></tr>')+'</tbody></table>';}
function agents(){api('/admin/api/agents').then(function(r){return r.json();}).then(function(d){var rows=(d.agents||[]).map(function(a){var fresh=a.lastSeenAt&&(Date.now()-a.lastSeenAt)<120000;return '<tr><td>'+esc(a.name)+'</td><td><span class="pill" style="background:rgba(91,124,250,.15);color:var(--acc)">'+esc(a.version||'؟')+'</span></td><td>'+(fresh?'<span class="pill on">متصل</span>':'<span class="pill off">منقطع</span>')+'</td><td class="muted">'+ago(a.lastSeenAt)+'</td></tr>';}).join('');document.getElementById('agents').innerHTML='<table><thead><tr><th>اسم الوكيل</th><th>النسخة</th><th>الحالة</th><th>آخر ظهور</th></tr></thead><tbody>'+(rows||'<tr><td colspan="4" class="muted">لا وكلاء</td></tr>')+'</tbody></table>';});}
function pushAll(){if(!confirm('إرسال أمر تحديث فوري لكل الأجهزة المتصلة؟'))return;api('/admin/api/push-update',{method:'POST',body:JSON.stringify({})}).then(function(r){return r.json();}).then(function(j){alert('تم إرسال أمر التحديث لـ '+(j.notified||0)+' جهاز متصل.');});}
function pushUser(id){var a=acctById(id),email=a?a.email:'';if(!confirm('إرسال أمر تحديث لأجهزة «'+email+'»؟'))return;api('/admin/api/push-update',{method:'POST',body:JSON.stringify({userId:id})}).then(function(r){return r.json();}).then(function(j){alert('تم الإرسال لـ '+(j.notified||0)+' جهاز.');});}
function acctById(id){for(var i=0;i<ACCTS.length;i++)if(ACCTS[i].id===id)return ACCTS[i];return null;}
function ctrl(id,cmd){var lbl=cmd==='stopMining'?'إيقاف':cmd==='startMining'?'تشغيل':'إعادة تشغيل';if(!confirm(lbl+' هذا الجهاز عن بُعد؟'))return;api('/admin/api/control',{method:'POST',body:JSON.stringify({deviceId:id,command:cmd})}).then(function(r){return r.json();}).then(function(o){alert(o&&o.ok?('تم: '+lbl):('فشل: '+((o&&o.error)||'؟')));}).catch(function(){alert('تعذّر الإرسال');});}
function killsw(id,action){var a=acctById(id),email=a?a.email:'';var lbl=action==='stop'?'إيقاف تعدين':'تشغيل تعدين';if(!confirm('⛔ '+lbl+' كل أجهزة «'+email+'»؟\\n(إجراء خطير — يؤثّر على كل أجهزة الحساب)'))return;api('/admin/api/killswitch',{method:'POST',body:JSON.stringify({userId:id,action:action})}).then(function(r){return r.json();}).then(function(j){var msg='«'+lbl+'»: نجح '+(j.ok||0)+'/'+(j.total||0)+' جهاز';if(j.unreachable)msg+='\\n⚠️ '+j.unreachable+' غير قابل للوصول (وكيله غير متصل — لم يُوقَف!)';if(j.failed)msg+='\\n❌ فشل '+j.failed;alert(msg);}).catch(function(){alert('تعذّر الإرسال');});}
function detail(id){var a=acctById(id),email=a?a.email:'';api('/admin/api/account?userId='+encodeURIComponent(id)).then(function(r){return r.json();}).then(function(d){var byId={};(d.statuses||[]).forEach(function(s){byId[s.deviceId]=s;});
  var rows=(d.devices||[]).map(function(dv){var s=byId[dv.id]||{};return '<tr><td>'+esc(dv.name)+'</td><td class="muted">'+esc(dv.host)+'</td><td>'+esc(dv.firmware)+'</td><td>'+(s.state==='online'?'<span class="pill on">أونلاين</span>':'<span class="pill off">'+esc(s.state||'—')+'</span>')+'</td><td>'+(s.hashrateTHs?n1(s.hashrateTHs)+' TH':'—')+'</td><td>'+(s.maxTempC?Math.round(s.maxTempC)+'°':'—')+'</td><td class="muted">'+esc(s.worker||'—')+'</td></tr>';}).join('');
  document.getElementById('detail').innerHTML='<div class="panel"><div class="row" style="justify-content:space-between"><h2 style="margin:0">📋 '+esc(email)+' — '+(d.sites||[]).length+' موقع · '+(d.devices||[]).length+' جهاز</h2><button class="btn sm" onclick="document.getElementById(\\'detail\\').innerHTML=\\'\\'">إغلاق ✕</button></div><div class="scroll"><table><thead><tr><th>الجهاز</th><th>العنوان</th><th>الفرمور</th><th>الحالة</th><th>الهاش</th><th>الحرارة</th><th>الوركر</th></tr></thead><tbody>'+(rows||'<tr><td colspan="7" class="muted">لا أجهزة</td></tr>')+'</tbody></table></div></div>';
  document.getElementById('detail').scrollIntoView({behavior:'smooth'});});}
function susp(id,s){api('/admin/api/suspend',{method:'POST',body:JSON.stringify({userId:id,suspended:!!s})}).then(function(){accounts();});}
function resetpw(id){var a=acctById(id),email=a?a.email:'';var pw=prompt('باسورد جديد للحساب «'+email+'» (٦ أحرف فأكثر):');if(!pw)return;if(pw.length<6){alert('قصير جداً');return;}api('/admin/api/reset-password',{method:'POST',body:JSON.stringify({userId:id,password:pw})}).then(function(r){return r.json();}).then(function(j){alert(j.ok?'تم تغيير الباسورد':(j.error||'فشل'));});}
function del(id){var a=acctById(id),email=a?a.email:'';if(!confirm('حذف الحساب «'+email+'» وكل بياناته نهائياً؟'))return;api('/admin/api/delete',{method:'POST',body:JSON.stringify({userId:id})}).then(function(){accounts();});}
if(TOKEN)start();
setInterval(function(){if(TOKEN&&!document.getElementById('dash').classList.contains('hide')){ov();ops();accounts();devices();agents();}},30000);
</script></body></html>`;
