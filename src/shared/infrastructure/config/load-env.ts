import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// A local .env is a development convenience; containers and CI inject real environment variables,
// which always take precedence because loadEnvFile never overwrites existing keys.
export function loadDotEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}
