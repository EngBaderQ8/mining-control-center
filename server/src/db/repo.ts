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
      .prepare(`SELECT id,email,passwordHash,createdAt FROM users WHERE email=?`)
      .get(email) as UserRow | undefined;
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
