/**
 * SQLite schema migration system.
 *
 * Migrations are numbered sequentially and tracked in a `schema_migrations` table.
 * Each migration runs inside a transaction. Once applied, a migration is never re-run.
 */

import type Database from 'better-sqlite3';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

/**
 * All migrations in order. Append new migrations to the end.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: `
      CREATE TABLE games (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        ended_at TEXT,
        year_reached INTEGER,
        turn_count INTEGER DEFAULT 0,
        result_type TEXT CHECK (result_type IS NULL OR result_type IN ('win', 'draw')),
        winner_power TEXT
      );

      CREATE TABLE game_powers (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        power TEXT NOT NULL,
        model_id TEXT,
        model_display_name TEXT,
        PRIMARY KEY (game_id, power)
      );

      CREATE TABLE snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        snapshot_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        season TEXT NOT NULL,
        phase TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        data TEXT NOT NULL,
        UNIQUE (game_id, snapshot_id)
      );

      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        message_id TEXT NOT NULL,
        sender TEXT NOT NULL,
        recipients TEXT NOT NULL,
        channel TEXT NOT NULL,
        year INTEGER NOT NULL,
        season TEXT NOT NULL,
        phase TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (game_id, message_id)
      );

      CREATE INDEX idx_snapshots_game ON snapshots(game_id);
      CREATE INDEX idx_snapshots_game_year ON snapshots(game_id, year, season);
      CREATE INDEX idx_messages_game ON messages(game_id);
      CREATE INDEX idx_messages_game_phase ON messages(game_id, year, season, phase);
      CREATE INDEX idx_messages_sender ON messages(game_id, sender);
      CREATE INDEX idx_messages_channel ON messages(game_id, channel);
      CREATE INDEX idx_games_status ON games(status);
    `,
  },
];

/**
 * Ensure the schema_migrations tracking table exists.
 */
function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * Get the current schema version (highest applied migration).
 */
export function getCurrentVersion(db: Database.Database): number {
  ensureMigrationsTable(db);
  const row = db.prepare('SELECT MAX(version) as version FROM schema_migrations').get() as
    | { version: number | null }
    | undefined;
  return row?.version ?? 0;
}

/**
 * Run all pending migrations. Each migration runs in its own transaction.
 * Returns the number of migrations applied.
 */
export function migrate(db: Database.Database): number {
  ensureMigrationsTable(db);

  const currentVersion = getCurrentVersion(db);
  const pending = migrations.filter((m) => m.version > currentVersion);

  if (pending.length === 0) return 0;

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name) VALUES (?, ?)'
  );

  for (const migration of pending) {
    const run = db.transaction(() => {
      db.exec(migration.up);
      insertMigration.run(migration.version, migration.name);
    });
    run();
  }

  return pending.length;
}
