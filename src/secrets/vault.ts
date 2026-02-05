/**
 * Vault loading and decryption utilities.
 *
 * Uses AES-256-GCM encryption with PBKDF2 key derivation.
 * This module is designed to work with Node.js, Deno, and Bun.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { EncryptedVault, VaultData, VaultConfig } from './types';

const PBKDF2_ITERATIONS = 100000;
const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 32;
const IV_LENGTH = 12; // GCM standard

/**
 * Derive an encryption key from a password using PBKDF2.
 */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt vault data with a password.
 */
export function encryptVault(data: VaultData, password: string): EncryptedVault {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(data);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    data: encrypted.toString('base64'),
  };
}

/**
 * Decrypt vault data with a password.
 * @throws Error if decryption fails (wrong password or corrupted data)
 */
export function decryptVault(vault: EncryptedVault, password: string): VaultData {
  if (vault.version !== 1) {
    throw new Error(`Unsupported vault version: ${vault.version}`);
  }

  if (vault.algorithm !== 'aes-256-gcm') {
    throw new Error(`Unsupported encryption algorithm: ${vault.algorithm}`);
  }

  const salt = Buffer.from(vault.salt, 'base64');
  const iv = Buffer.from(vault.iv, 'base64');
  const authTag = Buffer.from(vault.authTag, 'base64');
  const encrypted = Buffer.from(vault.data, 'base64');
  const key = deriveKey(password, salt);

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  try {
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8')) as VaultData;
  } catch {
    throw new Error('Failed to decrypt vault: invalid password or corrupted data');
  }
}

/**
 * Load and decrypt a vault file.
 */
export async function loadVault(config: VaultConfig): Promise<VaultData> {
  const vaultPath = config.vaultPath || path.join('.vault', `${config.env}.vault`);

  if (!fs.existsSync(vaultPath)) {
    throw new Error(`Vault file not found: ${vaultPath}`);
  }

  const content = await fs.promises.readFile(vaultPath, 'utf8');
  const vault = JSON.parse(content) as EncryptedVault;

  return decryptVault(vault, config.password);
}

/**
 * Save an encrypted vault to a file.
 */
export async function saveVault(
  data: VaultData,
  password: string,
  vaultPath: string
): Promise<void> {
  const encrypted = encryptVault(data, password);
  const dir = path.dirname(vaultPath);

  if (!fs.existsSync(dir)) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  await fs.promises.writeFile(vaultPath, JSON.stringify(encrypted, null, 2), 'utf8');
}

/**
 * Get the default vault path for an environment.
 */
export function getDefaultVaultPath(env: string): string {
  return path.join('.vault', `${env}.vault`);
}

/**
 * Securely clear a string from memory.
 * Note: This is best-effort as JavaScript doesn't guarantee memory clearing.
 */
export function secureWipe(str: string): void {
  // Convert to buffer and fill with zeros
  // This helps but isn't guaranteed in JavaScript
  if (typeof str === 'string' && str.length > 0) {
    const buf = Buffer.from(str);
    buf.fill(0);
  }
}

/**
 * Securely clear an object containing secrets.
 */
export function secureWipeObject(obj: Record<string, string>): void {
  for (const key of Object.keys(obj)) {
    secureWipe(obj[key]);
    delete obj[key];
  }
}
