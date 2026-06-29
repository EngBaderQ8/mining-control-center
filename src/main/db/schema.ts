import type Database from "better-sqlite3";

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      siteId TEXT NOT NULL,
      name TEXT NOT NULL,
      model TEXT NOT NULL,
      firmware TEXT NOT NULL,
      host TEXT NOT NULL,
      apiPort INTEGER NOT NULL,
      controlPort INTEGER NOT NULL,
      secretEnc BLOB
    );
  `);
}
