/**
 * Runtime Secrets Injection Module.
 *
 * Provides secure runtime loading of secrets into applications.
 * Secrets are loaded at startup, not baked into builds.
 *
 * Three injection methods:
 * 1. Environment variables (loadSecretsToEnv) - loaded once at start
 * 2. In-memory provider (createSecretsProvider) - supports rotation without restart
 * 3. File-based (writeSecretsFile) - for containers expecting mounted secrets
 *
 * @example
 * // Option 1: One-time load to process.env
 * await loadSecretsToEnv({ env: 'prod', password: process.env.VAULT_PASSWORD });
 *
 * // Option 2: Dynamic provider (supports rotation)
 * const secrets = await createSecretsProvider({ env: 'prod', password: '...' });
 * const dbUrl = await secrets.get('DATABASE_URL');
 * secrets.onRotation('DATABASE_URL', (newValue) => reconnectDb(newValue));
 *
 * // Option 3: Write to file for container consumption
 * await writeSecretsFile('/run/secrets/app.env', { env: 'prod', password: '...', format: 'env' });
 */

import * as fs from 'fs';
import type {
  VaultConfig,
  SecretsProvider,
  WriteSecretsOptions,
  RotationCallback,
} from './types';
import { loadVault, secureWipeObject } from './vault';

// Re-export types
export type {
  VaultConfig,
  SecretsProvider,
  WriteSecretsOptions,
  RotationCallback,
  SecretValue,
  SecretsFileFormat,
  EncryptedVault,
  VaultData,
} from './types';

// Re-export vault utilities for advanced use cases
export { encryptVault, decryptVault, saveVault, getDefaultVaultPath } from './vault';

/**
 * Load secrets from a vault directly into process.env.
 *
 * This is a one-time load - secrets are copied to process.env and the
 * vault data is cleared from memory. Use createSecretsProvider if you
 * need rotation support.
 *
 * @param config - Vault configuration
 * @returns List of keys that were loaded
 *
 * @example
 * // At application startup
 * await loadSecretsToEnv({
 *   env: 'prod',
 *   password: process.env.VAULT_PASSWORD  // From secure source
 * });
 *
 * // Now use secrets via process.env
 * const dbUrl = process.env.DATABASE_URL;
 */
export async function loadSecretsToEnv(config: VaultConfig): Promise<string[]> {
  const vaultData = await loadVault(config);
  const loadedKeys: string[] = [];

  try {
    for (const [key, value] of Object.entries(vaultData.secrets)) {
      process.env[key] = value;
      loadedKeys.push(key);
    }
    return loadedKeys;
  } finally {
    // Clear secrets from memory
    secureWipeObject(vaultData.secrets);
  }
}

/**
 * Create a dynamic secrets provider that supports runtime rotation.
 *
 * The provider keeps secrets in memory and allows registering callbacks
 * for when secrets are rotated. Call close() when done to clear secrets
 * from memory.
 *
 * @param config - Vault configuration
 * @returns SecretsProvider instance
 *
 * @example
 * const secrets = await createSecretsProvider({
 *   env: 'prod',
 *   password: process.env.VAULT_PASSWORD
 * });
 *
 * // Get a secret
 * const dbUrl = await secrets.get('DATABASE_URL');
 *
 * // Register for rotation updates
 * const unsubscribe = secrets.onRotation('DATABASE_URL', (newValue) => {
 *   reconnectDatabase(newValue);
 * });
 *
 * // Later: manually check for rotated secrets
 * await secrets.refresh();
 *
 * // When done: clear secrets from memory
 * secrets.close();
 */
export async function createSecretsProvider(config: VaultConfig): Promise<SecretsProvider> {
  const vaultData = await loadVault(config);
  let secrets = { ...vaultData.secrets };
  let closed = false;
  const rotationCallbacks = new Map<string, Set<RotationCallback>>();

  // Save config for refresh (but not the password in case it changes)
  const savedConfig = { ...config };

  function assertOpen(): void {
    if (closed) {
      throw new Error('SecretsProvider has been closed');
    }
  }

  const provider: SecretsProvider = {
    async get(key: string): Promise<string> {
      assertOpen();
      const value = secrets[key];
      if (value === undefined) {
        throw new Error(`Secret not found: ${key}`);
      }
      return value;
    },

    async getOptional(key: string): Promise<string | undefined> {
      assertOpen();
      return secrets[key];
    },

    async has(key: string): Promise<boolean> {
      assertOpen();
      return key in secrets;
    },

    onRotation(key: string, callback: RotationCallback): () => void {
      assertOpen();
      if (!rotationCallbacks.has(key)) {
        rotationCallbacks.set(key, new Set());
      }
      rotationCallbacks.get(key)!.add(callback);

      // Return unsubscribe function
      return () => {
        const callbacks = rotationCallbacks.get(key);
        if (callbacks) {
          callbacks.delete(callback);
          if (callbacks.size === 0) {
            rotationCallbacks.delete(key);
          }
        }
      };
    },

    async refresh(): Promise<void> {
      assertOpen();

      // Reload vault data
      const newVaultData = await loadVault(savedConfig);
      const newSecrets = newVaultData.secrets;

      // Find rotated secrets and notify callbacks
      for (const [key, newValue] of Object.entries(newSecrets)) {
        const oldValue = secrets[key];
        if (oldValue !== newValue) {
          const callbacks = rotationCallbacks.get(key);
          if (callbacks) {
            for (const callback of callbacks) {
              try {
                callback(newValue);
              } catch {
                // Ignore callback errors
              }
            }
          }
        }
      }

      // Clear old secrets and update
      secureWipeObject(secrets);
      secrets = newSecrets;
    },

    close(): void {
      if (!closed) {
        closed = true;
        secureWipeObject(secrets);
        rotationCallbacks.clear();
      }
    },
  };

  return provider;
}

/**
 * Write secrets to a file for container consumption.
 *
 * This is useful for containers that expect secrets to be mounted as files.
 * The file is written with restrictive permissions (0400 on Unix).
 *
 * @param filePath - Path to write the secrets file
 * @param options - Configuration options
 *
 * @example
 * // Write as .env format
 * await writeSecretsFile('/run/secrets/app.env', {
 *   env: 'prod',
 *   password: process.env.VAULT_PASSWORD,
 *   format: 'env'
 * });
 *
 * // Write as JSON format
 * await writeSecretsFile('/run/secrets/app.json', {
 *   env: 'prod',
 *   password: process.env.VAULT_PASSWORD,
 *   format: 'json'
 * });
 *
 * // Write only specific keys
 * await writeSecretsFile('/run/secrets/db.env', {
 *   env: 'prod',
 *   password: process.env.VAULT_PASSWORD,
 *   format: 'env',
 *   keys: ['DATABASE_URL', 'DATABASE_PASSWORD']
 * });
 */
export async function writeSecretsFile(
  filePath: string,
  options: WriteSecretsOptions
): Promise<void> {
  const vaultData = await loadVault({
    env: options.env,
    password: options.password,
    vaultPath: options.vaultPath,
  });

  try {
    // Filter secrets if specific keys requested
    let secretsToWrite = vaultData.secrets;
    if (options.keys && options.keys.length > 0) {
      secretsToWrite = {};
      for (const key of options.keys) {
        if (key in vaultData.secrets) {
          secretsToWrite[key] = vaultData.secrets[key];
        }
      }
    }

    // Format the content
    let content: string;
    if (options.format === 'json') {
      content = JSON.stringify(secretsToWrite, null, 2);
    } else {
      // env format
      const lines: string[] = [];
      for (const [key, value] of Object.entries(secretsToWrite)) {
        // Escape special characters in value
        const escapedValue = value
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n');
        lines.push(`${key}="${escapedValue}"`);
      }
      content = lines.join('\n') + '\n';
    }

    // Write file with restrictive permissions (0400 = owner read only)
    await fs.promises.writeFile(filePath, content, { mode: 0o400 });
  } finally {
    // Clear secrets from memory
    secureWipeObject(vaultData.secrets);
  }
}

/**
 * Validate that VAULT_PASSWORD comes from a secure source.
 *
 * The password should NOT come from a .env file in the project.
 * Acceptable sources:
 * - Environment variable set by container orchestrator
 * - Systemd service environment
 * - Cloud secrets manager
 * - TTY input (for interactive use)
 *
 * @param password - The vault password to validate
 * @throws Error if password appears to come from an insecure source
 */
export function validatePasswordSource(password: string | undefined): asserts password is string {
  if (!password) {
    throw new Error(
      'VAULT_PASSWORD is required. ' +
        'Set it via your deployment environment, container orchestrator, or systemd service. ' +
        'Do NOT store it in .env files.'
    );
  }

  // Note: We cannot truly verify where the password came from,
  // but we can at least ensure it's not empty or a placeholder
  if (password === 'CHANGE_ME' || password === 'password' || password.length < 8) {
    throw new Error(
      'VAULT_PASSWORD appears to be a placeholder or too short. ' +
        'Use a strong, randomly generated password.'
    );
  }
}
