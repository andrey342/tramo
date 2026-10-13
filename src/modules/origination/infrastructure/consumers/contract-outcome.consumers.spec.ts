import { type CommandBus } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { LendingEvents } from '@modules/lending/domain/events/lending-events';
import { type IntegrationEvent } from '@shared/application';
import { type EventPayload } from '@shared/domain';

import { RecordContractOutcomeCommand } from '../../application/commands/record-contract-outcome.command';

import {
  CloseApplicationOnContractCompleted,
  WithdrawApplicationOnContractCancelled,
} from './contract-outcome.consumers';

const anEvent = <P extends EventPayload>(eventType: string, payload: P): IntegrationEvent<P> => ({
  eventId: uuidv7(),
  eventType,
  aggregateType: 'Contract',
  aggregateId: uuidv7(),
  occurredAt: new Date('2026-11-12T08:00:00Z').toISOString(),
  correlationId: null,
  payload,
});

function recordingBus() {
  const executed: unknown[] = [];
  const commands = {
    execute: (command: unknown) => {
      executed.push(command);
      return Promise.resolve();
    },
  } as unknown as CommandBus;
  return { executed, commands };
}

describe('contract outcome consumers', () => {
  it('should withdraw the application when its contract is cancelled', async () => {
    const { executed, commands } = recordingBus();
    const applicationId = uuidv7();

    await new WithdrawApplicationOnContractCancelled(commands).handle(
      anEvent(LendingEvents.ContractCancelled, {
        contractId: uuidv7(),
        applicationId,
        centerId: uuidv7(),
        reason: 'signature_declined',
      }),
    );

    expect(executed).toEqual([new RecordContractOutcomeCommand(applicationId, 'cancelled')]);
  });

  it('should close the application when its contract is completed', async () => {
    const { executed, commands } = recordingBus();
    const applicationId = uuidv7();

    await new CloseApplicationOnContractCompleted(commands).handle(
      anEvent(LendingEvents.ContractCompleted, {
        contractId: uuidv7(),
        applicationId,
        studentId: uuidv7(),
        centerId: uuidv7(),
      }),
    );

    expect(executed).toEqual([new RecordContractOutcomeCommand(applicationId, 'completed')]);
  });
});
