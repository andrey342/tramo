import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, parseConfig } from './app-config';
import { loadDotEnv } from './load-env';

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
