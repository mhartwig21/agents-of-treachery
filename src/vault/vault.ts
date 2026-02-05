import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  VaultConfig,
  EncryptedVault,
  VaultData,
  VaultMetadata,
  SecretEntry,
  AuditLogEntry,
  ExportFormat
} from './types.js';
import {
  deriveKey,
  generateSalt,
  encrypt,
  decrypt
} from './encryption.js';

const VAULT_VERSION = 1;

function getVaultPath(config: VaultConfig): string {
  return path.join(config.vaultDir, `${config.env}.vault`);
}

function getAuditLogPath(config: VaultConfig): string {
  return path.join(config.vaultDir, `${config.env}.audit.log`);
}

function logAudit(config: VaultConfig, entry: Omit<AuditLogEntry, 'timestamp' | 'env'>): void {
  const logPath = getAuditLogPath(config);
  const fullEntry: AuditLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
    env: config.env
  };
  fs.appendFileSync(logPath, JSON.stringify(fullEntry) + '\n');
}

export function vaultExists(config: VaultConfig): boolean {
  return fs.existsSync(getVaultPath(config));
}

export function initVault(config: VaultConfig, password: string): void {
  const vaultPath = getVaultPath(config);

  if (fs.existsSync(vaultPath)) {
    throw new Error(`Vault already exists for environment: ${config.env}`);
  }

  if (!fs.existsSync(config.vaultDir)) {
    fs.mkdirSync(config.vaultDir, { recursive: true });
  }

  const salt = generateSalt();
  const key = deriveKey(password, salt);

  const vaultData: VaultData = { secrets: {} };
  const { encrypted, iv, authTag } = encrypt(JSON.stringify(vaultData), key);

  const now = new Date().toISOString();
  const metadata: VaultMetadata = {
    version: VAULT_VERSION,
    env: config.env,
    createdAt: now,
    updatedAt: now,
    keyCount: 0
  };

  const encryptedVault: EncryptedVault = {
    metadata,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    authTag: authTag.toString('base64')
  };

  fs.writeFileSync(vaultPath, JSON.stringify(encryptedVault, null, 2));
  logAudit(config, { action: 'init' });
}

function loadVault(config: VaultConfig, password: string): { data: VaultData; vault: EncryptedVault } {
  const vaultPath = getVaultPath(config);

  if (!fs.existsSync(vaultPath)) {
    throw new Error(`No vault found for environment: ${config.env}. Run 'secrets init --env ${config.env}' first.`);
  }

  const vault: EncryptedVault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));
  const salt = Buffer.from(vault.salt, 'base64');
  const iv = Buffer.from(vault.iv, 'base64');
  const authTag = Buffer.from(vault.authTag, 'base64');
  const encrypted = Buffer.from(vault.data, 'base64');

  const key = deriveKey(password, salt);

  try {
    const decrypted = decrypt(encrypted, key, iv, authTag);
    return { data: JSON.parse(decrypted), vault };
  } catch {
    throw new Error('Invalid password or corrupted vault');
  }
}

function saveVault(config: VaultConfig, password: string, data: VaultData, existingVault: EncryptedVault): void {
  const vaultPath = getVaultPath(config);
  const salt = Buffer.from(existingVault.salt, 'base64');
  const key = deriveKey(password, salt);

  const { encrypted, iv, authTag } = encrypt(JSON.stringify(data), key);

  const updatedVault: EncryptedVault = {
    ...existingVault,
    metadata: {
      ...existingVault.metadata,
      updatedAt: new Date().toISOString(),
      keyCount: Object.keys(data.secrets).length
    },
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    authTag: authTag.toString('base64')
  };

  fs.writeFileSync(vaultPath, JSON.stringify(updatedVault, null, 2));
}

export function setSecret(config: VaultConfig, password: string, key: string, value: string): void {
  const { data, vault } = loadVault(config, password);

  const now = new Date().toISOString();
  const existing = data.secrets[key];

  const entry: SecretEntry = {
    value,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  data.secrets[key] = entry;
  saveVault(config, password, data, vault);
  logAudit(config, { action: 'set', key });
}

export function getSecret(config: VaultConfig, password: string, key: string): string | null {
  const { data } = loadVault(config, password);
  logAudit(config, { action: 'get', key });
  return data.secrets[key]?.value || null;
}

export function listSecrets(config: VaultConfig, password: string): string[] {
  const { data } = loadVault(config, password);
  logAudit(config, { action: 'list' });
  return Object.keys(data.secrets).sort();
}

export function deleteSecret(config: VaultConfig, password: string, key: string): boolean {
  const { data, vault } = loadVault(config, password);

  if (!data.secrets[key]) {
    return false;
  }

  delete data.secrets[key];
  saveVault(config, password, data, vault);
  logAudit(config, { action: 'delete', key });
  return true;
}

export function rotatePassword(config: VaultConfig, oldPassword: string, newPassword: string): void {
  const { data } = loadVault(config, oldPassword);
  const vaultPath = getVaultPath(config);

  const newSalt = generateSalt();
  const newKey = deriveKey(newPassword, newSalt);
  const { encrypted, iv, authTag } = encrypt(JSON.stringify(data), newKey);

  const existingVault: EncryptedVault = JSON.parse(fs.readFileSync(vaultPath, 'utf8'));

  const updatedVault: EncryptedVault = {
    ...existingVault,
    metadata: {
      ...existingVault.metadata,
      updatedAt: new Date().toISOString()
    },
    salt: newSalt.toString('base64'),
    iv: iv.toString('base64'),
    data: encrypted.toString('base64'),
    authTag: authTag.toString('base64')
  };

  fs.writeFileSync(vaultPath, JSON.stringify(updatedVault, null, 2));
  logAudit(config, { action: 'rotate-password' });
}

export function exportSecrets(config: VaultConfig, password: string, format: ExportFormat): string {
  const { data } = loadVault(config, password);
  logAudit(config, { action: 'export' });

  if (format === 'json') {
    const exported: Record<string, string> = {};
    for (const [key, entry] of Object.entries(data.secrets)) {
      exported[key] = entry.value;
    }
    return JSON.stringify(exported, null, 2);
  }

  const lines: string[] = [];
  for (const [key, entry] of Object.entries(data.secrets)) {
    const escapedValue = entry.value.replace(/'/g, "'\\''");
    lines.push(`export ${key}='${escapedValue}'`);
  }
  return lines.join('\n');
}

export function getAuditLog(config: VaultConfig, options: { lastHours?: number; key?: string }): AuditLogEntry[] {
  const logPath = getAuditLogPath(config);

  if (!fs.existsSync(logPath)) {
    return [];
  }

  const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
  let entries: AuditLogEntry[] = lines.map(line => JSON.parse(line));

  if (options.lastHours) {
    const cutoff = new Date(Date.now() - options.lastHours * 60 * 60 * 1000);
    entries = entries.filter(e => new Date(e.timestamp) >= cutoff);
  }

  if (options.key) {
    entries = entries.filter(e => e.key === options.key);
  }

  return entries;
}
