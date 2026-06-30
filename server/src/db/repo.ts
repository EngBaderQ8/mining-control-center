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

  listAllAgents(): Array<{ id: string; userId: string; name: string; lastSeenAt: number | null }> {
    return this.db
      .prepare(`SELECT id,userId,name,lastSeenAt FROM agents ORDER BY lastSeenAt DESC`)
      .all() as Array<{ id: string; userId: string; name: string; lastSeenAt: number | null }>;
  }

  setSuspended(userId: string, suspended: boolean): void {
    this.db.prepare(`UPDATE users SET suspended=? WHERE id=?`).run(suspended ? 1 : 0, userId);
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

  upsertSite(s: SiteRow): void {
    this.db
      .prepare(
        `INSERT INTO sites(id,userId,name) VALUES(@id,@userId,@name)
         ON CONFLICT(id) DO UPDATE SET name=@name`,
      )
      .run(s);
  }

  upsertDevice(d: DeviceRow): void {
    this.db
      .prepare(
        `INSERT INTO devices(id,userId,siteId,agentId,name,model,firmware,host,apiPort,controlPort)
         VALUES(@id,@userId,@siteId,@agentId,@name,@model,@firmware,@host,@apiPort,@controlPort)
         ON CONFLICT(id) DO UPDATE SET siteId=@siteId,agentId=@agentId,name=@name,model=@model,
           firmware=@firmware,host=@host,apiPort=@apiPort,controlPort=@controlPort`,
      )
      .run(d);
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

  touchAgent(id: string, userId: string, name: string): void {
    this.db
      .prepare(
        `INSERT INTO agents(id,userId,name,lastSeenAt) VALUES(?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name,lastSeenAt=excluded.lastSeenAt`,
      )
      .run(id, userId, name, Date.now());
  }
}
