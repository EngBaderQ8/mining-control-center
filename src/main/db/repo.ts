import type Database from "better-sqlite3";
import type { Device, Site } from "../../core/model/device";

export class DeviceRepo {
  constructor(private db: Database.Database) {}

  upsertSite(s: Site): void {
    this.db
      .prepare(
        `INSERT INTO sites(id,name) VALUES(@id,@name)
         ON CONFLICT(id) DO UPDATE SET name=@name`,
      )
      .run(s);
  }

  upsertDevice(d: Device): void {
    this.db
      .prepare(
        `INSERT INTO devices(id,siteId,name,model,firmware,host,apiPort,controlPort)
         VALUES(@id,@siteId,@name,@model,@firmware,@host,@apiPort,@controlPort)
         ON CONFLICT(id) DO UPDATE SET
           siteId=@siteId, name=@name, model=@model, firmware=@firmware,
           host=@host, apiPort=@apiPort, controlPort=@controlPort`,
      )
      .run(d);
  }

  listSites(): Site[] {
    return this.db.prepare(`SELECT id,name FROM sites`).all() as Site[];
  }

  listDevices(): Device[] {
    return this.db
      .prepare(
        `SELECT id,siteId,name,model,firmware,host,apiPort,controlPort FROM devices`,
      )
      .all() as Device[];
  }

  deleteDevice(id: string): void {
    this.db.prepare(`DELETE FROM devices WHERE id=?`).run(id);
  }

  setSecret(deviceId: string, enc: Buffer): void {
    this.db.prepare(`UPDATE devices SET secretEnc=? WHERE id=?`).run(enc, deviceId);
  }

  getSecret(deviceId: string): Buffer | null {
    const row = this.db.prepare(`SELECT secretEnc FROM devices WHERE id=?`).get(deviceId) as
      | { secretEnc: Buffer | null }
      | undefined;
    return row?.secretEnc ?? null;
  }
}
