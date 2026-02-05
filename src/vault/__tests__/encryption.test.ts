import { describe, it, expect, beforeEach } from 'vitest';
import { generateDEK } from '../key-derivation';
import {
  encryptSecret,
  decryptSecret,
  decryptSecretAsString,
} from '../encryption';

describe('Secret Encryption', () => {
  let dek: CryptoKey;

  beforeEach(async () => {
    dek = await generateDEK();
  });

  describe('encryptSecret', () => {
    it('should encrypt a string secret', async () => {
      const encrypted = await encryptSecret('my-api-key', dek);

      expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
      expect(encrypted.tag).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce.length).toBe(12);
      expect(encrypted.tag.length).toBe(16);
    });

    it('should encrypt bytes', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const encrypted = await encryptSecret(data, dek);

      expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
    });

    it('should produce different ciphertexts for same plaintext (unique nonce)', async () => {
      const secret = 'same-secret';

      const encrypted1 = await encryptSecret(secret, dek);
      const encrypted2 = await encryptSecret(secret, dek);

      expect(encrypted1.nonce).not.toEqual(encrypted2.nonce);
      expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
    });
  });

  describe('decryptSecret', () => {
    it('should decrypt to original bytes', async () => {
      const original = new Uint8Array([10, 20, 30, 40, 50]);
      const encrypted = await encryptSecret(original, dek);

      const decrypted = await decryptSecret(encrypted, dek);

      expect(decrypted).toEqual(original);
    });

    it('should fail with wrong DEK', async () => {
      const encrypted = await encryptSecret('secret', dek);
      const wrongDek = await generateDEK();

      await expect(decryptSecret(encrypted, wrongDek)).rejects.toThrow();
    });

    it('should fail with tampered ciphertext', async () => {
      const encrypted = await encryptSecret('secret', dek);
      encrypted.ciphertext[0] ^= 0xff;

      await expect(decryptSecret(encrypted, dek)).rejects.toThrow();
    });

    it('should fail with tampered nonce', async () => {
      const encrypted = await encryptSecret('secret', dek);
      encrypted.nonce[0] ^= 0xff;

      await expect(decryptSecret(encrypted, dek)).rejects.toThrow();
    });

    it('should fail with tampered tag', async () => {
      const encrypted = await encryptSecret('secret', dek);
      encrypted.tag[0] ^= 0xff;

      await expect(decryptSecret(encrypted, dek)).rejects.toThrow();
    });
  });

  describe('decryptSecretAsString', () => {
    it('should decrypt to original string', async () => {
      const original = 'my-secret-api-key-12345';
      const encrypted = await encryptSecret(original, dek);

      const decrypted = await decryptSecretAsString(encrypted, dek);

      expect(decrypted).toBe(original);
    });

    it('should handle unicode strings', async () => {
      const original = 'secret-with-émojis-🔐-and-中文';
      const encrypted = await encryptSecret(original, dek);

      const decrypted = await decryptSecretAsString(encrypted, dek);

      expect(decrypted).toBe(original);
    });

    it('should handle empty string', async () => {
      const encrypted = await encryptSecret('', dek);
      const decrypted = await decryptSecretAsString(encrypted, dek);

      expect(decrypted).toBe('');
    });

    it('should handle long strings', async () => {
      const original = 'x'.repeat(10000);
      const encrypted = await encryptSecret(original, dek);

      const decrypted = await decryptSecretAsString(encrypted, dek);

      expect(decrypted).toBe(original);
    });
  });

  describe('round-trip encryption', () => {
    it('should encrypt and decrypt multiple secrets with same DEK', async () => {
      const secrets = ['secret1', 'api-key-12345', 'password123'];
      const encrypted = await Promise.all(
        secrets.map((s) => encryptSecret(s, dek))
      );

      const decrypted = await Promise.all(
        encrypted.map((e) => decryptSecretAsString(e, dek))
      );

      expect(decrypted).toEqual(secrets);
    });
  });
});
