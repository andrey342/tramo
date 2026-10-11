import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CatalogModule } from '@modules/catalog/catalog.module';
import {
  FinancingOptions,
  PROGRAM_REPOSITORY,
  type ProgramRepository,
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '@modules/catalog/domain';
import { OriginationModule } from '@modules/origination/origination.module';
import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import { CatalogProgramDirectory } from '../../src/modules/origination/infrastructure/adapters/catalog-program-directory';
import { programDirectoryContract } from '../contracts/program-directory.contract';
import { anActiveTrainingCenter, aProgram, installments, isa, NOW } from '../factories/catalog';

// Crosses two modules (origination's adapter, catalog's query), so it lives outside both.
describe('CatalogProgramDirectory (integration)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        CatalogModule,
        OriginationModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app.close();
  });

  programDirectoryContract('CatalogProgramDirectory over the query bus', async () => {
    const center = anActiveTrainingCenter();
    const financing = FinancingOptions.of({ installments: installments([12, 24]), isa: isa() });
    const open = aProgram({ centerId: center.id, financing });
    open.publish(center, NOW);
    const closed = aProgram({ centerId: center.id, financing });
    const centers = app.get<TrainingCenterRepository>(TRAINING_CENTER_REPOSITORY);
    const programs = app.get<ProgramRepository>(PROGRAM_REPOSITORY);
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(async () => {
      await centers.save(center);
      await programs.save(open);
      await programs.save(closed);
    });
    return {
      directory: app.get(CatalogProgramDirectory),
      openProgramId: open.id,
      closedProgramId: closed.id,
    };
  });
});
