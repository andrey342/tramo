import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import { reportingStoreContract } from '../../../../../test/contracts/reporting-store.contract';
import { REPORTING_STORE } from '../../application/ports/reporting-ports';
import { ReportingModule } from '../../reporting.module';

describe('reporting store (integration)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), ReportingModule],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app.close();
  });

  reportingStoreContract('TypeORM', () => ({
    store: app.get(REPORTING_STORE),
    run: (work) => app.get<UnitOfWork>(UNIT_OF_WORK).run(work),
  }));
});
