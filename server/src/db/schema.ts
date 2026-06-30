import type Database from "better-sqlite3";

export function applySchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL COLLATE NOCASE, passwordHash TEXT NOT NULL, createdAt INTEGER NOT NULL
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
  // Migration: add the admin `suspended` flag to existing user tables.
  const cols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "suspended")) {
    db.exec(`ALTER TABLE users ADD COLUMN suspended INTEGER NOT NULL DEFAULT 0`);
  }
}
