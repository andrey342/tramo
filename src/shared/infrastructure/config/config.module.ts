import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, parseConfig } from './app-config';

// A local .env is a development convenience; containers and CI inject real environment variables,
// which always take precedence because loadEnvFile never overwrites existing keys.
function loadDotEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: () => {
        loadDotEnv();
        return parseConfig(process.env);
      },
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
