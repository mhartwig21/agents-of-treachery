/**
 * AES-256-GCM encryption for vault secrets.
 *
 * Uses the DEK (Data Encryption Key) to encrypt individual secrets.
 */

import { randomBytes } from '@noble/hashes/utils.js';

/** Nonce length for AES-GCM (96 bits) */
const NONCE_LENGTH = 12;

/** Encrypted secret with metadata */
export interface EncryptedSecret {
  /** AES-256-GCM ciphertext */
  ciphertext: Uint8Array;
  /** 12-byte nonce */
  nonce: Uint8Array;
  /** 16-byte authentication tag */
  tag: Uint8Array;
}

/** Get the Web Crypto API */
function getCrypto(): Crypto {
  if (typeof globalThis.crypto !== 'undefined') {
    return globalThis.crypto;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('node:crypto').webcrypto as Crypto;
}

/**
 * Encrypt a secret value using the DEK.
 *
 * @param secret - Secret value to encrypt (string or bytes)
 * @param dek - Data Encryption Key
 * @returns Encrypted secret with nonce and auth tag
 */
export async function encryptSecret(
  secret: string | Uint8Array,
  dek: CryptoKey
): Promise<EncryptedSecret> {
  const crypto = getCrypto();
  // Copy to ensure standard ArrayBuffer (randomBytes may return SharedArrayBuffer)
  const nonce = new Uint8Array(randomBytes(NONCE_LENGTH));

  const secretBytes =
    typeof secret === 'string'
      ? new TextEncoder().encode(secret)
      : new Uint8Array(secret);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource },
    dek,
    secretBytes as BufferSource
  );

  const encryptedArray = new Uint8Array(encrypted);
  const ciphertext = encryptedArray.slice(0, -16);
  const tag = encryptedArray.slice(-16);

  return { ciphertext, nonce, tag };
}

/**
 * Decrypt a secret value using the DEK.
 *
 * @param encrypted - Encrypted secret
 * @param dek - Data Encryption Key
 * @returns Decrypted secret as bytes
 * @throws Error if decryption fails (wrong key or tampered data)
 */
export async function decryptSecret(
  encrypted: EncryptedSecret,
  dek: CryptoKey
): Promise<Uint8Array> {
  const crypto = getCrypto();

  const combined = new Uint8Array(
    encrypted.ciphertext.length + encrypted.tag.length
  );
  combined.set(encrypted.ciphertext, 0);
  combined.set(encrypted.tag, encrypted.ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encrypted.nonce as BufferSource },
    dek,
    combined as BufferSource
  );

  return new Uint8Array(decrypted);
}

/**
 * Decrypt a secret and return as string.
 *
 * @param encrypted - Encrypted secret
 * @param dek - Data Encryption Key
 * @returns Decrypted secret as UTF-8 string
 */
export async function decryptSecretAsString(
  encrypted: EncryptedSecret,
  dek: CryptoKey
): Promise<string> {
  const bytes = await decryptSecret(encrypted, dek);
  return new TextDecoder().decode(bytes);
}
