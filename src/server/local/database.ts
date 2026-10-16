import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
export interface LocalStore { db: DatabaseSync; dataDir: string; close(): void }
export function openLocalStore(directory: string): LocalStore {
  const dataDir = resolve(directory);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, 'assistant.sqlite');
  const db = new DatabaseSync(path);
  chmodSync(path, 0o600);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
      type TEXT NOT NULL, status TEXT NOT NULL, connection_id TEXT, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS operations_time ON operations(started_at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS transfers (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
    PRAGMA user_version = 1;
  `);
  let closed = false;
  return { db, dataDir, close() { if (!closed) { db.close(); closed = true; } } };
}
