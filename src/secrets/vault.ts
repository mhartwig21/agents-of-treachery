/**
 * Encrypted secrets vault using AES-256-GCM.
 *
 * File structure:
 *   secrets/
 *     .keys/           # NOT in git - contains derived keys
 *       dev.key
 *       prod.key
 *     dev.enc.yaml     # Encrypted, safe for git
 *     staging.enc.yaml
 *     prod.enc.yaml
 */

import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from './yaml-parser';

// Constants for encryption
const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // 96 bits for GCM
const SALT_LENGTH = 32; // 256 bits
const PBKDF2_ITERATIONS = 100000;

export interface SecretsVault {
  /** Initialize vault for an environment */
  init(env: string, masterPassword: string): Promise<void>;

  /** Get a secret value */
  get(key: string): Promise<string | undefined>;

  /** Set a secret value (re-encrypts vault) */
  set(key: string, value: string): Promise<void>;

  /** List all secret keys (not values) */
  list(): Promise<string[]>;

  /** Delete a secret */
  delete(key: string): Promise<void>;
}

export interface VaultOptions {
  /** Base directory for secrets (default: 'secrets') */
  secretsDir?: string;
}

interface EncryptedData {
  iv: string; // hex
  authTag: string; // hex
  data: string; // hex (encrypted YAML)
}

/**
 * Create a secrets vault instance.
 */
export function createVault(options: VaultOptions = {}): SecretsVault {
  const secretsDir = options.secretsDir || 'secrets';
  const keysDir = path.join(secretsDir, '.keys');

  let currentEnv: string | null = null;
  let currentKey: Buffer | null = null;
  let secrets: Record<string, string> = {};

  /**
   * Derive encryption key from password using PBKDF2.
   */
  function deriveKey(password: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  }

  /**
   * Encrypt plaintext data using the derived key directly.
   */
  function encrypt(plaintext: string, key: Buffer): EncryptedData {
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted.toString('hex'),
    };
  }

  /**
   * Decrypt encrypted data using the derived key directly.
   */
  function decrypt(encrypted: EncryptedData, key: Buffer): string {
    const iv = Buffer.from(encrypted.iv, 'hex');
    const authTag = Buffer.from(encrypted.authTag, 'hex');
    const data = Buffer.from(encrypted.data, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  }

  /**
   * Get path to encrypted vault file.
   */
  function getVaultPath(env: string): string {
    return path.join(secretsDir, `${env}.enc.yaml`);
  }

  /**
   * Get path to key file.
   */
  function getKeyPath(env: string): string {
    return path.join(keysDir, `${env}.key`);
  }

  /**
   * Ensure directories exist with proper permissions.
   */
  async function ensureDirectories(): Promise<void> {
    await fs.mkdir(secretsDir, { recursive: true });
    await fs.mkdir(keysDir, { recursive: true, mode: 0o700 });
  }

  /**
   * Load encrypted vault file.
   */
  async function loadVault(env: string, key: Buffer): Promise<Record<string, string>> {
    const vaultPath = getVaultPath(env);

    try {
      const content = await fs.readFile(vaultPath, 'utf8');
      const encrypted = yaml.parse(content) as unknown as EncryptedData;
      const decrypted = decrypt(encrypted, key);
      return (yaml.parse(decrypted) || {}) as Record<string, string>;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}; // No vault file yet
      }
      throw error;
    }
  }

  /**
   * Save vault to encrypted file.
   */
  async function saveVault(env: string, key: Buffer, data: Record<string, string>): Promise<void> {
    const vaultPath = getVaultPath(env);
    const plaintext = yaml.stringify(data);
    const encrypted = encrypt(plaintext, key);
    const content = yaml.stringify(encrypted as unknown as Record<string, unknown>);

    await fs.writeFile(vaultPath, content, { mode: 0o600 });
  }

  /**
   * Clear sensitive data from memory.
   */
  function clearMemory(): void {
    if (currentKey) {
      currentKey.fill(0);
      currentKey = null;
    }
    secrets = {};
    currentEnv = null;
  }

  const vault: SecretsVault = {
    async init(env: string, masterPassword: string): Promise<void> {
      // Clear any previous state
      clearMemory();

      await ensureDirectories();

      // Generate or load key
      const keyPath = getKeyPath(env);
      let key: Buffer;

      try {
        const keyData = await fs.readFile(keyPath, 'utf8');
        // Key file format: salt (64 hex chars) + key (64 hex chars)
        const keyHex = keyData.slice(SALT_LENGTH * 2); // Skip salt, get key
        key = Buffer.from(keyHex, 'hex');
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          // Generate new key from master password
          const salt = crypto.randomBytes(SALT_LENGTH);
          key = deriveKey(masterPassword, salt);

          // Save key (hex encoded) with salt prefix
          const keyContent = salt.toString('hex') + key.toString('hex');
          await fs.writeFile(keyPath, keyContent, { mode: 0o600 });
        } else {
          throw error;
        }
      }

      currentEnv = env;
      currentKey = key;
      secrets = await loadVault(env, key);
    },

    async get(key: string): Promise<string | undefined> {
      if (!currentEnv || !currentKey) {
        throw new Error('Vault not initialized. Call init() first.');
      }
      return secrets[key];
    },

    async set(key: string, value: string): Promise<void> {
      if (!currentEnv || !currentKey) {
        throw new Error('Vault not initialized. Call init() first.');
      }

      secrets[key] = value;
      await saveVault(currentEnv, currentKey, secrets);
    },

    async list(): Promise<string[]> {
      if (!currentEnv || !currentKey) {
        throw new Error('Vault not initialized. Call init() first.');
      }
      return Object.keys(secrets);
    },

    async delete(key: string): Promise<void> {
      if (!currentEnv || !currentKey) {
        throw new Error('Vault not initialized. Call init() first.');
      }

      delete secrets[key];
      await saveVault(currentEnv, currentKey, secrets);
    },
  };

  return vault;
}

export default createVault;
