import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveKey,
  generateSalt,
  generateDEK,
  encryptDEK,
  decryptDEK,
  rotateDEK,
} from '../key-derivation';
import { DEFAULT_ARGON2_PARAMS, type Argon2Params } from '../types';
import { encryptSecret, decryptSecretAsString } from '../encryption';

/**
 * Fast Argon2 parameters for testing.
 * OWASP params are too slow for unit tests (10-15s per derivation).
 */
const FAST_TEST_PARAMS: Argon2Params = {
  memory: 1024, // 1 MB (vs 64 MB in production)
  iterations: 1, // 1 iteration (vs 3 in production)
  parallelism: 1,
  keyLength: 32,
};

describe('Key Derivation', () => {
  describe('generateSalt', () => {
    it('should generate a 16-byte salt', () => {
      const salt = generateSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(16);
    });

    it('should generate unique salts', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toEqual(salt2);
    });
  });

  describe('deriveKey', () => {
    it('should derive a CryptoKey from password and salt', async () => {
      const password = 'test-password';
      const salt = generateSalt();

      const key = await deriveKey(password, salt, FAST_TEST_PARAMS);

      expect(key).toBeDefined();
      expect(key.algorithm.name).toBe('AES-GCM');
      expect(key.usages).toContain('encrypt');
      expect(key.usages).toContain('decrypt');
    });

    it('should derive consistent keys for same password and salt', async () => {
      const password = 'test-password';
      const salt = generateSalt();

      // Derive same key twice and verify they can decrypt each other's data
      const key1 = await deriveKey(password, salt, FAST_TEST_PARAMS);
      const key2 = await deriveKey(password, salt, FAST_TEST_PARAMS);

      const dek = await generateDEK();
      const encrypted = await encryptDEK(dek, key1);

      // key2 should be able to decrypt what key1 encrypted
      const decrypted = await decryptDEK(encrypted, key2);
      expect(decrypted).toBeDefined();
    });

    it('should derive different keys for different passwords', async () => {
      const salt = generateSalt();

      const key1 = await deriveKey('password1', salt, FAST_TEST_PARAMS);
      const key2 = await deriveKey('password2', salt, FAST_TEST_PARAMS);

      const dek = await generateDEK();
      const encrypted = await encryptDEK(dek, key1);

      // key2 should NOT be able to decrypt what key1 encrypted
      await expect(decryptDEK(encrypted, key2)).rejects.toThrow();
    });

    it('should derive different keys for different salts', async () => {
      const password = 'test-password';

      const key1 = await deriveKey(password, generateSalt(), FAST_TEST_PARAMS);
      const key2 = await deriveKey(password, generateSalt(), FAST_TEST_PARAMS);

      const dek = await generateDEK();
      const encrypted = await encryptDEK(dek, key1);

      // key2 should NOT be able to decrypt what key1 encrypted
      await expect(decryptDEK(encrypted, key2)).rejects.toThrow();
    });

    it('should use OWASP-recommended parameters by default', () => {
      expect(DEFAULT_ARGON2_PARAMS.memory).toBe(65536); // 64 MB
      expect(DEFAULT_ARGON2_PARAMS.iterations).toBe(3);
      expect(DEFAULT_ARGON2_PARAMS.parallelism).toBe(4);
      expect(DEFAULT_ARGON2_PARAMS.keyLength).toBe(32);
    });

    it(
      'should take measurable time for key derivation with production params',
      async () => {
        const password = 'test-password';
        const salt = generateSalt();

        const start = performance.now();
        await deriveKey(password, salt); // Uses DEFAULT_ARGON2_PARAMS
        const elapsed = performance.now() - start;

        // Should take at least 100ms with OWASP params
        // (0.5-1s target, but allow lower for CI)
        expect(elapsed).toBeGreaterThan(100);
      },
      30000
    );
  });

  describe('generateDEK', () => {
    it('should generate a CryptoKey', async () => {
      const dek = await generateDEK();

      expect(dek).toBeDefined();
      expect(dek.algorithm.name).toBe('AES-GCM');
      expect(dek.usages).toContain('encrypt');
      expect(dek.usages).toContain('decrypt');
      expect(dek.extractable).toBe(true);
    });
  });

  describe('encryptDEK / decryptDEK', () => {
    let kek: CryptoKey;
    let dek: CryptoKey;

    beforeEach(async () => {
      const salt = generateSalt();
      kek = await deriveKey('test-password', salt, FAST_TEST_PARAMS);
      dek = await generateDEK();
    });

    it('should encrypt DEK', async () => {
      const encrypted = await encryptDEK(dek, kek);

      expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
      expect(encrypted.tag).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce.length).toBe(12);
      expect(encrypted.tag.length).toBe(16);
    });

    it('should decrypt DEK correctly', async () => {
      const encrypted = await encryptDEK(dek, kek);
      const decrypted = await decryptDEK(encrypted, kek);

      // Verify by encrypting a secret with original and decrypting with recovered
      const secret = 'test-secret-12345';
      const encryptedSecret = await encryptSecret(secret, dek);
      const recoveredSecret = await decryptSecretAsString(
        encryptedSecret,
        decrypted
      );

      expect(recoveredSecret).toBe(secret);
    });

    it('should fail decryption with wrong KEK', async () => {
      const encrypted = await encryptDEK(dek, kek);

      const wrongKek = await deriveKey(
        'wrong-password',
        generateSalt(),
        FAST_TEST_PARAMS
      );

      await expect(decryptDEK(encrypted, wrongKek)).rejects.toThrow();
    });

    it('should fail decryption with tampered ciphertext', async () => {
      const encrypted = await encryptDEK(dek, kek);

      // Tamper with ciphertext
      encrypted.ciphertext[0] ^= 0xff;

      await expect(decryptDEK(encrypted, kek)).rejects.toThrow();
    });

    it('should fail decryption with tampered tag', async () => {
      const encrypted = await encryptDEK(dek, kek);

      // Tamper with auth tag
      encrypted.tag[0] ^= 0xff;

      await expect(decryptDEK(encrypted, kek)).rejects.toThrow();
    });
  });

  describe('rotateDEK', () => {
    it('should rotate DEK to new password without losing data', async () => {
      const oldSalt = generateSalt();
      const newSalt = generateSalt();

      const oldKek = await deriveKey('old-password', oldSalt, FAST_TEST_PARAMS);
      const newKek = await deriveKey('new-password', newSalt, FAST_TEST_PARAMS);
      const dek = await generateDEK();

      // Encrypt some data with the DEK first
      const secret = 'my-important-secret';
      const encryptedSecret = await encryptSecret(secret, dek);

      // Encrypt DEK with old password
      const encrypted = await encryptDEK(dek, oldKek);

      // Rotate to new password
      const rotated = await rotateDEK(encrypted, oldKek, newKek);

      // Decrypt with new password
      const decrypted = await decryptDEK(rotated, newKek);

      // Should still be able to decrypt original secret
      const recoveredSecret = await decryptSecretAsString(
        encryptedSecret,
        decrypted
      );
      expect(recoveredSecret).toBe(secret);
    });

    it('should not work with old password after rotation', async () => {
      const oldSalt = generateSalt();
      const newSalt = generateSalt();

      const oldKek = await deriveKey('old-password', oldSalt, FAST_TEST_PARAMS);
      const newKek = await deriveKey('new-password', newSalt, FAST_TEST_PARAMS);
      const dek = await generateDEK();

      const encrypted = await encryptDEK(dek, oldKek);
      const rotated = await rotateDEK(encrypted, oldKek, newKek);

      // Old password should not decrypt rotated DEK
      await expect(decryptDEK(rotated, oldKek)).rejects.toThrow();
    });
  });
});
