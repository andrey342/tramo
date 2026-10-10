import { Module } from '@nestjs/common';

import { CatalogModule } from './catalog.module';
import { CentersController } from './infrastructure/http/centers.controller';
import { ProgramsController } from './infrastructure/http/programs.controller';

@Module({
  imports: [CatalogModule],
  controllers: [CentersController, ProgramsController],
})
export class CatalogHttpModule {}
