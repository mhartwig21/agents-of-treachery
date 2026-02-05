import * as crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
const PBKDF2_ITERATIONS = 100000;

export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
}

export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH);
}

export function generateIV(): Buffer {
  return crypto.randomBytes(IV_LENGTH);
}

export interface EncryptResult {
  encrypted: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function encrypt(data: string, key: Buffer): EncryptResult {
  const iv = generateIV();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(data, 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return { encrypted, iv, authTag };
}

export function decrypt(encrypted: Buffer, key: Buffer, iv: Buffer, authTag: Buffer): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]);

  return decrypted.toString('utf8');
}
