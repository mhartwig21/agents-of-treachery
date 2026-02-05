#!/usr/bin/env npx tsx

import * as readline from 'node:readline';
import * as path from 'node:path';
import {
  VaultConfig,
  ExportFormat,
  initVault,
  setSecret,
  getSecret,
  listSecrets,
  deleteSecret,
  rotatePassword,
  exportSecrets,
  getAuditLog,
  vaultExists
} from '../src/vault/index.js';

const VAULT_DIR = path.join(process.cwd(), '.secrets');

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
  bold: '\x1b[1m'
};

function color(text: string, ...codes: string[]): string {
  if (!process.stdout.isTTY) return text;
  return codes.join('') + text + COLORS.reset;
}

function error(message: string): void {
  console.error(color(`Error: ${message}`, COLORS.red));
  process.exit(1);
}

function success(message: string): void {
  console.log(color(`✓ ${message}`, COLORS.green));
}

function warn(message: string): void {
  console.log(color(`⚠ ${message}`, COLORS.yellow));
}

function info(message: string): void {
  console.log(color(message, COLORS.cyan));
}

async function promptPassword(prompt: string, confirm = false): Promise<string> {
  if (!process.stdin.isTTY) {
    error('Cannot read password: stdin is not a TTY. Use interactive mode.');
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (query: string): Promise<string> => {
    return new Promise((resolve) => {
      process.stdout.write(query);
      const stdin = process.stdin;
      const wasRaw = stdin.isRaw;

      if (stdin.setRawMode) {
        stdin.setRawMode(true);
      }

      let password = '';
      const onData = (char: Buffer) => {
        const c = char.toString('utf8');
        if (c === '\n' || c === '\r') {
          if (stdin.setRawMode) {
            stdin.setRawMode(wasRaw ?? false);
          }
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(password);
        } else if (c === '\u0003') {
          process.exit(1);
        } else if (c === '\u007F' || c === '\b') {
          if (password.length > 0) {
            password = password.slice(0, -1);
          }
        } else {
          password += c;
        }
      };

      stdin.on('data', onData);
    });
  };

  const password = await ask(prompt);

  if (confirm) {
    const confirmed = await ask('Confirm password: ');
    if (password !== confirmed) {
      rl.close();
      error('Passwords do not match');
    }
  }

  rl.close();
  return password;
}

function parseArgs(args: string[]): { command: string; positional: string[]; flags: Record<string, string | boolean> } {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (!command && !arg.startsWith('-')) {
      command = arg;
    } else if (arg.startsWith('--')) {
      const eqIndex = arg.indexOf('=');
      if (eqIndex !== -1) {
        flags[arg.slice(2, eqIndex)] = arg.slice(eqIndex + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[arg.slice(2)] = args[++i];
      } else {
        flags[arg.slice(2)] = true;
      }
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

function getConfig(env: string): VaultConfig {
  return {
    env,
    vaultDir: VAULT_DIR
  };
}

function printHelp(): void {
  console.log(`
${color('secrets', COLORS.bold)} - Secure secrets vault management

${color('USAGE', COLORS.bold)}
  npx tsx scripts/secrets.ts <command> [options]

${color('COMMANDS', COLORS.bold)}
  ${color('init', COLORS.cyan)}                     Initialize a new vault
  ${color('set', COLORS.cyan)} <KEY> [VALUE]        Add or update a secret (prompts for value if not provided)
  ${color('get', COLORS.cyan)} <KEY>                Get a secret value
  ${color('list', COLORS.cyan)}                     List all secret keys
  ${color('delete', COLORS.cyan)} <KEY>             Delete a secret
  ${color('rotate-password', COLORS.cyan)}          Change the vault master password
  ${color('export', COLORS.cyan)}                   Export secrets for runtime use
  ${color('audit', COLORS.cyan)}                    View audit log

${color('OPTIONS', COLORS.bold)}
  --env <name>           Environment name (default: dev)
  --format <env|json>    Export format (default: env)
  --last <hours>         Audit log time filter (e.g., 24h)
  --key <name>           Audit log key filter
  --help, -h             Show this help

${color('EXAMPLES', COLORS.bold)}
  ${color('# Initialize production vault', COLORS.dim)}
  npx tsx scripts/secrets.ts init --env prod

  ${color('# Set a secret (secure - prompts for value)', COLORS.dim)}
  npx tsx scripts/secrets.ts set DATABASE_URL --env prod

  ${color('# Set a secret (value in arg - avoid in production)', COLORS.dim)}
  npx tsx scripts/secrets.ts set API_KEY sk-xxx --env dev

  ${color('# Get a secret', COLORS.dim)}
  npx tsx scripts/secrets.ts get DATABASE_URL --env prod

  ${color('# List all keys', COLORS.dim)}
  npx tsx scripts/secrets.ts list --env prod

  ${color('# Export as env vars', COLORS.dim)}
  eval $(npx tsx scripts/secrets.ts export --env prod)

  ${color('# Export as JSON', COLORS.dim)}
  npx tsx scripts/secrets.ts export --env prod --format json

  ${color('# View recent audit log', COLORS.dim)}
  npx tsx scripts/secrets.ts audit --env prod --last 24h

${color('SECURITY', COLORS.bold)}
  • Passwords are never stored or logged
  • Vault uses AES-256-GCM encryption
  • Keys derived with PBKDF2 (100k iterations)
  • All operations are logged to audit file
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const { command, positional, flags } = parseArgs(args);

  if (flags.help || flags.h || !command) {
    printHelp();
    process.exit(0);
  }

  const env = (flags.env as string) || 'dev';
  const config = getConfig(env);

  switch (command) {
    case 'init': {
      if (vaultExists(config)) {
        error(`Vault already exists for environment: ${env}`);
      }
      info(`Initializing vault for environment: ${env}`);
      const password = await promptPassword('Enter master password: ', true);
      if (password.length < 8) {
        error('Password must be at least 8 characters');
      }
      initVault(config, password);
      success(`Vault initialized for ${env}`);
      break;
    }

    case 'set': {
      const key = positional[0];
      if (!key) {
        error('Missing key. Usage: secrets set <KEY> [VALUE] --env <env>');
      }
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
        warn('Key should be UPPER_SNAKE_CASE for environment variable compatibility');
      }

      const password = await promptPassword('Enter master password: ');

      let value = positional[1];
      if (!value) {
        value = await promptPassword('Enter secret value: ');
      } else if (process.stdout.isTTY) {
        warn('Passing secret values as arguments may expose them in shell history');
      }

      setSecret(config, password, key, value);
      success(`Secret '${key}' saved in ${env}`);
      break;
    }

    case 'get': {
      const key = positional[0];
      if (!key) {
        error('Missing key. Usage: secrets get <KEY> --env <env>');
      }

      const password = await promptPassword('Enter master password: ');
      const value = getSecret(config, password, key);

      if (value === null) {
        error(`Secret '${key}' not found in ${env}`);
      }

      if (process.stdout.isTTY) {
        console.log(color(value, COLORS.dim));
      } else {
        process.stdout.write(value);
      }
      break;
    }

    case 'list': {
      const password = await promptPassword('Enter master password: ');
      const keys = listSecrets(config, password);

      if (keys.length === 0) {
        info(`No secrets in ${env} vault`);
      } else {
        info(`Secrets in ${env} vault (${keys.length}):`);
        for (const key of keys) {
          console.log(`  ${key}`);
        }
      }
      break;
    }

    case 'delete': {
      const key = positional[0];
      if (!key) {
        error('Missing key. Usage: secrets delete <KEY> --env <env>');
      }

      const password = await promptPassword('Enter master password: ');
      const deleted = deleteSecret(config, password, key);

      if (deleted) {
        success(`Secret '${key}' deleted from ${env}`);
      } else {
        error(`Secret '${key}' not found in ${env}`);
      }
      break;
    }

    case 'rotate-password': {
      info(`Rotating password for ${env} vault`);
      const oldPassword = await promptPassword('Enter current password: ');
      const newPassword = await promptPassword('Enter new password: ', true);

      if (newPassword.length < 8) {
        error('New password must be at least 8 characters');
      }

      rotatePassword(config, oldPassword, newPassword);
      success('Master password rotated');
      break;
    }

    case 'export': {
      const format = (flags.format as ExportFormat) || 'env';
      if (format !== 'env' && format !== 'json') {
        error('Invalid format. Use --format env or --format json');
      }

      const password = await promptPassword('Enter master password: ');
      const output = exportSecrets(config, password, format);

      console.log(output);
      break;
    }

    case 'audit': {
      const lastHours = flags.last
        ? parseInt((flags.last as string).replace(/h$/i, ''), 10)
        : undefined;
      const key = flags.key as string | undefined;

      const entries = getAuditLog(config, { lastHours, key });

      if (entries.length === 0) {
        info('No audit log entries found');
      } else {
        info(`Audit log for ${env} (${entries.length} entries):`);
        for (const entry of entries) {
          const keyInfo = entry.key ? ` [${entry.key}]` : '';
          console.log(`  ${color(entry.timestamp, COLORS.dim)} ${entry.action}${keyInfo}`);
        }
      }
      break;
    }

    default:
      error(`Unknown command: ${command}. Run 'secrets --help' for usage.`);
  }
}

main().catch((err) => {
  error(err.message);
});
