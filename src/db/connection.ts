/**
 * SQLite database connection management.
 *
 * Provides a singleton database connection with WAL mode for concurrent reads,
 * and ensures the data directory exists before opening.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'aot.db');

let _db: Database.Database | null = null;

/**
 * Get or create the singleton database connection.
 * Creates the data directory if it doesn't exist.
 */
export function getDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  if (_db) return _db;
  return openDb(dbPath);
}

/**
 * Open a new database connection (closes existing if any).
 * Primarily useful for tests that need a fresh connection.
 */
export function openDb(dbPath: string = DEFAULT_DB_PATH): Database.Database {
  closeDb();

  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  _db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  _db.pragma('journal_mode = WAL');
  // Enable foreign keys
  _db.pragma('foreign_keys = ON');

  return _db;
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
