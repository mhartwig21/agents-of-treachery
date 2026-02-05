/**
 * Audit Log - Tamper-evident logging for secrets access.
 *
 * Provides a hash-chained, append-only log for tracking all secrets
 * read/write/delete operations. Each entry contains a cryptographic hash
 * of its content plus the previous entry's hash, creating a verifiable chain.
 */

import { createHash, randomUUID } from 'crypto';
import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import { join, dirname } from 'path';

/**
 * Actions that can be performed on secrets.
 */
export type AuditAction = 'read' | 'write' | 'delete' | 'list';

/**
 * Actor performing the action - either a user or a service.
 */
export type AuditActor = `user:${string}` | `service:${string}`;

/**
 * A single audit log entry with hash chain.
 */
export interface AuditEntry {
  /** Unique identifier for this entry */
  id: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Who performed the action */
  actor: AuditActor;
  /** What action was performed */
  action: AuditAction;
  /** The secret key (never the value!) */
  secretKey: string;
  /** Environment (e.g., 'prod', 'staging', 'dev') */
  environment: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if success is false */
  error?: string;
  /** Hash of the previous entry (empty string for first entry) */
  previousHash: string;
  /** SHA-256 hash of this entry's content + previousHash */
  hash: string;
}

/**
 * Filter criteria for querying audit entries.
 */
export interface AuditFilter {
  /** Filter by actor */
  actor?: AuditActor;
  /** Filter by action type */
  action?: AuditAction;
  /** Filter by secret key (exact match) */
  secretKey?: string;
  /** Filter by secret key prefix */
  secretKeyPrefix?: string;
  /** Filter by environment */
  environment?: string;
  /** Filter by success/failure */
  success?: boolean;
  /** Filter by time range - start (inclusive) */
  startTime?: Date;
  /** Filter by time range - end (inclusive) */
  endTime?: Date;
  /** Maximum number of entries to return */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/**
 * Result of hash chain verification.
 */
export interface VerifyResult {
  /** Whether the entire chain is valid */
  valid: boolean;
  /** Total entries verified */
  entriesVerified: number;
  /** Index of first broken entry (0-based) if chain is invalid */
  brokenAt?: number;
  /** Description of the verification failure */
  error?: string;
}

/**
 * Configuration for the audit log.
 */
export interface AuditLogConfig {
  /** Directory to store audit logs */
  logsDir?: string;
  /** Retention period in days (0 = no automatic cleanup) */
  retentionDays?: number;
  /** Whether the log is enabled */
  enabled?: boolean;
}

/**
 * Interface for audit logging operations.
 */
export interface AuditLog {
  /** Log an audit entry */
  log(entry: Omit<AuditEntry, 'id' | 'timestamp' | 'previousHash' | 'hash'>): Promise<void>;
  /** Query audit entries with filters */
  query(filter: AuditFilter): Promise<AuditEntry[]>;
  /** Verify the integrity of the hash chain */
  verify(): Promise<VerifyResult>;
}

/**
 * Computes SHA-256 hash of audit entry content.
 */
function computeHash(
  entry: Omit<AuditEntry, 'hash'>,
  previousHash: string
): string {
  const content = JSON.stringify({
    id: entry.id,
    timestamp: entry.timestamp,
    actor: entry.actor,
    action: entry.action,
    secretKey: entry.secretKey,
    environment: entry.environment,
    success: entry.success,
    error: entry.error,
    previousHash,
  });
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

/**
 * File-based audit log implementation with hash chaining.
 */
export class FileAuditLog implements AuditLog {
  private logPath: string;
  private enabled: boolean;
  private retentionDays: number;
  private lastHash: string = '';

  constructor(config: AuditLogConfig = {}) {
    const baseDir = config.logsDir || join(process.cwd(), 'logs', 'audit');
    this.logPath = join(baseDir, 'secrets-audit.jsonl');
    this.enabled = config.enabled !== false;
    this.retentionDays = config.retentionDays ?? 0;

    // Ensure logs directory exists
    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Load last hash from existing log
    this.loadLastHash();
  }

  /**
   * Loads the hash of the last entry from the log file.
   */
  private loadLastHash(): void {
    if (!existsSync(this.logPath)) {
      this.lastHash = '';
      return;
    }

    try {
      const content = readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      if (lines.length > 0) {
        const lastEntry = JSON.parse(lines[lines.length - 1]) as AuditEntry;
        this.lastHash = lastEntry.hash;
      }
    } catch {
      this.lastHash = '';
    }
  }

  /**
   * Logs an audit entry with automatic hash chaining.
   */
  async log(
    entry: Omit<AuditEntry, 'id' | 'timestamp' | 'previousHash' | 'hash'>
  ): Promise<void> {
    if (!this.enabled) return;

    const id = randomUUID();
    const timestamp = new Date().toISOString();
    const previousHash = this.lastHash;

    const fullEntry: Omit<AuditEntry, 'hash'> = {
      id,
      timestamp,
      ...entry,
      previousHash,
    };

    const hash = computeHash(fullEntry, previousHash);

    const auditEntry: AuditEntry = {
      ...fullEntry,
      hash,
    };

    try {
      appendFileSync(this.logPath, JSON.stringify(auditEntry) + '\n');
      this.lastHash = hash;
    } catch (error) {
      console.error(`[AuditLog] Failed to write audit entry: ${error}`);
      throw error;
    }
  }

  /**
   * Queries audit entries with optional filters.
   */
  async query(filter: AuditFilter = {}): Promise<AuditEntry[]> {
    const entries = this.readAllEntries();
    let filtered = entries;

    // Apply filters
    if (filter.actor) {
      filtered = filtered.filter(e => e.actor === filter.actor);
    }
    if (filter.action) {
      filtered = filtered.filter(e => e.action === filter.action);
    }
    if (filter.secretKey) {
      filtered = filtered.filter(e => e.secretKey === filter.secretKey);
    }
    if (filter.secretKeyPrefix) {
      filtered = filtered.filter(e =>
        e.secretKey.startsWith(filter.secretKeyPrefix!)
      );
    }
    if (filter.environment) {
      filtered = filtered.filter(e => e.environment === filter.environment);
    }
    if (filter.success !== undefined) {
      filtered = filtered.filter(e => e.success === filter.success);
    }
    if (filter.startTime) {
      const startMs = filter.startTime.getTime();
      filtered = filtered.filter(
        e => new Date(e.timestamp).getTime() >= startMs
      );
    }
    if (filter.endTime) {
      const endMs = filter.endTime.getTime();
      filtered = filtered.filter(e => new Date(e.timestamp).getTime() <= endMs);
    }

    // Apply pagination
    if (filter.offset) {
      filtered = filtered.slice(filter.offset);
    }
    if (filter.limit) {
      filtered = filtered.slice(0, filter.limit);
    }

    return filtered;
  }

  /**
   * Verifies the integrity of the hash chain.
   */
  async verify(): Promise<VerifyResult> {
    const entries = this.readAllEntries();

    if (entries.length === 0) {
      return { valid: true, entriesVerified: 0 };
    }

    let previousHash = '';

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];

      // Check that previousHash matches
      if (entry.previousHash !== previousHash) {
        return {
          valid: false,
          entriesVerified: i,
          brokenAt: i,
          error: `Entry ${i} has incorrect previousHash: expected "${previousHash}", got "${entry.previousHash}"`,
        };
      }

      // Verify the hash
      const expectedHash = computeHash(entry, previousHash);
      if (entry.hash !== expectedHash) {
        return {
          valid: false,
          entriesVerified: i,
          brokenAt: i,
          error: `Entry ${i} has incorrect hash: expected "${expectedHash}", got "${entry.hash}"`,
        };
      }

      previousHash = entry.hash;
    }

    return { valid: true, entriesVerified: entries.length };
  }

  /**
   * Reads all entries from the log file.
   */
  private readAllEntries(): AuditEntry[] {
    if (!existsSync(this.logPath)) {
      return [];
    }

    try {
      const content = readFileSync(this.logPath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      return lines.map(line => JSON.parse(line) as AuditEntry);
    } catch {
      return [];
    }
  }

  /**
   * Gets the path to the audit log file.
   */
  getLogPath(): string {
    return this.logPath;
  }

  /**
   * Enables the audit log.
   */
  enable(): void {
    this.enabled = true;
  }

  /**
   * Disables the audit log.
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Checks if the audit log is enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Applies retention policy, removing entries older than retentionDays.
   * This creates a new log file and updates the hash chain.
   */
  async applyRetention(): Promise<{ removed: number; remaining: number }> {
    if (this.retentionDays <= 0) {
      return { removed: 0, remaining: this.readAllEntries().length };
    }

    const entries = this.readAllEntries();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - this.retentionDays);
    const cutoffMs = cutoff.getTime();

    const toKeep = entries.filter(
      e => new Date(e.timestamp).getTime() >= cutoffMs
    );

    if (toKeep.length === entries.length) {
      return { removed: 0, remaining: entries.length };
    }

    // Rebuild the hash chain for retained entries
    const newEntries: AuditEntry[] = [];
    let previousHash = '';

    for (const entry of toKeep) {
      const newEntry: Omit<AuditEntry, 'hash'> = {
        ...entry,
        previousHash,
      };
      const hash = computeHash(newEntry, previousHash);
      newEntries.push({ ...newEntry, hash });
      previousHash = hash;
    }

    // Write the new log file
    const newContent = newEntries.map(e => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(this.logPath, newContent);
    this.lastHash = previousHash;

    return {
      removed: entries.length - toKeep.length,
      remaining: toKeep.length,
    };
  }
}

/**
 * Global audit log instance.
 */
let globalAuditLog: FileAuditLog | null = null;

/**
 * Gets the global audit log instance, creating it if necessary.
 */
export function getAuditLog(config?: AuditLogConfig): FileAuditLog {
  if (!globalAuditLog) {
    globalAuditLog = new FileAuditLog(config);
  }
  return globalAuditLog;
}

/**
 * Resets the global audit log instance (useful for testing).
 */
export function resetAuditLog(): void {
  globalAuditLog = null;
}

/**
 * Helper function to log a secrets read operation.
 */
export async function logSecretsRead(
  actor: AuditActor,
  secretKey: string,
  environment: string,
  success: boolean,
  error?: string
): Promise<void> {
  const log = getAuditLog();
  await log.log({
    actor,
    action: 'read',
    secretKey,
    environment,
    success,
    error,
  });
}

/**
 * Helper function to log a secrets write operation.
 */
export async function logSecretsWrite(
  actor: AuditActor,
  secretKey: string,
  environment: string,
  success: boolean,
  error?: string
): Promise<void> {
  const log = getAuditLog();
  await log.log({
    actor,
    action: 'write',
    secretKey,
    environment,
    success,
    error,
  });
}

/**
 * Helper function to log a secrets delete operation.
 */
export async function logSecretsDelete(
  actor: AuditActor,
  secretKey: string,
  environment: string,
  success: boolean,
  error?: string
): Promise<void> {
  const log = getAuditLog();
  await log.log({
    actor,
    action: 'delete',
    secretKey,
    environment,
    success,
    error,
  });
}

/**
 * Helper function to log a secrets list operation.
 */
export async function logSecretsList(
  actor: AuditActor,
  secretKey: string,
  environment: string,
  success: boolean,
  error?: string
): Promise<void> {
  const log = getAuditLog();
  await log.log({
    actor,
    action: 'list',
    secretKey,
    environment,
    success,
    error,
  });
}
