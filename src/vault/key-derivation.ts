/**
 * Secure key derivation using Argon2id.
 *
 * Implements memory-hard key derivation with OWASP-recommended parameters.
 * Uses WebCrypto for AES-256-GCM encryption of the DEK.
 */

import { argon2id } from '@noble/hashes/argon2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import {
  type Argon2Params,
  type EncryptedDEK,
  type KeyDerivation,
  DEFAULT_ARGON2_PARAMS,
} from './types';

/** Salt length in bytes (128 bits) */
const SALT_LENGTH = 16;

/** Nonce length for AES-GCM (96 bits) */
const NONCE_LENGTH = 12;

/** Get the Web Crypto API (works in browser and Node.js 18+) */
function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined') {
    return globalThis.crypto;
  }
  // Node.js fallback
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:crypto').webcrypto as Crypto;
}

/**
 * Derive a cryptographic key from a password using Argon2id.
 *
 * @param password - User's master password
 * @param salt - Random salt (should be unique per vault)
 * @param params - Argon2id parameters (uses OWASP defaults if not specified)
 * @returns CryptoKey suitable for AES-256-GCM encryption
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  // Run Argon2id key derivation
  const derivedBytes = argon2id(passwordBytes, salt, {
    t: params.iterations,
    m: params.memory,
    p: params.parallelism,
    dkLen: params.keyLength,
  });

  // Import as AES-256-GCM key
  const crypto = getCrypto();
  return crypto.subtle.importKey(
    'raw',
    derivedBytes as BufferSource,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}

/**
 * Generate a cryptographically secure random salt.
 *
 * @returns 16-byte random salt
 */
export function generateSalt(): Uint8Array {
  return randomBytes(SALT_LENGTH);
}

/**
 * Generate a new Data Encryption Key (DEK).
 *
 * @returns A new AES-256-GCM key for encrypting vault secrets
 */
export async function generateDEK(): Promise<CryptoKey> {
  const crypto = getCrypto();
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // extractable (needed for wrapping)
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt the DEK using the KEK (derived from master password).
 *
 * Uses AES-256-GCM for authenticated encryption.
 *
 * @param dek - Data Encryption Key to encrypt
 * @param kek - Key Encryption Key (derived from password)
 * @returns Encrypted DEK with nonce and auth tag
 */
export async function encryptDEK(
  dek: CryptoKey,
  kek: CryptoKey
): Promise<EncryptedDEK> {
  const crypto = getCrypto();
  // Copy to ensure standard ArrayBuffer (randomBytes may return SharedArrayBuffer)
  const nonce = new Uint8Array(randomBytes(NONCE_LENGTH));

  // Export DEK as raw bytes, then encrypt with KEK
  const dekBytes = await crypto.subtle.exportKey('raw', dek);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    kek,
    dekBytes
  );

  // AES-GCM appends the 16-byte auth tag to ciphertext
  const encryptedArray = new Uint8Array(encrypted);
  const ciphertext = encryptedArray.slice(0, -16);
  const tag = encryptedArray.slice(-16);

  return { ciphertext, nonce, tag };
}

/**
 * Decrypt the DEK using the KEK.
 *
 * @param encrypted - Encrypted DEK with nonce and auth tag
 * @param kek - Key Encryption Key (derived from password)
 * @returns Decrypted Data Encryption Key
 * @throws Error if decryption fails (wrong password or tampered data)
 */
export async function decryptDEK(
  encrypted: EncryptedDEK,
  kek: CryptoKey
): Promise<CryptoKey> {
  const crypto = getCrypto();

  // Reconstruct the ciphertext+tag format expected by WebCrypto
  const combined = new Uint8Array(
    encrypted.ciphertext.length + encrypted.tag.length
  );
  combined.set(encrypted.ciphertext, 0);
  combined.set(encrypted.tag, encrypted.ciphertext.length);

  const dekBytes = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encrypted.nonce as BufferSource },
    kek,
    combined as BufferSource
  );

  // Import as AES-256-GCM key
  return crypto.subtle.importKey(
    'raw',
    dekBytes,
    { name: 'AES-GCM', length: 256 },
    true, // extractable for future rotation
    ['encrypt', 'decrypt']
  );
}

/**
 * Rotate the DEK by re-encrypting with a new KEK.
 *
 * This allows password changes without re-encrypting all secrets:
 * 1. Decrypt DEK with old KEK
 * 2. Re-encrypt DEK with new KEK
 *
 * @param encrypted - Current encrypted DEK
 * @param oldKek - Current KEK (from old password)
 * @param newKek - New KEK (from new password)
 * @returns Newly encrypted DEK
 */
export async function rotateDEK(
  encrypted: EncryptedDEK,
  oldKek: CryptoKey,
  newKek: CryptoKey
): Promise<EncryptedDEK> {
  const dek = await decryptDEK(encrypted, oldKek);
  return encryptDEK(dek, newKek);
}

/** Full KeyDerivation interface implementation */
export const keyDerivation: KeyDerivation = {
  deriveKey,
  generateSalt,
  encryptDEK,
  decryptDEK,
};
