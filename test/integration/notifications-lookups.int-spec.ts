import { type INestApplicationContext } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { uuidv7 } from 'uuidv7';

import { CatalogModule } from '@modules/catalog/catalog.module';
import { TRAINING_CENTER_REPOSITORY, type TrainingCenterRepository } from '@modules/catalog/domain';
import { USER_REPOSITORY, type UserRepository } from '@modules/iam/domain';
import { IamModule } from '@modules/iam/iam.module';
import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import {
  CatalogCenters,
  IamRecipients,
} from '../../src/modules/notifications/infrastructure/adapters/notifications-lookups';
import { centersContract, recipientsContract } from '../contracts/notifications-ports.contract';
import { anActiveTrainingCenter } from '../factories/catalog';
import { aCenterAdmin, aStudent } from '../factories/iam';

// The lookups of notifications ask iam and catalog through their public queries, on the real
// modules. Crosses three modules, so it lives outside them.
describe('notifications lookups (integration)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        IamModule,
        CatalogModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app.close();
  });

  recipientsContract('IamRecipients', async () => {
    const student = aStudent();
    const centerId = uuidv7();
    const admins = [aCenterAdmin({ centerId }), aCenterAdmin({ centerId })];
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(async () => {
      const users = app.get<UserRepository>(USER_REPOSITORY);
      await users.save(student);
      for (const admin of admins) await users.save(admin);
    });
    return {
      recipients: new IamRecipients(app.get(QueryBus)),
      user: { id: student.id, email: student.email.value },
      center: { id: centerId, emails: admins.map((admin) => admin.email.value) },
      unknownId: uuidv7(),
    };
  });

  centersContract('CatalogCenters', async () => {
    const center = anActiveTrainingCenter();
    await app
      .get<UnitOfWork>(UNIT_OF_WORK)
      .run(() => app.get<TrainingCenterRepository>(TRAINING_CENTER_REPOSITORY).save(center));
    return {
      centers: new CatalogCenters(app.get(QueryBus)),
      knownId: center.id,
      unknownId: uuidv7(),
    };
  });
});
