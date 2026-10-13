import { type Queue } from 'bullmq';

import { type IntegrationEvent } from '@shared/application';

import { CatalogEvents } from '../../domain';
import { type VatCheckJob, VatCheckScheduler } from '../jobs/vat-checks';

import {
  VerifyChangedCenterVatConsumer,
  VerifyRegisteredCenterVatConsumer,
  VerifyReinstatedCenterVatConsumer,
} from './vat-check.consumers';

const event = <P extends Record<string, string>>(
  eventType: string,
  eventId: string,
  payload: P,
): IntegrationEvent<P> => ({
  eventId,
  eventType,
  aggregateType: 'TrainingCenter',
  aggregateId: 'center-1',
  occurredAt: '2026-10-13T09:00:00.000Z',
  correlationId: 'req-1',
  payload,
});

describe('VAT check consumers', () => {
  const setup = () => {
    const jobIds: (string | undefined)[] = [];
    const queue = {
      add: (_name: string, _data: VatCheckJob, options: { jobId?: string }) => {
        jobIds.push(options.jobId);
        return Promise.resolve();
      },
    } as unknown as Queue<VatCheckJob>;
    return { jobIds, scheduler: new VatCheckScheduler(queue) };
  };

  // BullMQ ignores an id it still holds, completed jobs included: a later check needs its own.
  it('should queue a check of its own when a number is corrected or a center reinstated', async () => {
    const { jobIds, scheduler } = setup();
    const registered = { centerId: 'center-1', name: 'X', country: 'ES', taxId: 'ESB1' };
    const changed = { centerId: 'center-1', country: 'DE', taxId: 'DE123456789' };

    await new VerifyRegisteredCenterVatConsumer(scheduler).handle(
      event(CatalogEvents.CenterRegistered, 'event-1', registered),
    );
    await new VerifyChangedCenterVatConsumer(scheduler).handle(
      event(CatalogEvents.CenterVatNumberChanged, 'event-2', changed),
    );
    await new VerifyReinstatedCenterVatConsumer(scheduler).handle(
      event(CatalogEvents.CenterReturnedToVerification, 'event-3', { centerId: 'center-1' }),
    );

    expect(jobIds).toEqual(['center-1', 'center-1.event-2', 'center-1.event-3']);
  });
});
