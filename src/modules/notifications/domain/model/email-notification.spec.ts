import { anEmail, LATER, NOW } from '../../../../../test/factories/notifications';
import { NotificationsEvents } from '../events/notifications-events';

import { EmailNotification } from './email-notification';

describe('EmailNotification', () => {
  it('should be requested pending and announced without its content', () => {
    const email = anEmail();

    expect(email).toMatchObject({ status: 'pending', pending: true, attempts: 0 });
    expect(email.recipient.value).toBe('student@example.com');
    expect(email.pullEvents()).toEqual([
      expect.objectContaining({
        eventType: NotificationsEvents.EmailRequested,
        payload: {
          notificationId: email.id,
          template: 'installment_collected',
          reference: email.reference,
        },
      }),
    ]);
  });

  it('should be sent once, after failed attempts', () => {
    const email = anEmail();

    email.recordFailedAttempt('ECONNREFUSED');
    email.markSent(LATER);
    email.markSent(LATER);
    email.recordFailedAttempt('late');

    expect(email).toMatchObject({ status: 'sent', sentAt: LATER, attempts: 2, lastError: null });
  });

  it('should fail with its last error when the job gives up, once', () => {
    const email = anEmail();
    email.pullEvents();
    email.recordFailedAttempt('y'.repeat(400));

    email.giveUp(NOW);
    email.giveUp(NOW);
    email.markSent(LATER);

    expect(email.status).toBe('failed');
    expect(email.lastError).toHaveLength(300);
    expect(email.pullEvents()).toEqual([
      expect.objectContaining({ eventType: NotificationsEvents.EmailFailed }),
    ]);
  });

  it('should be reconstituted as saved, without events', () => {
    const saved = anEmail();

    const loaded = EmailNotification.reconstitute(saved.id, {
      eventId: saved.eventId,
      template: saved.template,
      recipient: saved.recipient,
      reference: saved.reference,
      data: saved.data,
      status: 'sent',
      attempts: 1,
      lastError: null,
      sentAt: LATER,
      createdAt: saved.createdAt,
    });

    expect(loaded).toMatchObject({ status: 'sent', pending: false, createdAt: NOW });
    expect(loaded.hasPendingEvents).toBe(false);
  });
});
