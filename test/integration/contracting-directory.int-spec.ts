import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CatalogModule } from '@modules/catalog/catalog.module';
import {
  PROGRAM_REPOSITORY,
  type ProgramRepository,
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '@modules/catalog/domain';
import { LendingModule } from '@modules/lending/lending.module';
import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import { CatalogContractingDirectory } from '../../src/modules/lending/infrastructure/adapters/catalog-contracting-directory';
import { contractingDirectoryContract } from '../contracts/contracting-directory.contract';
import { anActiveTrainingCenter, aProgram, NOW, VALID_IBAN } from '../factories/catalog';

// Crosses two modules (lending's adapter, catalog's queries), so it lives outside both.
describe('CatalogContractingDirectory (integration)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        CatalogModule,
        LendingModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app.close();
  });

  contractingDirectoryContract('CatalogContractingDirectory over the query bus', async () => {
    const center = anActiveTrainingCenter({ feePercent: 5 });
    const program = aProgram({ centerId: center.id, details: { durationWeeks: 12 } });
    const other = anActiveTrainingCenter();
    const otherProgram = aProgram({ centerId: other.id });
    const suspended = anActiveTrainingCenter();
    suspended.suspend('Audit', NOW);
    const centers = app.get<TrainingCenterRepository>(TRAINING_CENTER_REPOSITORY);
    const programs = app.get<ProgramRepository>(PROGRAM_REPOSITORY);
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(async () => {
      await centers.save(center);
      await centers.save(other);
      await centers.save(suspended);
      await programs.save(program);
      await programs.save(otherProgram);
    });
    return {
      directory: app.get(CatalogContractingDirectory),
      centerId: center.id,
      programId: program.id,
      payoutIban: VALID_IBAN,
      otherCenterProgramId: otherProgram.id,
      suspendedCenterId: suspended.id,
    };
  });
});
