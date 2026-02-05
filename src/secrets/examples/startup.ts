/**
 * Example: Server startup with runtime secrets injection.
 *
 * This shows how to integrate the secrets module with the game server.
 * Copy and adapt this pattern for your production deployments.
 */

import * as fs from 'fs';
import { loadSecretsToEnv, validatePasswordSource } from '../index';

/**
 * Load secrets before starting the application.
 *
 * Call this at the very start of your application, before
 * any code tries to access process.env for secrets.
 */
export async function loadSecrets(): Promise<void> {
  // Determine which environment to load
  const env = process.env.VAULT_ENV || process.env.NODE_ENV || 'development';

  // Get the vault password from a secure source
  let password = process.env.VAULT_PASSWORD;

  // Support reading password from a file (common in containers)
  const passwordFile = process.env.VAULT_PASSWORD_FILE;
  if (passwordFile && fs.existsSync(passwordFile)) {
    password = fs.readFileSync(passwordFile, 'utf8').trim();
  }

  // Validate the password source
  try {
    validatePasswordSource(password);
  } catch (error) {
    if (env === 'development') {
      console.warn('Vault password validation failed, skipping secrets loading in development');
      return;
    }
    throw error;
  }

  // Load secrets into process.env
  console.log(`Loading secrets from ${env} vault...`);
  const loadedKeys = await loadSecretsToEnv({ env, password });
  console.log(`Loaded ${loadedKeys.length} secrets: ${loadedKeys.join(', ')}`);
}

/**
 * Example main function showing full integration.
 */
async function main(): Promise<void> {
  // Step 1: Load secrets before anything else
  await loadSecrets();

  // Step 2: Now your app can safely access secrets via process.env
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const dbUrl = process.env.DATABASE_URL;

  console.log('Secrets loaded successfully');
  console.log(`API Key: ${apiKey ? '***' + apiKey.slice(-4) : 'not set'}`);
  console.log(`Database: ${dbUrl ? 'configured' : 'not set'}`);

  // Step 3: Start your application
  // const server = new GameServer({ ... });
  // server.start();
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Startup failed:', error.message);
    process.exit(1);
  });
}
