/**
 * Vault key derivation and encryption module.
 *
 * Provides secure key management with a proper key hierarchy:
 *
 * ```
 * Master Password
 *     ↓ (Argon2id, OWASP params: 64MB, 3 iterations, 4 threads)
 * Master Key (KEK - Key Encryption Key)
 *     ↓ (AES-256-GCM)
 * Data Encryption Key (DEK) - stored encrypted in vault header
 *     ↓ (AES-256-GCM)
 * Individual Secrets
 * ```
 *
 * Benefits:
 * - Password change only re-encrypts DEK, not all secrets
 * - Can support multiple authorized users
 * - DEK rotation independent of password
 *
 * @example
 * ```typescript
 * import {
 *   deriveKey,
 *   generateSalt,
 *   generateDEK,
 *   encryptDEK,
 *   decryptDEK,
 *   encryptSecret,
 *   decryptSecretAsString,
 * } from './vault';
 *
 * // Initial vault creation
 * const salt = generateSalt();
 * const kek = await deriveKey('master-password', salt);
 * const dek = await generateDEK();
 * const encryptedDEK = await encryptDEK(dek, kek);
 *
 * // Store salt + encryptedDEK in vault header
 *
 * // Encrypt secrets
 * const encrypted = await encryptSecret('my-api-key', dek);
 *
 * // Later: unlock vault
 * const kek2 = await deriveKey('master-password', salt);
 * const dek2 = await decryptDEK(encryptedDEK, kek2);
 * const secret = await decryptSecretAsString(encrypted, dek2);
 * ```
 */

export {
  deriveKey,
  generateSalt,
  generateDEK,
  encryptDEK,
  decryptDEK,
  rotateDEK,
  keyDerivation,
} from './key-derivation';

export {
  encryptSecret,
  decryptSecret,
  decryptSecretAsString,
  type EncryptedSecret,
} from './encryption';

export {
  type Argon2Params,
  type EncryptedDEK,
  type VaultHeader,
  type KeyDerivation,
  DEFAULT_ARGON2_PARAMS,
} from './types';
