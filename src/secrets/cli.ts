#!/usr/bin/env node
/**
 * Vault Management CLI.
 *
 * Usage:
 *   npx tsx src/secrets/cli.ts create <env> <password>
 *   npx tsx src/secrets/cli.ts set <env> <key> <value> <password>
 *   npx tsx src/secrets/cli.ts get <env> <key> <password>
 *   npx tsx src/secrets/cli.ts list <env> <password>
 *   npx tsx src/secrets/cli.ts export <env> <password> [--format=env|json]
 *
 * Example:
 *   # Create a new vault for production
 *   npx tsx src/secrets/cli.ts create prod my-secure-password
 *
 *   # Add secrets
 *   npx tsx src/secrets/cli.ts set prod DATABASE_URL "postgres://..." my-secure-password
 *   npx tsx src/secrets/cli.ts set prod API_KEY "sk-..." my-secure-password
 *
 *   # List secrets (shows keys only, not values)
 *   npx tsx src/secrets/cli.ts list prod my-secure-password
 *
 *   # Get a specific secret
 *   npx tsx src/secrets/cli.ts get prod DATABASE_URL my-secure-password
 *
 *   # Export to env file
 *   npx tsx src/secrets/cli.ts export prod my-secure-password --format=env > .env.prod
 */

import * as fs from 'fs';
import * as readline from 'readline';
import { saveVault, loadVault, getDefaultVaultPath } from './vault';
import type { VaultData, VaultConfig } from './types';

function printUsage(): void {
  console.log(`
Vault Management CLI

Commands:
  create <env>              Create a new vault for environment
  set <env> <key> <value>   Set a secret value
  get <env> <key>           Get a secret value
  delete <env> <key>        Delete a secret
  list <env>                List all secret keys
  export <env>              Export secrets to stdout

Options:
  --format=env|json         Export format (default: env)
  --password=<pwd>          Vault password (or use VAULT_PASSWORD env var)

Examples:
  # Create prod vault (will prompt for password)
  npx tsx src/secrets/cli.ts create prod

  # Set a secret
  VAULT_PASSWORD=secret npx tsx src/secrets/cli.ts set prod DATABASE_URL "postgres://..."

  # Export to file
  VAULT_PASSWORD=secret npx tsx src/secrets/cli.ts export prod --format=env > .env.prod
`);
}

async function promptPassword(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function getPassword(args: string[]): Promise<string> {
  // Check --password= argument
  const passwordArg = args.find((a) => a.startsWith('--password='));
  if (passwordArg) {
    return passwordArg.split('=')[1];
  }

  // Check environment variable
  if (process.env.VAULT_PASSWORD) {
    return process.env.VAULT_PASSWORD;
  }

  // Prompt interactively
  return promptPassword('Vault password: ');
}

async function loadOrCreateVault(config: VaultConfig): Promise<VaultData> {
  const vaultPath = config.vaultPath || getDefaultVaultPath(config.env);

  if (!fs.existsSync(vaultPath)) {
    return { secrets: {}, lastModified: new Date().toISOString() };
  }

  return loadVault(config);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = args[0];
  const env = args[1];

  if (!env && command !== '--help') {
    console.error('Error: Environment name required');
    printUsage();
    process.exit(1);
  }

  const vaultPath = getDefaultVaultPath(env);
  const password = await getPassword(args);

  try {
    switch (command) {
      case 'create': {
        if (fs.existsSync(vaultPath)) {
          console.error(`Error: Vault already exists at ${vaultPath}`);
          process.exit(1);
        }

        const vaultData: VaultData = {
          secrets: {},
          lastModified: new Date().toISOString(),
        };
        await saveVault(vaultData, password, vaultPath);
        console.log(`Created vault at ${vaultPath}`);
        break;
      }

      case 'set': {
        const key = args[2];
        const value = args[3];

        if (!key || value === undefined) {
          console.error('Error: Key and value required');
          console.error('Usage: set <env> <key> <value>');
          process.exit(1);
        }

        const vaultData = await loadOrCreateVault({ env, password, vaultPath });
        vaultData.secrets[key] = value;
        vaultData.lastModified = new Date().toISOString();
        await saveVault(vaultData, password, vaultPath);
        console.log(`Set ${key} in ${env} vault`);
        break;
      }

      case 'get': {
        const key = args[2];

        if (!key) {
          console.error('Error: Key required');
          console.error('Usage: get <env> <key>');
          process.exit(1);
        }

        const vaultData = await loadVault({ env, password, vaultPath });
        const value = vaultData.secrets[key];

        if (value === undefined) {
          console.error(`Error: Secret not found: ${key}`);
          process.exit(1);
        }

        console.log(value);
        break;
      }

      case 'delete': {
        const key = args[2];

        if (!key) {
          console.error('Error: Key required');
          console.error('Usage: delete <env> <key>');
          process.exit(1);
        }

        const vaultData = await loadVault({ env, password, vaultPath });

        if (!(key in vaultData.secrets)) {
          console.error(`Error: Secret not found: ${key}`);
          process.exit(1);
        }

        delete vaultData.secrets[key];
        vaultData.lastModified = new Date().toISOString();
        await saveVault(vaultData, password, vaultPath);
        console.log(`Deleted ${key} from ${env} vault`);
        break;
      }

      case 'list': {
        const vaultData = await loadVault({ env, password, vaultPath });
        const keys = Object.keys(vaultData.secrets);

        if (keys.length === 0) {
          console.log('(no secrets)');
        } else {
          console.log('Secrets:');
          for (const key of keys.sort()) {
            console.log(`  ${key}`);
          }
        }
        break;
      }

      case 'export': {
        const formatArg = args.find((a) => a.startsWith('--format='));
        const format = formatArg ? formatArg.split('=')[1] : 'env';

        const vaultData = await loadVault({ env, password, vaultPath });

        if (format === 'json') {
          console.log(JSON.stringify(vaultData.secrets, null, 2));
        } else {
          for (const [key, value] of Object.entries(vaultData.secrets)) {
            const escapedValue = value
              .replace(/\\/g, '\\\\')
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n');
            console.log(`${key}="${escapedValue}"`);
          }
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    console.error(`Error: ${(error as Error).message}`);
    process.exit(1);
  }
}

main();
