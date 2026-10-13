import { type CommandBus } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import {
  CatalogEvents,
  type CenterSuspendedPayload,
} from '@modules/catalog/domain/events/catalog-events';
import { type IntegrationEvent } from '@shared/application';

import { RevokeCenterApiKeysCommand } from '../../application/commands/revoke-center-api-keys.command';

import { RevokeKeysOnCenterSuspended } from './iam.consumers';

describe('RevokeKeysOnCenterSuspended', () => {
  it("should revoke the center's API keys when the center is suspended", async () => {
    const executed: unknown[] = [];
    const commands = {
      execute: (command: unknown) => {
        executed.push(command);
        return Promise.resolve(2);
      },
    } as unknown as CommandBus;
    const centerId = uuidv7();
    const event: IntegrationEvent<CenterSuspendedPayload> = {
      eventId: uuidv7(),
      eventType: CatalogEvents.CenterSuspended,
      aggregateType: 'TrainingCenter',
      aggregateId: centerId,
      occurredAt: new Date('2026-10-09T10:00:00Z').toISOString(),
      correlationId: null,
      payload: { centerId, reason: 'Unpaid fees' },
    };

    await new RevokeKeysOnCenterSuspended(commands).handle(event);

    expect(executed).toEqual([new RevokeCenterApiKeysCommand(centerId)]);
  });
});
