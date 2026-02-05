export interface VaultConfig {
  env: string;
  vaultDir: string;
}

export interface VaultMetadata {
  version: number;
  env: string;
  createdAt: string;
  updatedAt: string;
  keyCount: number;
}

export interface EncryptedVault {
  metadata: VaultMetadata;
  salt: string;
  iv: string;
  data: string;
  authTag: string;
}

export interface SecretEntry {
  value: string;
  createdAt: string;
  updatedAt: string;
}

export interface VaultData {
  secrets: Record<string, SecretEntry>;
}

export interface AuditLogEntry {
  timestamp: string;
  action: 'init' | 'set' | 'get' | 'delete' | 'list' | 'export' | 'rotate-password';
  key?: string;
  env: string;
}

export type ExportFormat = 'env' | 'json';
