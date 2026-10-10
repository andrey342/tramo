import { Module } from '@nestjs/common';

import { CatalogModule } from './catalog.module';
import { CentersController } from './infrastructure/http/centers.controller';

@Module({
  imports: [CatalogModule],
  controllers: [CentersController],
})
export class CatalogHttpModule {}
