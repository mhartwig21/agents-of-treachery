/**
 * Vault key derivation and encryption types.
 *
 * Key Hierarchy:
 *   Master Password
 *       ↓ (Argon2id)
 *   Master Key (KEK - Key Encryption Key)
 *       ↓ (AES-256-GCM)
 *   Data Encryption Key (DEK) - stored encrypted in vault header
 *       ↓ (AES-256-GCM)
 *   Individual Secrets
 */

/** Argon2id parameters for key derivation */
export interface Argon2Params {
  /** Memory cost in KiB (default: 65536 = 64MB) */
  memory: number;
  /** Time cost / iterations (default: 3) */
  iterations: number;
  /** Parallelism degree (default: 4) */
  parallelism: number;
  /** Output key length in bytes (default: 32 for AES-256) */
  keyLength: number;
}

/** Default OWASP-recommended Argon2id parameters */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = {
  memory: 65536, // 64 MB
  iterations: 3,
  parallelism: 4,
  keyLength: 32, // 256 bits for AES-256
};

/** Encrypted DEK with its nonce for storage */
export interface EncryptedDEK {
  /** AES-256-GCM encrypted DEK */
  ciphertext: Uint8Array;
  /** 12-byte nonce used for encryption */
  nonce: Uint8Array;
  /** 16-byte authentication tag */
  tag: Uint8Array;
}

/** Vault header containing key derivation metadata */
export interface VaultHeader {
  /** Version for future format changes */
  version: 1;
  /** Random salt for Argon2id (16 bytes) */
  salt: Uint8Array;
  /** Argon2id parameters used */
  kdfParams: Argon2Params;
  /** Encrypted DEK */
  encryptedDEK: EncryptedDEK;
}

/** Key derivation operations interface */
export interface KeyDerivation {
  /** Derive a key from password using Argon2id */
  deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey>;
  /** Generate a random salt */
  generateSalt(): Uint8Array;
  /** Encrypt DEK with KEK */
  encryptDEK(dek: CryptoKey, kek: CryptoKey): Promise<EncryptedDEK>;
  /** Decrypt DEK with KEK */
  decryptDEK(encrypted: EncryptedDEK, kek: CryptoKey): Promise<CryptoKey>;
}
