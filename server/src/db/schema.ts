import type Database from "better-sqlite3";

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, passwordHash TEXT NOT NULL, createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL, lastSeenAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, siteId TEXT NOT NULL, agentId TEXT NOT NULL,
      name TEXT NOT NULL, model TEXT NOT NULL, firmware TEXT NOT NULL, host TEXT NOT NULL,
      apiPort INTEGER NOT NULL, controlPort INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS device_status (
      deviceId TEXT PRIMARY KEY, userId TEXT NOT NULL, state TEXT, hashrateTHs REAL, avgHashrateTHs REAL,
      maxTempC REAL, fanRpm REAL, pool TEXT, worker TEXT, hwErrorRate REAL, uptimeSec INTEGER, lastSeen INTEGER
    );
  `);
}
