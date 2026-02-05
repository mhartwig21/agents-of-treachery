/**
 * Tests for the runtime secrets injection module.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadSecretsToEnv,
  createSecretsProvider,
  writeSecretsFile,
  validatePasswordSource,
  encryptVault,
  decryptVault,
  saveVault,
} from '../index';
import type { VaultData, EncryptedVault } from '../types';

describe('secrets module', () => {
  let tempDir: string;
  let vaultPath: string;
  const testPassword = 'test-password-12345';
  const testSecrets: Record<string, string> = {
    DATABASE_URL: 'postgres://localhost:5432/db',
    API_KEY: 'sk-test-key-12345',
    SECRET_TOKEN: 'my-secret-token',
  };

  beforeEach(async () => {
    // Create temp directory for test vaults
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'secrets-test-'));
    vaultPath = path.join(tempDir, 'test.vault');

    // Save a test vault
    const vaultData: VaultData = {
      secrets: { ...testSecrets },
      lastModified: new Date().toISOString(),
    };
    await saveVault(vaultData, testPassword, vaultPath);
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.promises.rm(tempDir, { recursive: true, force: true });

    // Clean up any env vars we set
    delete process.env.DATABASE_URL;
    delete process.env.API_KEY;
    delete process.env.SECRET_TOKEN;
  });

  describe('encryptVault / decryptVault', () => {
    it('should encrypt and decrypt vault data', () => {
      const vaultData: VaultData = {
        secrets: { KEY: 'value' },
      };

      const encrypted = encryptVault(vaultData, 'password');
      expect(encrypted.version).toBe(1);
      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.salt).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.data).toBeDefined();

      const decrypted = decryptVault(encrypted, 'password');
      expect(decrypted.secrets).toEqual({ KEY: 'value' });
    });

    it('should fail with wrong password', () => {
      const vaultData: VaultData = {
        secrets: { KEY: 'value' },
      };

      const encrypted = encryptVault(vaultData, 'correct-password');

      expect(() => decryptVault(encrypted, 'wrong-password')).toThrow(
        'Failed to decrypt vault'
      );
    });

    it('should produce different ciphertexts for same data', () => {
      const vaultData: VaultData = {
        secrets: { KEY: 'value' },
      };

      const encrypted1 = encryptVault(vaultData, 'password');
      const encrypted2 = encryptVault(vaultData, 'password');

      // Salt and IV should be different, so ciphertext should differ
      expect(encrypted1.data).not.toBe(encrypted2.data);
    });

    it('should reject unsupported vault version', () => {
      const encrypted: EncryptedVault = {
        version: 2 as 1, // Force wrong version
        algorithm: 'aes-256-gcm',
        salt: '',
        iv: '',
        authTag: '',
        data: '',
      };

      expect(() => decryptVault(encrypted, 'password')).toThrow(
        'Unsupported vault version'
      );
    });
  });

  describe('loadSecretsToEnv', () => {
    it('should load secrets into process.env', async () => {
      const loaded = await loadSecretsToEnv({
        env: 'test',
        password: testPassword,
        vaultPath,
      });

      expect(loaded).toContain('DATABASE_URL');
      expect(loaded).toContain('API_KEY');
      expect(loaded).toContain('SECRET_TOKEN');
      expect(process.env.DATABASE_URL).toBe(testSecrets.DATABASE_URL);
      expect(process.env.API_KEY).toBe(testSecrets.API_KEY);
      expect(process.env.SECRET_TOKEN).toBe(testSecrets.SECRET_TOKEN);
    });

    it('should throw if vault file not found', async () => {
      await expect(
        loadSecretsToEnv({
          env: 'test',
          password: testPassword,
          vaultPath: '/nonexistent/path.vault',
        })
      ).rejects.toThrow('Vault file not found');
    });

    it('should throw with wrong password', async () => {
      await expect(
        loadSecretsToEnv({
          env: 'test',
          password: 'wrong-password',
          vaultPath,
        })
      ).rejects.toThrow('Failed to decrypt vault');
    });
  });

  describe('createSecretsProvider', () => {
    it('should provide access to secrets', async () => {
      const provider = await createSecretsProvider({
        env: 'test',
        password: testPassword,
        vaultPath,
      });

      try {
        expect(await provider.get('DATABASE_URL')).toBe(testSecrets.DATABASE_URL);
        expect(await provider.get('API_KEY')).toBe(testSecrets.API_KEY);
        expect(await provider.has('DATABASE_URL')).toBe(true);
        expect(await provider.has('NONEXISTENT')).toBe(false);
        expect(await provider.getOptional('NONEXISTENT')).toBeUndefined();
      } finally {
        provider.close();
      }
    });

    it('should throw for missing secrets', async () => {
      const provider = await createSecretsProvider({
        env: 'test',
        password: testPassword,
        vaultPath,
      });

      try {
        await expect(provider.get('NONEXISTENT')).rejects.toThrow('Secret not found');
      } finally {
        provider.close();
      }
    });

    it('should throw after close', async () => {
      const provider = await createSecretsProvider({
        env: 'test',
        password: testPassword,
        vaultPath,
      });

      provider.close();

      await expect(provider.get('DATABASE_URL')).rejects.toThrow(
        'SecretsProvider has been closed'
      );
    });

    it('should handle rotation callbacks', async () => {
      const provider = await createSecretsProvider({
        env: 'test',
        password: testPassword,
        vaultPath,
      });

      try {
        const rotatedValues: string[] = [];
        const unsubscribe = provider.onRotation('DATABASE_URL', (newValue) => {
          rotatedValues.push(newValue);
        });

        // Update the vault with new value
        const newVaultData: VaultData = {
          secrets: {
            ...testSecrets,
            DATABASE_URL: 'postgres://new-host:5432/newdb',
          },
        };
        await saveVault(newVaultData, testPassword, vaultPath);

        // Trigger refresh
        await provider.refresh();

        expect(rotatedValues).toEqual(['postgres://new-host:5432/newdb']);
        expect(await provider.get('DATABASE_URL')).toBe('postgres://new-host:5432/newdb');

        // Unsubscribe and verify no more callbacks
        unsubscribe();
        await saveVault(
          {
            secrets: {
              ...testSecrets,
              DATABASE_URL: 'postgres://another-host:5432/anotherdb',
            },
          },
          testPassword,
          vaultPath
        );
        await provider.refresh();

        expect(rotatedValues).toHaveLength(1); // No new callback
      } finally {
        provider.close();
      }
    });

    it('should ignore callback errors during rotation', async () => {
      const provider = await createSecretsProvider({
        env: 'test',
        password: testPassword,
        vaultPath,
      });

      try {
        const successfulRotations: string[] = [];

        // First callback throws
        provider.onRotation('DATABASE_URL', () => {
          throw new Error('Callback error');
        });

        // Second callback should still run
        provider.onRotation('DATABASE_URL', (newValue) => {
          successfulRotations.push(newValue);
        });

        // Update vault
        await saveVault(
          {
            secrets: {
              ...testSecrets,
              DATABASE_URL: 'postgres://new:5432/db',
            },
          },
          testPassword,
          vaultPath
        );

        // Should not throw despite first callback error
        await expect(provider.refresh()).resolves.toBeUndefined();
        expect(successfulRotations).toEqual(['postgres://new:5432/db']);
      } finally {
        provider.close();
      }
    });
  });

  describe('writeSecretsFile', () => {
    it('should write secrets in env format', async () => {
      const outputPath = path.join(tempDir, 'output.env');

      await writeSecretsFile(outputPath, {
        env: 'test',
        password: testPassword,
        format: 'env',
        vaultPath,
      });

      const content = await fs.promises.readFile(outputPath, 'utf8');
      expect(content).toContain('DATABASE_URL="postgres://localhost:5432/db"');
      expect(content).toContain('API_KEY="sk-test-key-12345"');
      expect(content).toContain('SECRET_TOKEN="my-secret-token"');
    });

    it('should write secrets in json format', async () => {
      const outputPath = path.join(tempDir, 'output.json');

      await writeSecretsFile(outputPath, {
        env: 'test',
        password: testPassword,
        format: 'json',
        vaultPath,
      });

      const content = await fs.promises.readFile(outputPath, 'utf8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(testSecrets);
    });

    it('should filter by keys', async () => {
      const outputPath = path.join(tempDir, 'filtered.env');

      await writeSecretsFile(outputPath, {
        env: 'test',
        password: testPassword,
        format: 'env',
        keys: ['DATABASE_URL'],
        vaultPath,
      });

      const content = await fs.promises.readFile(outputPath, 'utf8');
      expect(content).toContain('DATABASE_URL=');
      expect(content).not.toContain('API_KEY');
      expect(content).not.toContain('SECRET_TOKEN');
    });

    it('should escape special characters in env format', async () => {
      // Create vault with special characters
      await saveVault(
        {
          secrets: {
            SPECIAL: 'value with "quotes" and\nnewlines and \\backslash',
          },
        },
        testPassword,
        vaultPath
      );

      const outputPath = path.join(tempDir, 'special.env');
      await writeSecretsFile(outputPath, {
        env: 'test',
        password: testPassword,
        format: 'env',
        vaultPath,
      });

      const content = await fs.promises.readFile(outputPath, 'utf8');
      expect(content).toContain('SPECIAL="value with \\"quotes\\" and\\nnewlines and \\\\backslash"');
    });

    it('should set restrictive file permissions', async () => {
      const outputPath = path.join(tempDir, 'perms.env');

      await writeSecretsFile(outputPath, {
        env: 'test',
        password: testPassword,
        format: 'env',
        vaultPath,
      });

      const stats = await fs.promises.stat(outputPath);
      // 0o400 = owner read only
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o400);
    });
  });

  describe('validatePasswordSource', () => {
    it('should throw for undefined password', () => {
      expect(() => validatePasswordSource(undefined)).toThrow('VAULT_PASSWORD is required');
    });

    it('should throw for empty password', () => {
      expect(() => validatePasswordSource('')).toThrow('VAULT_PASSWORD is required');
    });

    it('should throw for placeholder passwords', () => {
      expect(() => validatePasswordSource('CHANGE_ME')).toThrow('appears to be a placeholder');
      expect(() => validatePasswordSource('password')).toThrow('appears to be a placeholder');
    });

    it('should throw for short passwords', () => {
      expect(() => validatePasswordSource('short')).toThrow('too short');
    });

    it('should accept valid passwords', () => {
      expect(() =>
        validatePasswordSource('my-secure-password-12345')
      ).not.toThrow();
    });
  });

  describe('integration', () => {
    it('should work with createSecretsProvider for rotation scenario', async () => {
      // Simulate an application that needs to reconnect to DB on rotation
      const connectionLog: string[] = [];
      const simulateDbConnect = (url: string) => {
        connectionLog.push(`connected:${url}`);
      };

      const provider = await createSecretsProvider({
        env: 'test',
        password: testPassword,
        vaultPath,
      });

      try {
        // Initial connection
        const initialUrl = await provider.get('DATABASE_URL');
        simulateDbConnect(initialUrl);

        // Register for rotation
        provider.onRotation('DATABASE_URL', (newUrl) => {
          simulateDbConnect(newUrl);
        });

        // Simulate secret rotation by updating vault
        await saveVault(
          {
            secrets: {
              ...testSecrets,
              DATABASE_URL: 'postgres://rotated:5432/db',
            },
          },
          testPassword,
          vaultPath
        );

        // Application detects rotation (e.g., via periodic check or notification)
        await provider.refresh();

        expect(connectionLog).toEqual([
          'connected:postgres://localhost:5432/db',
          'connected:postgres://rotated:5432/db',
        ]);
      } finally {
        provider.close();
      }
    });
  });
});
