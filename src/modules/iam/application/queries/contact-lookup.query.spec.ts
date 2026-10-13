import { uuidv7 } from 'uuidv7';

import { aCenterAdmin, aStudent } from '../../../../../test/factories/iam';
import { InMemoryUserRepository } from '../../../../../test/fakes/iam';
import { RecordingEventBus } from '../../../../../test/fakes/shared';
import { FindUserContactQuery, ListCenterContactsQuery } from '../dto/contact-lookup';

import { FindUserContactHandler, ListCenterContactsHandler } from './contact-lookup.query';

describe('contact lookups', () => {
  it('should give the address of an active user only', async () => {
    const users = new InMemoryUserRepository(new RecordingEventBus());
    const [student, disabled] = [aStudent(), aStudent()];
    disabled.disable(new Date('2026-10-09T10:00:00Z'));
    await users.save(student);
    await users.save(disabled);
    const handler = new FindUserContactHandler(users);

    expect(await handler.execute(new FindUserContactQuery(student.id))).toEqual({
      userId: student.id,
      email: student.email.value,
    });
    expect(await handler.execute(new FindUserContactQuery(disabled.id))).toBeNull();
    expect(await handler.execute(new FindUserContactQuery(uuidv7()))).toBeNull();
  });

  it('should list the active admins of a center', async () => {
    const users = new InMemoryUserRepository(new RecordingEventBus());
    const centerId = uuidv7();
    const [admin, gone] = [aCenterAdmin({ centerId }), aCenterAdmin({ centerId })];
    gone.disable(new Date('2026-10-09T10:00:00Z'));
    await users.save(admin);
    await users.save(gone);
    await users.save(aCenterAdmin());

    const contacts = await new ListCenterContactsHandler(users).execute(
      new ListCenterContactsQuery(centerId),
    );

    expect(contacts).toEqual([{ userId: admin.id, email: admin.email.value }]);
  });
});
