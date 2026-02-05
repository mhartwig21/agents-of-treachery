/**
 * Encrypted secrets vault module.
 *
 * Provides secure storage for secrets using AES-256-GCM encryption.
 * Supports multiple environments (dev, staging, prod).
 *
 * @example
 * ```typescript
 * import { createVault } from './secrets';
 *
 * const vault = createVault();
 * await vault.init('dev', 'master-password');
 *
 * await vault.set('API_KEY', 'sk-xxx');
 * const key = await vault.get('API_KEY');
 * const keys = await vault.list();
 * await vault.delete('API_KEY');
 * ```
 */

export { createVault, type SecretsVault, type VaultOptions } from './vault';
export * as yaml from './yaml-parser';
