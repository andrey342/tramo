import { Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { VAT_VALIDATOR, type VatValidator } from './application/ports/catalog-ports';
import { FakeVatValidator } from './infrastructure/adapters/fake-vat-validator';
import { ViesVatValidator } from './infrastructure/adapters/vies-vat-validator';

// Use cases, persistence and adapters of the catalog context. Shared by both processes; the HTTP
// surface lives in CatalogHttpModule, which only the api imports.
@Module({
  providers: [
    ViesVatValidator,
    FakeVatValidator,
    {
      provide: VAT_VALIDATOR,
      inject: [APP_CONFIG, ViesVatValidator, FakeVatValidator],
      useFactory: (
        config: AppConfig,
        vies: ViesVatValidator,
        fake: FakeVatValidator,
      ): VatValidator => (config.vies.mode === 'fake' ? fake : vies),
    },
  ],
  exports: [],
})
export class CatalogModule {}
