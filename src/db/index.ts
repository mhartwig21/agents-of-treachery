/**
 * Database module - SQLite persistence layer.
 */

export { getDb, openDb, closeDb } from './connection';
export { migrate, getCurrentVersion, migrations } from './migrations';
export type { Migration } from './migrations';
