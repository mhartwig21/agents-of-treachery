import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  VaultConfig,
  initVault,
  setSecret,
  getSecret,
  listSecrets,
  deleteSecret,
  rotatePassword,
  exportSecrets,
  getAuditLog,
  vaultExists
} from './index.js';

describe('Vault', () => {
  let testDir: string;
  let config: VaultConfig;
  const password = 'testpassword123';

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-test-'));
    config = { env: 'test', vaultDir: testDir };
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  describe('initVault', () => {
    it('creates a new vault file', () => {
      initVault(config, password);
      expect(vaultExists(config)).toBe(true);
      expect(fs.existsSync(path.join(testDir, 'test.vault'))).toBe(true);
    });

    it('throws if vault already exists', () => {
      initVault(config, password);
      expect(() => initVault(config, password)).toThrow('Vault already exists');
    });

    it('creates audit log entry', () => {
      initVault(config, password);
      const entries = getAuditLog(config, {});
      expect(entries).toHaveLength(1);
      expect(entries[0].action).toBe('init');
    });
  });

  describe('setSecret / getSecret', () => {
    beforeEach(() => {
      initVault(config, password);
    });

    it('stores and retrieves a secret', () => {
      setSecret(config, password, 'API_KEY', 'secret123');
      const value = getSecret(config, password, 'API_KEY');
      expect(value).toBe('secret123');
    });

    it('updates an existing secret', () => {
      setSecret(config, password, 'API_KEY', 'old-value');
      setSecret(config, password, 'API_KEY', 'new-value');
      const value = getSecret(config, password, 'API_KEY');
      expect(value).toBe('new-value');
    });

    it('returns null for non-existent key', () => {
      const value = getSecret(config, password, 'MISSING_KEY');
      expect(value).toBeNull();
    });

    it('throws on invalid password', () => {
      setSecret(config, password, 'API_KEY', 'secret');
      expect(() => getSecret(config, 'wrongpassword', 'API_KEY')).toThrow('Invalid password');
    });

    it('handles special characters in values', () => {
      const specialValue = "pa$$w0rd'with\"special\nchars";
      setSecret(config, password, 'SPECIAL', specialValue);
      expect(getSecret(config, password, 'SPECIAL')).toBe(specialValue);
    });
  });

  describe('listSecrets', () => {
    beforeEach(() => {
      initVault(config, password);
    });

    it('returns empty array for empty vault', () => {
      const keys = listSecrets(config, password);
      expect(keys).toEqual([]);
    });

    it('returns sorted list of keys', () => {
      setSecret(config, password, 'ZEBRA', 'z');
      setSecret(config, password, 'ALPHA', 'a');
      setSecret(config, password, 'BETA', 'b');
      const keys = listSecrets(config, password);
      expect(keys).toEqual(['ALPHA', 'BETA', 'ZEBRA']);
    });
  });

  describe('deleteSecret', () => {
    beforeEach(() => {
      initVault(config, password);
      setSecret(config, password, 'TO_DELETE', 'value');
    });

    it('removes an existing secret', () => {
      const deleted = deleteSecret(config, password, 'TO_DELETE');
      expect(deleted).toBe(true);
      expect(getSecret(config, password, 'TO_DELETE')).toBeNull();
    });

    it('returns false for non-existent key', () => {
      const deleted = deleteSecret(config, password, 'MISSING');
      expect(deleted).toBe(false);
    });
  });

  describe('rotatePassword', () => {
    const newPassword = 'newpassword456';

    beforeEach(() => {
      initVault(config, password);
      setSecret(config, password, 'KEY', 'value');
    });

    it('allows access with new password', () => {
      rotatePassword(config, password, newPassword);
      const value = getSecret(config, newPassword, 'KEY');
      expect(value).toBe('value');
    });

    it('denies access with old password', () => {
      rotatePassword(config, password, newPassword);
      expect(() => getSecret(config, password, 'KEY')).toThrow('Invalid password');
    });
  });

  describe('exportSecrets', () => {
    beforeEach(() => {
      initVault(config, password);
      setSecret(config, password, 'DB_URL', 'postgres://localhost');
      setSecret(config, password, 'API_KEY', 'sk-123');
    });

    it('exports as env format', () => {
      const output = exportSecrets(config, password, 'env');
      expect(output).toContain("export DB_URL='postgres://localhost'");
      expect(output).toContain("export API_KEY='sk-123'");
    });

    it('exports as json format', () => {
      const output = exportSecrets(config, password, 'json');
      const parsed = JSON.parse(output);
      expect(parsed.DB_URL).toBe('postgres://localhost');
      expect(parsed.API_KEY).toBe('sk-123');
    });

    it('escapes single quotes in env format', () => {
      setSecret(config, password, 'QUOTED', "it's a value");
      const output = exportSecrets(config, password, 'env');
      expect(output).toContain("export QUOTED='it'\\''s a value'");
    });
  });

  describe('getAuditLog', () => {
    beforeEach(() => {
      initVault(config, password);
    });

    it('records all operations', () => {
      setSecret(config, password, 'KEY1', 'v1');
      getSecret(config, password, 'KEY1');
      deleteSecret(config, password, 'KEY1');

      const entries = getAuditLog(config, {});
      const actions = entries.map(e => e.action);
      expect(actions).toContain('init');
      expect(actions).toContain('set');
      expect(actions).toContain('get');
      expect(actions).toContain('delete');
    });

    it('filters by key', () => {
      setSecret(config, password, 'KEY1', 'v1');
      setSecret(config, password, 'KEY2', 'v2');

      const entries = getAuditLog(config, { key: 'KEY1' });
      expect(entries.every(e => e.key === 'KEY1' || e.key === undefined)).toBe(true);
    });
  });
});
