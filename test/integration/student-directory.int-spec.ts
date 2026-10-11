import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { uuidv7 } from 'uuidv7';

import { USER_REPOSITORY, type UserRepository } from '@modules/iam/domain';
import { IamModule } from '@modules/iam/iam.module';
import { OriginationModule } from '@modules/origination/origination.module';
import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import { IamStudentDirectory } from '../../src/modules/origination/infrastructure/adapters/iam-student-directory';
import { studentDirectoryContract } from '../contracts/student-directory.contract';
import { aStaffUser, aStudent } from '../factories/iam';

// Crosses two modules (origination's adapter, iam's query), so it lives outside both.
describe('IamStudentDirectory (integration)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        IamModule,
        OriginationModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app.close();
  });

  studentDirectoryContract('IamStudentDirectory over the query bus', async () => {
    const student = aStudent({ email: `student-${uuidv7().slice(-12)}@example.com` });
    const staff = aStaffUser('ops');
    const users = app.get<UserRepository>(USER_REPOSITORY);
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(async () => {
      await users.save(student);
      await users.save(staff);
    });
    return {
      directory: app.get(IamStudentDirectory),
      student: { email: student.email.value, id: student.id },
      staffEmail: staff.email.value,
    };
  });
});
