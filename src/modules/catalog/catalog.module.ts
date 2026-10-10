import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { RegisterTrainingCenterHandler } from './application/commands/register-training-center.command';
import { UpdateTrainingCenterHandler } from './application/commands/update-training-center.command';
import { VerifyCenterVatHandler } from './application/commands/verify-center-vat.command';
import { VAT_VALIDATOR, type VatValidator } from './application/ports/catalog-ports';
import { GetTrainingCenterHandler } from './application/queries/get-training-center.query';
import { PROGRAM_REPOSITORY, TRAINING_CENTER_REPOSITORY } from './domain';
import { FakeVatValidator } from './infrastructure/adapters/fake-vat-validator';
import { ViesVatValidator } from './infrastructure/adapters/vies-vat-validator';
import { VerifyRegisteredCenterVatConsumer } from './infrastructure/consumers/verify-registered-center-vat.consumer';
import { TrainingCenterMapper } from './infrastructure/persistence/catalog.mappers';
import { ProgramOrmEntity } from './infrastructure/persistence/program.orm-entity';
import { TrainingCenterOrmEntity } from './infrastructure/persistence/training-center.orm-entity';
import { TypeOrmProgramRepository } from './infrastructure/persistence/typeorm-program.repository';
import { TypeOrmTrainingCenterRepository } from './infrastructure/persistence/typeorm-training-center.repository';

// Use cases, persistence and adapters of the catalog context. Shared by both processes; the HTTP
// surface lives in CatalogHttpModule, which only the api imports.
@Module({
  imports: [TypeOrmModule.forFeature([TrainingCenterOrmEntity, ProgramOrmEntity])],
  providers: [
    TrainingCenterMapper,
    { provide: TRAINING_CENTER_REPOSITORY, useClass: TypeOrmTrainingCenterRepository },
    { provide: PROGRAM_REPOSITORY, useClass: TypeOrmProgramRepository },
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
    RegisterTrainingCenterHandler,
    VerifyCenterVatHandler,
    UpdateTrainingCenterHandler,
    GetTrainingCenterHandler,
    VerifyRegisteredCenterVatConsumer,
  ],
  exports: [],
})
export class CatalogModule {}
