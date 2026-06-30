import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Site, Device, DeviceStatus } from "../../../src/core/model/device";

export type SiteRow = Site & { userId: string };
export type DeviceRow = Device & { userId: string; agentId: string };
export interface UserRow {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  suspended: number;
}

export interface FlashJobRow {
  jobId: string;
  batchId: string;
  userId: string;
  deviceId: string;
  agentId: string;
  firmwareId: string;
  // queued|downloading|verifying|matching|flashing|rebooting|confirming|success|failed|refused|stopped
  state: string;
  error: string | null;
  newVersion: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface AccountSummary {
  id: string;
  email: string;
  createdAt: number;
  suspended: number;
  sites: number;
  devices: number;
  online: number;
  hashrate: number;
  lastSeen: number | null;
}

export class ServerRepo {
  constructor(private db: Database.Database) {}

  createUser(email: string, passwordHash: string): string {
    const id = randomUUID();
    this.db
      .prepare(`INSERT INTO users(id,email,passwordHash,createdAt) VALUES(?,?,?,?)`)
      .run(id, email, passwordHash, Date.now());
    return id;
  }

  findUserByEmail(email: string): UserRow | undefined {
    return this.db
      .prepare(`SELECT id,email,passwordHash,createdAt,suspended FROM users WHERE email=?`)
      .get(email) as UserRow | undefined;
  }

  findUserById(id: string): { id: string; email: string; suspended: number } | undefined {
    return this.db.prepare(`SELECT id,email,suspended FROM users WHERE id=?`).get(id) as
      | { id: string; email: string; suspended: number }
      | undefined;
  }

  // —— Admin (owner) queries ——
  adminOverview(): { users: number; sites: number; devices: number; online: number; offline: number; hashrate: number } {
    const n = (sql: string): number => (this.db.prepare(sql).get() as { c: number }).c;
    const users = n(`SELECT COUNT(*) c FROM users`);
    const sites = n(`SELECT COUNT(*) c FROM sites`);
    const devices = n(`SELECT COUNT(*) c FROM devices`);
    const online = n(`SELECT COUNT(*) c FROM device_status WHERE state='online'`);
    const hashrate = (this.db.prepare(`SELECT COALESCE(SUM(hashrateTHs),0) h FROM device_status`).get() as { h: number }).h;
    return { users, sites, devices, online, offline: Math.max(0, devices - online), hashrate };
  }

  accountSummaries(): AccountSummary[] {
    return this.db
      .prepare(
        `SELECT u.id, u.email, u.createdAt, u.suspended,
           (SELECT COUNT(*) FROM sites s WHERE s.userId=u.id) AS sites,
           (SELECT COUNT(*) FROM devices d WHERE d.userId=u.id) AS devices,
           (SELECT COUNT(*) FROM device_status ds WHERE ds.userId=u.id AND ds.state='online') AS online,
           (SELECT COALESCE(SUM(ds.hashrateTHs),0) FROM device_status ds WHERE ds.userId=u.id) AS hashrate,
           (SELECT MAX(a.lastSeenAt) FROM agents a WHERE a.userId=u.id) AS lastSeen
         FROM users u ORDER BY u.createdAt DESC`,
      )
      .all() as AccountSummary[];
  }

  listAllAgents(): Array<{ id: string; userId: string; name: string; version: string | null; lastSeenAt: number | null }> {
    return this.db
      .prepare(`SELECT id,userId,name,version,lastSeenAt FROM agents ORDER BY lastSeenAt DESC`)
      .all() as ReturnType<ServerRepo["listAllAgents"]>;
  }

  setSuspended(userId: string, suspended: boolean): void {
    this.db.prepare(`UPDATE users SET suspended=? WHERE id=?`).run(suspended ? 1 : 0, userId);
  }

  setUserPassword(userId: string, passwordHash: string): void {
    this.db.prepare(`UPDATE users SET passwordHash=? WHERE id=?`).run(passwordHash, userId);
  }

  /** All devices joined with their owner email + current status — for fleet
   *  analytics and the global device search. */
  devicesForAdmin(): Array<{
    id: string;
    userId: string;
    email: string;
    name: string;
    model: string;
    firmware: string;
    host: string;
    state: string | null;
    hashrateTHs: number | null;
    maxTempC: number | null;
    pool: string | null;
    worker: string | null;
  }> {
    return this.db
      .prepare(
        `SELECT d.id, d.userId, u.email, d.name, d.model, d.firmware, d.host,
                s.state, s.hashrateTHs, s.maxTempC, s.pool, s.worker
         FROM devices d
         LEFT JOIN users u ON u.id = d.userId
         LEFT JOIN device_status s ON s.deviceId = d.id`,
      )
      .all() as ReturnType<ServerRepo["devicesForAdmin"]>;
  }

  recordMetric(at: number, hashrate: number, devices: number, online: number, users: number): void {
    this.db
      .prepare(`INSERT OR REPLACE INTO metrics_history(at,hashrate,devices,online,users) VALUES(?,?,?,?,?)`)
      .run(at, hashrate, devices, online, users);
    // Keep ~7 days of points.
    this.db.prepare(`DELETE FROM metrics_history WHERE at < ?`).run(at - 7 * 24 * 60 * 60 * 1000);
  }

  listHistory(sinceMs: number): Array<{ at: number; hashrate: number; devices: number; online: number; users: number }> {
    return this.db
      .prepare(`SELECT at,hashrate,devices,online,users FROM metrics_history WHERE at >= ? ORDER BY at ASC`)
      .all(sinceMs) as ReturnType<ServerRepo["listHistory"]>;
  }

  /** Delete a user and ALL their data (sites, devices, statuses, agents). */
  deleteUser(userId: string): void {
    const tx = this.db.transaction((uid: string) => {
      this.db.prepare(`DELETE FROM device_status WHERE userId=?`).run(uid);
      this.db.prepare(`DELETE FROM devices WHERE userId=?`).run(uid);
      this.db.prepare(`DELETE FROM sites WHERE userId=?`).run(uid);
      this.db.prepare(`DELETE FROM agents WHERE userId=?`).run(uid);
      this.db.prepare(`DELETE FROM users WHERE id=?`).run(uid);
    });
    tx(userId);
  }

  /** Returns true if the row was newly inserted or its name actually changed —
   *  lets the caller broadcast live only on a real change (not on an agent's
   *  identical re-register every reconnect). */
  upsertSite(s: SiteRow): boolean {
    const prev = this.db.prepare(`SELECT name FROM sites WHERE id=?`).get(s.id) as
      | { name: string }
      | undefined;
    this.db
      .prepare(
        `INSERT INTO sites(id,userId,name) VALUES(@id,@userId,@name)
         ON CONFLICT(id) DO UPDATE SET name=@name`,
      )
      .run(s);
    return !prev || prev.name !== s.name;
  }

  /** Returns true if the device was newly inserted or any field actually changed. */
  upsertDevice(d: DeviceRow): boolean {
    const prev = this.db
      .prepare(
        `SELECT siteId,agentId,name,model,firmware,host,apiPort,controlPort FROM devices WHERE id=?`,
      )
      .get(d.id) as
      | Pick<
          DeviceRow,
          "siteId" | "agentId" | "name" | "model" | "firmware" | "host" | "apiPort" | "controlPort"
        >
      | undefined;
    this.db
      .prepare(
        `INSERT INTO devices(id,userId,siteId,agentId,name,model,firmware,host,apiPort,controlPort)
         VALUES(@id,@userId,@siteId,@agentId,@name,@model,@firmware,@host,@apiPort,@controlPort)
         ON CONFLICT(id) DO UPDATE SET siteId=@siteId,agentId=@agentId,name=@name,model=@model,
           firmware=@firmware,host=@host,apiPort=@apiPort,controlPort=@controlPort`,
      )
      .run(d);
    return (
      !prev ||
      prev.siteId !== d.siteId ||
      prev.agentId !== d.agentId ||
      prev.name !== d.name ||
      prev.model !== d.model ||
      prev.firmware !== d.firmware ||
      prev.host !== d.host ||
      prev.apiPort !== d.apiPort ||
      prev.controlPort !== d.controlPort
    );
  }

  listSites(userId: string): Site[] {
    return this.db.prepare(`SELECT id,name FROM sites WHERE userId=?`).all(userId) as Site[];
  }

  listDevices(userId: string): Device[] {
    return this.db
      .prepare(
        `SELECT id,siteId,name,model,firmware,host,apiPort,controlPort FROM devices WHERE userId=?`,
      )
      .all(userId) as Device[];
  }

  deleteDevice(userId: string, id: string): void {
    this.db.prepare(`DELETE FROM devices WHERE userId=? AND id=?`).run(userId, id);
    this.db.prepare(`DELETE FROM device_status WHERE userId=? AND deviceId=?`).run(userId, id);
  }

  deleteSite(userId: string, siteId: string): void {
    const ids = this.db
      .prepare(`SELECT id FROM devices WHERE userId=? AND siteId=?`)
      .all(userId, siteId) as Array<{ id: string }>;
    for (const { id } of ids) this.deleteDevice(userId, id);
    this.db.prepare(`DELETE FROM sites WHERE userId=? AND id=?`).run(userId, siteId);
  }

  deviceAgent(userId: string, deviceId: string): string | null {
    const r = this.db.prepare(`SELECT agentId FROM devices WHERE userId=? AND id=?`).get(userId, deviceId) as
      | { agentId: string }
      | undefined;
    return r?.agentId ?? null;
  }

  /** Owner (user + agent) of a device, regardless of account — for admin remote
   *  control across all customers. */
  deviceOwner(deviceId: string): { userId: string; agentId: string } | null {
    const r = this.db.prepare(`SELECT userId, agentId FROM devices WHERE id=?`).get(deviceId) as
      | { userId: string; agentId: string }
      | undefined;
    return r ?? null;
  }

  /** All of a user's devices with their owning agent — for account-wide actions
   *  (kill switch). */
  devicesWithAgent(userId: string): Array<{ id: string; agentId: string }> {
    return this.db
      .prepare(`SELECT id, agentId FROM devices WHERE userId=?`)
      .all(userId) as Array<{ id: string; agentId: string }>;
  }

  /** Devices to consider for a firmware flash: one device, one account, or ALL.
   *  Returns the fields the flash targeter needs (agent, model, firmware). */
  flashTargets(scope: { deviceId?: string; userId?: string }): Array<{
    id: string;
    userId: string;
    agentId: string;
    model: string;
    firmware: string;
  }> {
    const cols = `id, userId, agentId, model, firmware`;
    if (scope.deviceId)
      return this.db.prepare(`SELECT ${cols} FROM devices WHERE id=?`).all(scope.deviceId) as never;
    if (scope.userId)
      return this.db.prepare(`SELECT ${cols} FROM devices WHERE userId=?`).all(scope.userId) as never;
    return this.db.prepare(`SELECT ${cols} FROM devices`).all() as never;
  }

  // —— Firmware flash jobs (admin firmware push; the server sequences one per device) ——
  createFlashJobs(
    rows: Array<{
      jobId: string;
      batchId: string;
      userId: string;
      deviceId: string;
      agentId: string;
      firmwareId: string;
    }>,
  ): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      `INSERT INTO flash_jobs(jobId,batchId,userId,deviceId,agentId,firmwareId,state,createdAt,updatedAt)
       VALUES(@jobId,@batchId,@userId,@deviceId,@agentId,@firmwareId,'queued',@now,@now)`,
    );
    this.db.transaction((rs: typeof rows) => {
      for (const r of rs) stmt.run({ ...r, now });
    })(rows);
  }

  listFlashJobs(batchId: string): FlashJobRow[] {
    return this.db
      .prepare(`SELECT * FROM flash_jobs WHERE batchId=? ORDER BY createdAt ASC`)
      .all(batchId) as FlashJobRow[];
  }

  getFlashJob(jobId: string): FlashJobRow | undefined {
    return this.db.prepare(`SELECT * FROM flash_jobs WHERE jobId=?`).get(jobId) as
      | FlashJobRow
      | undefined;
  }

  /** The next still-queued job in a batch (the server flashes strictly one at a time). */
  nextQueuedJob(batchId: string): FlashJobRow | undefined {
    return this.db
      .prepare(`SELECT * FROM flash_jobs WHERE batchId=? AND state='queued' ORDER BY createdAt ASC LIMIT 1`)
      .get(batchId) as FlashJobRow | undefined;
  }

  setFlashState(jobId: string, state: string, fields?: { error?: string; newVersion?: string }): void {
    this.db
      .prepare(
        `UPDATE flash_jobs SET state=?, error=COALESCE(?,error), newVersion=COALESCE(?,newVersion), updatedAt=? WHERE jobId=?`,
      )
      .run(state, fields?.error ?? null, fields?.newVersion ?? null, Date.now(), jobId);
  }

  /** STOP-on-failure: cancel every still-queued device in a batch (blast-radius cap). */
  stopQueuedJobs(batchId: string): void {
    this.db
      .prepare(`UPDATE flash_jobs SET state='stopped', updatedAt=? WHERE batchId=? AND state='queued'`)
      .run(Date.now(), batchId);
  }

  upsertStatus(userId: string, s: DeviceStatus): void {
    // Strip nested fields (e.g. health) that aren't DB columns — they still ride
    // along in the live broadcast, just not persisted.
    const { health: _health, ...flat } = s;
    void _health;
    this.db
      .prepare(
        `INSERT INTO device_status(deviceId,userId,state,hashrateTHs,avgHashrateTHs,maxTempC,fanRpm,pool,worker,hwErrorRate,uptimeSec,lastSeen)
         VALUES(@deviceId,@userId,@state,@hashrateTHs,@avgHashrateTHs,@maxTempC,@fanRpm,@pool,@worker,@hwErrorRate,@uptimeSec,@lastSeen)
         ON CONFLICT(deviceId) DO UPDATE SET state=@state,hashrateTHs=@hashrateTHs,avgHashrateTHs=@avgHashrateTHs,
           maxTempC=@maxTempC,fanRpm=@fanRpm,pool=@pool,worker=@worker,hwErrorRate=@hwErrorRate,uptimeSec=@uptimeSec,lastSeen=@lastSeen`,
      )
      .run({ ...flat, userId });
  }

  listStatuses(userId: string): DeviceStatus[] {
    return this.db
      .prepare(
        `SELECT deviceId,state,hashrateTHs,avgHashrateTHs,maxTempC,fanRpm,pool,worker,hwErrorRate,uptimeSec,lastSeen FROM device_status WHERE userId=?`,
      )
      .all(userId) as DeviceStatus[];
  }

  touchAgent(id: string, userId: string, name: string, version?: string): void {
    this.db
      .prepare(
        `INSERT INTO agents(id,userId,name,version,lastSeenAt) VALUES(?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,version=excluded.version,lastSeenAt=excluded.lastSeenAt`,
      )
      .run(id, userId, name, version ?? null, Date.now());
  }
}
