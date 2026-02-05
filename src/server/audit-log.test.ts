/**
 * Tests for the secrets access audit logging system.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  FileAuditLog,
  AuditEntry,
  getAuditLog,
  resetAuditLog,
  logSecretsRead,
  logSecretsWrite,
  logSecretsDelete,
  logSecretsList,
} from './audit-log';

const TEST_LOGS_DIR = join(process.cwd(), 'logs', 'audit-test');

describe('FileAuditLog', () => {
  let auditLog: FileAuditLog;

  beforeEach(() => {
    // Clean up test directory
    if (existsSync(TEST_LOGS_DIR)) {
      rmSync(TEST_LOGS_DIR, { recursive: true });
    }
    mkdirSync(TEST_LOGS_DIR, { recursive: true });

    auditLog = new FileAuditLog({ logsDir: TEST_LOGS_DIR });
    resetAuditLog();
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_LOGS_DIR)) {
      rmSync(TEST_LOGS_DIR, { recursive: true });
    }
  });

  describe('log()', () => {
    it('creates a log entry with correct fields', async () => {
      await auditLog.log({
        actor: 'user:alice',
        action: 'read',
        secretKey: 'DATABASE_URL',
        environment: 'prod',
        success: true,
      });

      const entries = await auditLog.query({});
      expect(entries).toHaveLength(1);

      const entry = entries[0];
      expect(entry.actor).toBe('user:alice');
      expect(entry.action).toBe('read');
      expect(entry.secretKey).toBe('DATABASE_URL');
      expect(entry.environment).toBe('prod');
      expect(entry.success).toBe(true);
      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(entry.previousHash).toBe('');
    });

    it('creates hash chain with multiple entries', async () => {
      await auditLog.log({
        actor: 'user:alice',
        action: 'read',
        secretKey: 'SECRET_1',
        environment: 'prod',
        success: true,
      });

      await auditLog.log({
        actor: 'user:bob',
        action: 'write',
        secretKey: 'SECRET_2',
        environment: 'staging',
        success: true,
      });

      await auditLog.log({
        actor: 'service:api-server',
        action: 'delete',
        secretKey: 'SECRET_3',
        environment: 'dev',
        success: false,
        error: 'Permission denied',
      });

      const entries = await auditLog.query({});
      expect(entries).toHaveLength(3);

      // First entry has empty previousHash
      expect(entries[0].previousHash).toBe('');

      // Second entry's previousHash equals first entry's hash
      expect(entries[1].previousHash).toBe(entries[0].hash);

      // Third entry's previousHash equals second entry's hash
      expect(entries[2].previousHash).toBe(entries[1].hash);
    });

    it('persists entries across log instances', async () => {
      await auditLog.log({
        actor: 'user:alice',
        action: 'read',
        secretKey: 'DATABASE_URL',
        environment: 'prod',
        success: true,
      });

      // Create new instance pointing to same directory
      const newLog = new FileAuditLog({ logsDir: TEST_LOGS_DIR });

      await newLog.log({
        actor: 'user:bob',
        action: 'write',
        secretKey: 'API_KEY',
        environment: 'prod',
        success: true,
      });

      const entries = await newLog.query({});
      expect(entries).toHaveLength(2);

      // Hash chain should be continuous
      expect(entries[1].previousHash).toBe(entries[0].hash);
    });

    it('does not log when disabled', async () => {
      auditLog.disable();

      await auditLog.log({
        actor: 'user:alice',
        action: 'read',
        secretKey: 'DATABASE_URL',
        environment: 'prod',
        success: true,
      });

      const entries = await auditLog.query({});
      expect(entries).toHaveLength(0);
    });
  });

  describe('query()', () => {
    beforeEach(async () => {
      // Add test entries
      await auditLog.log({
        actor: 'user:alice',
        action: 'read',
        secretKey: 'DATABASE_URL',
        environment: 'prod',
        success: true,
      });

      await auditLog.log({
        actor: 'user:bob',
        action: 'write',
        secretKey: 'API_KEY',
        environment: 'staging',
        success: true,
      });

      await auditLog.log({
        actor: 'service:api-server',
        action: 'read',
        secretKey: 'DATABASE_URL',
        environment: 'prod',
        success: false,
        error: 'Connection timeout',
      });

      await auditLog.log({
        actor: 'user:alice',
        action: 'delete',
        secretKey: 'OLD_SECRET',
        environment: 'dev',
        success: true,
      });
    });

    it('returns all entries without filters', async () => {
      const entries = await auditLog.query({});
      expect(entries).toHaveLength(4);
    });

    it('filters by actor', async () => {
      const entries = await auditLog.query({ actor: 'user:alice' });
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.actor === 'user:alice')).toBe(true);
    });

    it('filters by action', async () => {
      const entries = await auditLog.query({ action: 'read' });
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.action === 'read')).toBe(true);
    });

    it('filters by secretKey', async () => {
      const entries = await auditLog.query({ secretKey: 'DATABASE_URL' });
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.secretKey === 'DATABASE_URL')).toBe(true);
    });

    it('filters by secretKeyPrefix', async () => {
      const entries = await auditLog.query({ secretKeyPrefix: 'DATA' });
      expect(entries).toHaveLength(2);
    });

    it('filters by environment', async () => {
      const entries = await auditLog.query({ environment: 'prod' });
      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.environment === 'prod')).toBe(true);
    });

    it('filters by success', async () => {
      const failures = await auditLog.query({ success: false });
      expect(failures).toHaveLength(1);
      expect(failures[0].error).toBe('Connection timeout');

      const successes = await auditLog.query({ success: true });
      expect(successes).toHaveLength(3);
    });

    it('filters by time range', async () => {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const hourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      const entries = await auditLog.query({
        startTime: hourAgo,
        endTime: hourFromNow,
      });
      expect(entries).toHaveLength(4);
    });

    it('applies limit and offset', async () => {
      const limited = await auditLog.query({ limit: 2 });
      expect(limited).toHaveLength(2);

      const offsetted = await auditLog.query({ offset: 2, limit: 2 });
      expect(offsetted).toHaveLength(2);

      // Should be different entries
      expect(limited[0].id).not.toBe(offsetted[0].id);
    });

    it('combines multiple filters', async () => {
      const entries = await auditLog.query({
        actor: 'user:alice',
        action: 'read',
        environment: 'prod',
      });
      expect(entries).toHaveLength(1);
      expect(entries[0].secretKey).toBe('DATABASE_URL');
    });
  });

  describe('verify()', () => {
    it('returns valid for empty log', async () => {
      const result = await auditLog.verify();
      expect(result.valid).toBe(true);
      expect(result.entriesVerified).toBe(0);
    });

    it('returns valid for intact hash chain', async () => {
      await auditLog.log({
        actor: 'user:alice',
        action: 'read',
        secretKey: 'SECRET_1',
        environment: 'prod',
        success: true,
      });

      await auditLog.log({
        actor: 'user:bob',
        action: 'write',
        secretKey: 'SECRET_2',
        environment: 'prod',
        success: true,
      });

      await auditLog.log({
        actor: 'user:charlie',
        action: 'delete',
        secretKey: 'SECRET_3',
        environment: 'prod',
        success: true,
      });

      const result = await auditLog.verify();
      expect(result.valid).toBe(true);
      expect(result.entriesVerified).toBe(3);
    });

    it('detects tampered entry', async () => {
      await auditLog.log({
        actor: 'user:alice',
        action: 'read',
        secretKey: 'SECRET_1',
        environment: 'prod',
        success: true,
      });

      await auditLog.log({
        actor: 'user:bob',
        action: 'write',
        secretKey: 'SECRET_2',
        environment: 'prod',
        success: true,
      });

      // Tamper with the log file
      const logPath = auditLog.getLogPath();
      const content = readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n');
      const entry1 = JSON.parse(lines[1]) as AuditEntry;

      // Modify the actor without updating the hash
      entry1.actor = 'user:mallory';
      lines[1] = JSON.stringify(entry1);

      const { writeFileSync } = await import('fs');
      writeFileSync(logPath, lines.join('\n') + '\n');

      // Create new instance to reload from file
      const verifyLog = new FileAuditLog({ logsDir: TEST_LOGS_DIR });
      const result = await verifyLog.verify();

      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
      expect(result.error).toContain('incorrect hash');
    });

    it('detects broken chain (modified previousHash)', async () => {
      await auditLog.log({
        actor: 'user:alice',
        action: 'read',
        secretKey: 'SECRET_1',
        environment: 'prod',
        success: true,
      });

      await auditLog.log({
        actor: 'user:bob',
        action: 'write',
        secretKey: 'SECRET_2',
        environment: 'prod',
        success: true,
      });

      // Break the chain by modifying previousHash
      const logPath = auditLog.getLogPath();
      const content = readFileSync(logPath, 'utf-8');
      const lines = content.trim().split('\n');
      const entry1 = JSON.parse(lines[1]) as AuditEntry;

      entry1.previousHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
      lines[1] = JSON.stringify(entry1);

      const { writeFileSync } = await import('fs');
      writeFileSync(logPath, lines.join('\n') + '\n');

      const verifyLog = new FileAuditLog({ logsDir: TEST_LOGS_DIR });
      const result = await verifyLog.verify();

      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe(1);
      expect(result.error).toContain('incorrect previousHash');
    });
  });

  describe('applyRetention()', () => {
    it('removes old entries based on retention policy', async () => {
      const logWithRetention = new FileAuditLog({
        logsDir: TEST_LOGS_DIR,
        retentionDays: 7,
      });

      // Add an entry
      await logWithRetention.log({
        actor: 'user:alice',
        action: 'read',
        secretKey: 'SECRET',
        environment: 'prod',
        success: true,
      });

      // Manually modify the timestamp to be old
      const logPath = logWithRetention.getLogPath();
      const content = readFileSync(logPath, 'utf-8');
      const entry = JSON.parse(content.trim()) as AuditEntry;

      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      entry.timestamp = oldDate.toISOString();

      const { writeFileSync } = await import('fs');
      writeFileSync(logPath, JSON.stringify(entry) + '\n');

      // Add a recent entry
      await logWithRetention.log({
        actor: 'user:bob',
        action: 'write',
        secretKey: 'RECENT_SECRET',
        environment: 'prod',
        success: true,
      });

      const result = await logWithRetention.applyRetention();
      expect(result.removed).toBe(1);
      expect(result.remaining).toBe(1);

      // Verify remaining entry is the recent one
      const entries = await logWithRetention.query({});
      expect(entries).toHaveLength(1);
      expect(entries[0].secretKey).toBe('RECENT_SECRET');

      // Verify hash chain is still valid after retention
      const verifyResult = await logWithRetention.verify();
      expect(verifyResult.valid).toBe(true);
    });

    it('does nothing when retentionDays is 0', async () => {
      await auditLog.log({
        actor: 'user:alice',
        action: 'read',
        secretKey: 'SECRET',
        environment: 'prod',
        success: true,
      });

      const result = await auditLog.applyRetention();
      expect(result.removed).toBe(0);
      expect(result.remaining).toBe(1);
    });
  });
});

describe('Global audit log helpers', () => {
  const TEST_LOGS_DIR_2 = join(process.cwd(), 'logs', 'audit-test-2');

  beforeEach(() => {
    resetAuditLog();
    if (existsSync(TEST_LOGS_DIR_2)) {
      rmSync(TEST_LOGS_DIR_2, { recursive: true });
    }
    mkdirSync(TEST_LOGS_DIR_2, { recursive: true });
  });

  afterEach(() => {
    resetAuditLog();
    if (existsSync(TEST_LOGS_DIR_2)) {
      rmSync(TEST_LOGS_DIR_2, { recursive: true });
    }
  });

  it('getAuditLog returns singleton instance', () => {
    const log1 = getAuditLog({ logsDir: TEST_LOGS_DIR_2 });
    const log2 = getAuditLog();
    expect(log1).toBe(log2);
  });

  it('helper functions log correctly', async () => {
    const auditLog = getAuditLog({ logsDir: TEST_LOGS_DIR_2 });

    await logSecretsRead('user:alice', 'DB_URL', 'prod', true);
    await logSecretsWrite('user:bob', 'API_KEY', 'staging', true);
    await logSecretsDelete('service:cleanup', 'OLD_KEY', 'dev', true);
    await logSecretsList('user:admin', '*', 'prod', false, 'Access denied');

    const entries = await auditLog.query({});
    expect(entries).toHaveLength(4);

    expect(entries[0].action).toBe('read');
    expect(entries[1].action).toBe('write');
    expect(entries[2].action).toBe('delete');
    expect(entries[3].action).toBe('list');
  });
});
