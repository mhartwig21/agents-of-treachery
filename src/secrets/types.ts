/**
 * Types for the secrets injection module.
 */

/**
 * Configuration for loading secrets from a vault.
 */
export interface VaultConfig {
  /** Environment name (e.g., 'dev', 'staging', 'prod') */
  env: string;
  /** Password to decrypt the vault */
  password: string;
  /** Optional path to vault file. Defaults to .vault/{env}.vault */
  vaultPath?: string;
}

/**
 * A single secret value with metadata.
 */
export interface SecretValue {
  value: string;
  /** When this secret was last rotated */
  rotatedAt?: Date;
}

/**
 * Callback for secret rotation events.
 */
export type RotationCallback = (newValue: string) => void;

/**
 * Dynamic secrets provider that supports runtime rotation.
 */
export interface SecretsProvider {
  /**
   * Get a secret value by key.
   * @throws Error if secret not found
   */
  get(key: string): Promise<string>;

  /**
   * Get a secret value, returning undefined if not found.
   */
  getOptional(key: string): Promise<string | undefined>;

  /**
   * Check if a secret exists.
   */
  has(key: string): Promise<boolean>;

  /**
   * Register a callback for when a secret is rotated.
   * Returns an unsubscribe function.
   */
  onRotation(key: string, callback: RotationCallback): () => void;

  /**
   * Manually trigger a rotation check.
   * Used when you know secrets have been updated.
   */
  refresh(): Promise<void>;

  /**
   * Close the provider and clear secrets from memory.
   */
  close(): void;
}

/**
 * Format for writing secrets files.
 */
export type SecretsFileFormat = 'env' | 'json';

/**
 * Options for writing secrets to a file.
 */
export interface WriteSecretsOptions {
  /** Environment to load secrets from */
  env: string;
  /** Password to decrypt the vault */
  password: string;
  /** Output format */
  format: SecretsFileFormat;
  /** Optional vault path */
  vaultPath?: string;
  /** Optional list of secret keys to include (default: all) */
  keys?: string[];
}

/**
 * Structure of an encrypted vault file.
 */
export interface EncryptedVault {
  /** Version of the vault format */
  version: 1;
  /** Encryption algorithm used */
  algorithm: 'aes-256-gcm';
  /** Salt for key derivation (base64) */
  salt: string;
  /** Initialization vector (base64) */
  iv: string;
  /** Authentication tag (base64) */
  authTag: string;
  /** Encrypted data (base64) */
  data: string;
}

/**
 * Structure of decrypted vault data.
 */
export interface VaultData {
  /** Secrets as key-value pairs */
  secrets: Record<string, string>;
  /** When this vault was last modified */
  lastModified?: string;
}
