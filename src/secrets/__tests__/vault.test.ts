import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createVault, type SecretsVault } from '../vault';
import * as yaml from '../yaml-parser';

describe('SecretsVault', () => {
  let testDir: string;
  let vault: SecretsVault;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = path.join(os.tmpdir(), `vault-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(testDir, { recursive: true });
    vault = createVault({ secretsDir: path.join(testDir, 'secrets') });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('init', () => {
    it('should initialize a new vault for an environment', async () => {
      await vault.init('dev', 'test-password');

      // Should create directories
      const keysDir = path.join(testDir, 'secrets', '.keys');
      const keysStat = await fs.stat(keysDir);
      expect(keysStat.isDirectory()).toBe(true);
    });

    it('should create a key file on first init', async () => {
      await vault.init('dev', 'test-password');

      const keyPath = path.join(testDir, 'secrets', '.keys', 'dev.key');
      const keyExists = await fs
        .access(keyPath)
        .then(() => true)
        .catch(() => false);
      expect(keyExists).toBe(true);
    });

    it('should reuse existing key file on subsequent init', async () => {
      await vault.init('dev', 'test-password');
      await vault.set('test', 'value1');

      // Create new vault instance and init again
      const vault2 = createVault({ secretsDir: path.join(testDir, 'secrets') });
      await vault2.init('dev', 'different-password'); // Password doesn't matter after first init

      const value = await vault2.get('test');
      expect(value).toBe('value1');
    });

    it('should support multiple environments', async () => {
      await vault.init('dev', 'dev-password');
      await vault.set('env', 'development');

      const prodVault = createVault({ secretsDir: path.join(testDir, 'secrets') });
      await prodVault.init('prod', 'prod-password');
      await prodVault.set('env', 'production');

      // Verify separate environments
      const devVault = createVault({ secretsDir: path.join(testDir, 'secrets') });
      await devVault.init('dev', 'dev-password');
      expect(await devVault.get('env')).toBe('development');

      const prodVault2 = createVault({ secretsDir: path.join(testDir, 'secrets') });
      await prodVault2.init('prod', 'prod-password');
      expect(await prodVault2.get('env')).toBe('production');
    });
  });

  describe('get/set', () => {
    beforeEach(async () => {
      await vault.init('dev', 'test-password');
    });

    it('should store and retrieve a secret', async () => {
      await vault.set('API_KEY', 'sk-test-123');
      const value = await vault.get('API_KEY');
      expect(value).toBe('sk-test-123');
    });

    it('should return undefined for non-existent keys', async () => {
      const value = await vault.get('NON_EXISTENT');
      expect(value).toBeUndefined();
    });

    it('should overwrite existing values', async () => {
      await vault.set('KEY', 'value1');
      await vault.set('KEY', 'value2');
      const value = await vault.get('KEY');
      expect(value).toBe('value2');
    });

    it('should handle special characters in values', async () => {
      const specialValue = 'pass:word#with$pecial@chars!';
      await vault.set('SPECIAL', specialValue);
      const value = await vault.get('SPECIAL');
      expect(value).toBe(specialValue);
    });

    it('should handle multiline values', async () => {
      const multiline = 'line1\nline2\nline3';
      await vault.set('MULTILINE', multiline);
      const value = await vault.get('MULTILINE');
      expect(value).toBe(multiline);
    });

    it('should persist secrets across vault instances', async () => {
      await vault.set('PERSISTENT', 'stored-value');

      const vault2 = createVault({ secretsDir: path.join(testDir, 'secrets') });
      await vault2.init('dev', 'any-password');
      const value = await vault2.get('PERSISTENT');
      expect(value).toBe('stored-value');
    });

    it('should throw if vault not initialized', async () => {
      const uninitializedVault = createVault({ secretsDir: path.join(testDir, 'secrets2') });
      await expect(uninitializedVault.get('key')).rejects.toThrow('Vault not initialized');
      await expect(uninitializedVault.set('key', 'value')).rejects.toThrow('Vault not initialized');
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await vault.init('dev', 'test-password');
    });

    it('should return empty array for empty vault', async () => {
      const keys = await vault.list();
      expect(keys).toEqual([]);
    });

    it('should list all secret keys', async () => {
      await vault.set('KEY1', 'value1');
      await vault.set('KEY2', 'value2');
      await vault.set('KEY3', 'value3');

      const keys = await vault.list();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('KEY1');
      expect(keys).toContain('KEY2');
      expect(keys).toContain('KEY3');
    });

    it('should not expose secret values', async () => {
      await vault.set('SECRET', 'super-secret-value');
      const keys = await vault.list();

      expect(keys).toContain('SECRET');
      expect(keys).not.toContain('super-secret-value');
    });

    it('should throw if vault not initialized', async () => {
      const uninitializedVault = createVault({ secretsDir: path.join(testDir, 'secrets2') });
      await expect(uninitializedVault.list()).rejects.toThrow('Vault not initialized');
    });
  });

  describe('delete', () => {
    beforeEach(async () => {
      await vault.init('dev', 'test-password');
    });

    it('should delete a secret', async () => {
      await vault.set('TO_DELETE', 'value');
      expect(await vault.get('TO_DELETE')).toBe('value');

      await vault.delete('TO_DELETE');
      expect(await vault.get('TO_DELETE')).toBeUndefined();
    });

    it('should persist deletion across vault instances', async () => {
      await vault.set('TO_DELETE', 'value');
      await vault.delete('TO_DELETE');

      const vault2 = createVault({ secretsDir: path.join(testDir, 'secrets') });
      await vault2.init('dev', 'any-password');
      expect(await vault2.get('TO_DELETE')).toBeUndefined();
    });

    it('should not throw when deleting non-existent key', async () => {
      await expect(vault.delete('NON_EXISTENT')).resolves.not.toThrow();
    });

    it('should throw if vault not initialized', async () => {
      const uninitializedVault = createVault({ secretsDir: path.join(testDir, 'secrets2') });
      await expect(uninitializedVault.delete('key')).rejects.toThrow('Vault not initialized');
    });
  });

  describe('encryption', () => {
    it('should encrypt vault file contents', async () => {
      await vault.init('dev', 'test-password');
      await vault.set('SECRET_KEY', 'super-secret-value');

      // Read raw vault file
      const vaultPath = path.join(testDir, 'secrets', 'dev.enc.yaml');
      const content = await fs.readFile(vaultPath, 'utf8');

      // Should not contain plaintext secret
      expect(content).not.toContain('super-secret-value');
      expect(content).not.toContain('SECRET_KEY');

      // Should contain encryption metadata
      expect(content).toContain('iv');
      expect(content).toContain('authTag');
      expect(content).toContain('data');
    });

    it('should use different IV for each save', async () => {
      await vault.init('dev', 'test-password');

      await vault.set('KEY', 'value1');
      const vaultPath = path.join(testDir, 'secrets', 'dev.enc.yaml');
      const content1 = await fs.readFile(vaultPath, 'utf8');

      await vault.set('KEY', 'value2');
      const content2 = await fs.readFile(vaultPath, 'utf8');

      // Different content should result in different encrypted data
      expect(content1).not.toEqual(content2);
    });

    it('should fail decryption with wrong key', async () => {
      await vault.init('dev', 'test-password');
      await vault.set('KEY', 'value');

      // Corrupt the key file
      const keyPath = path.join(testDir, 'secrets', '.keys', 'dev.key');
      await fs.writeFile(keyPath, 'corrupted-key-data');

      const vault2 = createVault({ secretsDir: path.join(testDir, 'secrets') });
      await expect(vault2.init('dev', 'any-password')).rejects.toThrow();
    });
  });

  describe('file permissions', () => {
    it('should create vault file with restricted permissions', async () => {
      await vault.init('dev', 'test-password');
      await vault.set('KEY', 'value');

      const vaultPath = path.join(testDir, 'secrets', 'dev.enc.yaml');
      const stat = await fs.stat(vaultPath);

      // Check file mode (0600 = owner read/write only)
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('should create key file with restricted permissions', async () => {
      await vault.init('dev', 'test-password');

      const keyPath = path.join(testDir, 'secrets', '.keys', 'dev.key');
      const stat = await fs.stat(keyPath);

      // Check file mode (0600 = owner read/write only)
      const mode = stat.mode & 0o777;
      expect(mode).toBe(0o600);
    });
  });
});

describe('yaml-parser', () => {
  describe('parse', () => {
    it('should parse simple key-value pairs', () => {
      const content = 'key1: value1\nkey2: value2';
      const result = yaml.parse(content);
      expect(result).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('should parse JSON content', () => {
      const content = '{"key": "value"}';
      const result = yaml.parse(content);
      expect(result).toEqual({ key: 'value' });
    });

    it('should handle empty content', () => {
      expect(yaml.parse('')).toEqual({});
      expect(yaml.parse('   ')).toEqual({});
    });

    it('should ignore comments', () => {
      const content = '# comment\nkey: value\n# another comment';
      const result = yaml.parse(content);
      expect(result).toEqual({ key: 'value' });
    });

    it('should handle quoted values', () => {
      const content = 'key1: "quoted value"\nkey2: \'single quoted\'';
      const result = yaml.parse(content);
      expect(result).toEqual({ key1: 'quoted value', key2: 'single quoted' });
    });
  });

  describe('stringify', () => {
    it('should stringify simple objects', () => {
      const result = yaml.stringify({ key1: 'value1', key2: 'value2' });
      expect(result).toContain('key1: value1');
      expect(result).toContain('key2: value2');
    });

    it('should quote strings with special characters', () => {
      const result = yaml.stringify({ key: 'value:with:colons' });
      expect(result).toContain('"value:with:colons"');
    });

    it('should handle numbers and booleans', () => {
      const result = yaml.stringify({ num: 42, bool: true } as Record<string, unknown>);
      expect(result).toContain('num: 42');
      expect(result).toContain('bool: true');
    });

    it('should handle null values', () => {
      const result = yaml.stringify({ key: null } as unknown as Record<string, string>);
      expect(result).toContain('key: null');
    });
  });
});
