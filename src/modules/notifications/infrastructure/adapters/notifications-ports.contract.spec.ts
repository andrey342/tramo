import { uuidv7 } from 'uuidv7';

import {
  centersContract,
  emailRendererContract,
  emailSenderContract,
  recipientsContract,
} from '../../../../../test/contracts/notifications-ports.contract';
import {
  FakeCenters,
  FakeEmailRenderer,
  FakeEmailSender,
  FakeRecipients,
} from '../../../../../test/fakes/notifications';

import { HandlebarsEmailRenderer } from './handlebars-email-renderer';

// The fakes against the shared contracts; the real adapters run them in their own specs
// (SMTP and the iam and catalog lookups need Docker: *.int-spec.ts).

emailRendererContract('FakeEmailRenderer', () => new FakeEmailRenderer());
emailRendererContract('HandlebarsEmailRenderer', () => new HandlebarsEmailRenderer());

emailSenderContract('FakeEmailSender', () => {
  const sender = new FakeEmailSender();
  const failing = new FakeEmailSender();
  failing.failures.push('connection_failed');
  return {
    sender,
    failing,
    received: (to) =>
      Promise.resolve(
        sender.sent.filter((email) => email.to === to).map(({ subject }) => ({ subject })),
      ),
  };
});

recipientsContract('FakeRecipients', () => {
  const recipients = new FakeRecipients();
  const user = { id: uuidv7(), email: 'student@example.com' };
  const center = { id: uuidv7(), emails: ['a@center.test', 'b@center.test'] };
  recipients.users.set(user.id, user.email);
  recipients.centers.set(center.id, [...center.emails]);
  return { recipients, user, center, unknownId: uuidv7() };
});

centersContract('FakeCenters', () => {
  const centers = new FakeCenters();
  const knownId = uuidv7();
  centers.ids.add(knownId);
  return { centers, knownId, unknownId: uuidv7() };
});
