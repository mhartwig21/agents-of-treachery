/**
 * Tests for SQLite database connection, schema, and migration system.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'fs';
import path from 'path';
import { openDb, closeDb } from '../connection';
import { migrate, getCurrentVersion, migrations } from '../migrations';

const TEST_DB_DIR = '/tmp/aot-test-db';
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

function cleanTestDir(): void {
  if (existsSync(TEST_DB_DIR)) {
    rmSync(TEST_DB_DIR, { recursive: true, force: true });
  }
}

describe('Database connection', () => {
  beforeEach(() => {
    cleanTestDir();
  });

  afterEach(() => {
    closeDb();
    cleanTestDir();
  });

  it('should create the data directory if it does not exist', () => {
    expect(existsSync(TEST_DB_DIR)).toBe(false);
    openDb(TEST_DB_PATH);
    expect(existsSync(TEST_DB_DIR)).toBe(true);
  });

  it('should open a database file', () => {
    const db = openDb(TEST_DB_PATH);
    expect(db).toBeDefined();
    expect(existsSync(TEST_DB_PATH)).toBe(true);
  });

  it('should enable WAL journal mode', () => {
    const db = openDb(TEST_DB_PATH);
    const result = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    expect(result[0].journal_mode).toBe('wal');
  });

  it('should enable foreign keys', () => {
    const db = openDb(TEST_DB_PATH);
    const result = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
    expect(result[0].foreign_keys).toBe(1);
  });

  it('should close and reopen cleanly', () => {
    const db1 = openDb(TEST_DB_PATH);
    db1.exec('CREATE TABLE test_close (id INTEGER PRIMARY KEY)');
    db1.exec('INSERT INTO test_close VALUES (1)');
    closeDb();

    const db2 = openDb(TEST_DB_PATH);
    const row = db2.prepare('SELECT id FROM test_close').get() as { id: number };
    expect(row.id).toBe(1);
  });
});

describe('Migrations', () => {
  beforeEach(() => {
    cleanTestDir();
  });

  afterEach(() => {
    closeDb();
    cleanTestDir();
  });

  it('should report version 0 on a fresh database', () => {
    const db = openDb(TEST_DB_PATH);
    expect(getCurrentVersion(db)).toBe(0);
  });

  it('should apply all migrations', () => {
    const db = openDb(TEST_DB_PATH);
    const applied = migrate(db);
    expect(applied).toBe(migrations.length);
    expect(getCurrentVersion(db)).toBe(migrations.length);
  });

  it('should be idempotent (no-op on second run)', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);
    const applied = migrate(db);
    expect(applied).toBe(0);
  });

  it('should create the games table', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='games'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
  });

  it('should create the game_powers table', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='game_powers'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
  });

  it('should create the snapshots table', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='snapshots'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
  });

  it('should create the messages table', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'")
      .all() as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
  });

  it('should record applied migrations in schema_migrations', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);
    const rows = db
      .prepare('SELECT version, name FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number; name: string }>;
    expect(rows).toHaveLength(migrations.length);
    expect(rows[0].version).toBe(1);
    expect(rows[0].name).toBe('initial_schema');
  });
});

describe('Schema constraints', () => {
  beforeEach(() => {
    cleanTestDir();
  });

  afterEach(() => {
    closeDb();
    cleanTestDir();
  });

  it('should enforce games status check constraint', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    // Valid statuses should work
    db.prepare("INSERT INTO games (id, name, status) VALUES ('g1', 'Test', 'active')").run();
    db.prepare("INSERT INTO games (id, name, status) VALUES ('g2', 'Test2', 'completed')").run();
    db.prepare("INSERT INTO games (id, name, status) VALUES ('g3', 'Test3', 'paused')").run();

    // Invalid status should fail
    expect(() =>
      db.prepare("INSERT INTO games (id, name, status) VALUES ('g4', 'Test4', 'invalid')").run()
    ).toThrow();
  });

  it('should enforce games result_type check constraint', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    db.prepare(
      "INSERT INTO games (id, name, result_type) VALUES ('g1', 'Test', 'win')"
    ).run();
    db.prepare(
      "INSERT INTO games (id, name, result_type) VALUES ('g2', 'Test2', 'draw')"
    ).run();
    db.prepare(
      "INSERT INTO games (id, name, result_type) VALUES ('g3', 'Test3', NULL)"
    ).run();

    expect(() =>
      db.prepare(
        "INSERT INTO games (id, name, result_type) VALUES ('g4', 'Test4', 'loss')"
      ).run()
    ).toThrow();
  });

  it('should enforce game_powers foreign key to games', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    expect(() =>
      db
        .prepare(
          "INSERT INTO game_powers (game_id, power) VALUES ('nonexistent', 'ENGLAND')"
        )
        .run()
    ).toThrow();
  });

  it('should cascade delete game_powers when game is deleted', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    db.prepare("INSERT INTO games (id, name) VALUES ('g1', 'Test')").run();
    db.prepare("INSERT INTO game_powers (game_id, power) VALUES ('g1', 'ENGLAND')").run();
    db.prepare("INSERT INTO game_powers (game_id, power) VALUES ('g1', 'FRANCE')").run();

    db.prepare("DELETE FROM games WHERE id = 'g1'").run();
    const rows = db.prepare("SELECT * FROM game_powers WHERE game_id = 'g1'").all();
    expect(rows).toHaveLength(0);
  });

  it('should cascade delete snapshots when game is deleted', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    db.prepare("INSERT INTO games (id, name) VALUES ('g1', 'Test')").run();
    db.prepare(
      "INSERT INTO snapshots (game_id, snapshot_id, year, season, phase, data) VALUES ('g1', 'S1901-SPRING-DIPLOMACY', 1901, 'SPRING', 'DIPLOMACY', '{}')"
    ).run();

    db.prepare("DELETE FROM games WHERE id = 'g1'").run();
    const rows = db.prepare("SELECT * FROM snapshots WHERE game_id = 'g1'").all();
    expect(rows).toHaveLength(0);
  });

  it('should cascade delete messages when game is deleted', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    db.prepare("INSERT INTO games (id, name) VALUES ('g1', 'Test')").run();
    db.prepare(
      "INSERT INTO messages (game_id, message_id, sender, recipients, channel, year, season, phase, content) VALUES ('g1', 'm1', 'ENGLAND', 'FRANCE', 'bilateral:ENGLAND:FRANCE', 1901, 'SPRING', 'DIPLOMACY', 'Hello')"
    ).run();

    db.prepare("DELETE FROM games WHERE id = 'g1'").run();
    const rows = db.prepare("SELECT * FROM messages WHERE game_id = 'g1'").all();
    expect(rows).toHaveLength(0);
  });

  it('should enforce unique snapshot_id per game', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    db.prepare("INSERT INTO games (id, name) VALUES ('g1', 'Test')").run();
    db.prepare(
      "INSERT INTO snapshots (game_id, snapshot_id, year, season, phase, data) VALUES ('g1', 'S1901-SPRING-DIPLOMACY', 1901, 'SPRING', 'DIPLOMACY', '{}')"
    ).run();

    expect(() =>
      db
        .prepare(
          "INSERT INTO snapshots (game_id, snapshot_id, year, season, phase, data) VALUES ('g1', 'S1901-SPRING-DIPLOMACY', 1901, 'SPRING', 'DIPLOMACY', '{}')"
        )
        .run()
    ).toThrow();
  });

  it('should enforce unique message_id per game', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    db.prepare("INSERT INTO games (id, name) VALUES ('g1', 'Test')").run();
    db.prepare(
      "INSERT INTO messages (game_id, message_id, sender, recipients, channel, year, season, phase, content) VALUES ('g1', 'm1', 'ENGLAND', 'FRANCE', 'bilateral:ENGLAND:FRANCE', 1901, 'SPRING', 'DIPLOMACY', 'Hello')"
    ).run();

    expect(() =>
      db
        .prepare(
          "INSERT INTO messages (game_id, message_id, sender, recipients, channel, year, season, phase, content) VALUES ('g1', 'm1', 'FRANCE', 'ENGLAND', 'bilateral:ENGLAND:FRANCE', 1901, 'SPRING', 'DIPLOMACY', 'Hi')"
        )
        .run()
    ).toThrow();
  });

  it('should enforce game_powers composite primary key', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    db.prepare("INSERT INTO games (id, name) VALUES ('g1', 'Test')").run();
    db.prepare("INSERT INTO game_powers (game_id, power) VALUES ('g1', 'ENGLAND')").run();

    expect(() =>
      db.prepare("INSERT INTO game_powers (game_id, power) VALUES ('g1', 'ENGLAND')").run()
    ).toThrow();
  });
});

describe('Schema indexes', () => {
  beforeEach(() => {
    cleanTestDir();
  });

  afterEach(() => {
    closeDb();
    cleanTestDir();
  });

  it('should create expected indexes', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as Array<{ name: string }>;

    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain('idx_snapshots_game');
    expect(indexNames).toContain('idx_snapshots_game_year');
    expect(indexNames).toContain('idx_messages_game');
    expect(indexNames).toContain('idx_messages_game_phase');
    expect(indexNames).toContain('idx_messages_sender');
    expect(indexNames).toContain('idx_messages_channel');
    expect(indexNames).toContain('idx_games_status');
  });
});

describe('CRUD operations', () => {
  beforeEach(() => {
    cleanTestDir();
  });

  afterEach(() => {
    closeDb();
    cleanTestDir();
  });

  it('should insert and query a full game with powers, snapshots, and messages', () => {
    const db = openDb(TEST_DB_PATH);
    migrate(db);

    // Insert game
    db.prepare(
      "INSERT INTO games (id, name, status, year_reached, turn_count) VALUES ('game-1', 'Test Game', 'active', 1901, 2)"
    ).run();

    // Insert powers
    const insertPower = db.prepare(
      'INSERT INTO game_powers (game_id, power, model_id, model_display_name) VALUES (?, ?, ?, ?)'
    );
    insertPower.run('game-1', 'ENGLAND', 'claude-3-haiku', 'Claude 3 Haiku');
    insertPower.run('game-1', 'FRANCE', 'gpt-4o-mini', 'GPT-4o Mini');

    // Insert snapshot
    db.prepare(
      "INSERT INTO snapshots (game_id, snapshot_id, year, season, phase, data) VALUES ('game-1', '1901-SPRING-DIPLOMACY', 1901, 'SPRING', 'DIPLOMACY', ?)"
    ).run(JSON.stringify({ units: [], supplyCenters: {} }));

    // Insert message
    db.prepare(
      "INSERT INTO messages (game_id, message_id, sender, recipients, channel, year, season, phase, content) VALUES ('game-1', 'msg-1', 'ENGLAND', 'FRANCE', 'bilateral:ENGLAND:FRANCE', 1901, 'SPRING', 'DIPLOMACY', 'Shall we coordinate?')"
    ).run();

    // Query game
    const game = db.prepare("SELECT * FROM games WHERE id = 'game-1'").get() as Record<
      string,
      unknown
    >;
    expect(game.name).toBe('Test Game');
    expect(game.status).toBe('active');

    // Query powers
    const powers = db
      .prepare("SELECT * FROM game_powers WHERE game_id = 'game-1' ORDER BY power")
      .all() as Array<Record<string, unknown>>;
    expect(powers).toHaveLength(2);
    expect(powers[0].power).toBe('ENGLAND');
    expect(powers[1].power).toBe('FRANCE');

    // Query snapshots
    const snapshots = db
      .prepare("SELECT * FROM snapshots WHERE game_id = 'game-1'")
      .all() as Array<Record<string, unknown>>;
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].snapshot_id).toBe('1901-SPRING-DIPLOMACY');
    const data = JSON.parse(snapshots[0].data as string);
    expect(data.units).toEqual([]);

    // Query messages
    const messages = db
      .prepare("SELECT * FROM messages WHERE game_id = 'game-1'")
      .all() as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0].sender).toBe('ENGLAND');
    expect(messages[0].content).toBe('Shall we coordinate?');
  });
});
