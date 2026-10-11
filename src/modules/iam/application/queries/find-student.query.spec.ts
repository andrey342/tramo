import { aStaffUser, aStudent } from '../../../../../test/factories/iam';
import { InMemoryUserRepository } from '../../../../../test/fakes/iam';
import { RecordingEventBus } from '../../../../../test/fakes/shared';
import { FindStudentQuery } from '../dto/student-lookup';

import { FindStudentHandler } from './find-student.query';

describe('FindStudent', () => {
  it('should find a student by email, and nobody who is not a student', async () => {
    const users = new InMemoryUserRepository(new RecordingEventBus());
    const student = aStudent({ email: 'ana.garcia@example.com' });
    const ops = aStaffUser('ops');
    await users.save(student);
    await users.save(ops);
    const handler = new FindStudentHandler(users);

    expect(await handler.execute(new FindStudentQuery(' Ana.Garcia@Example.com'))).toEqual({
      userId: student.id,
    });
    expect(await handler.execute(new FindStudentQuery(ops.email.value))).toBeNull();
    expect(await handler.execute(new FindStudentQuery('nobody@example.com'))).toBeNull();
    expect(await handler.execute(new FindStudentQuery('not an email'))).toBeNull();
  });
});
