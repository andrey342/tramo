import { type CommandBus } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import {
  BillingEvents,
  type ChargeFailedPayload,
} from '@modules/billing/domain/events/billing-events';
import { type IntegrationEvent } from '@shared/application';

import { RecordRepaymentCommand } from '../../application/commands/record-repayment.command';

import { WithdrawPayoffOnChargeFailed } from './collection.consumers';

const failed = (
  contractId: string,
  kind: ChargeFailedPayload['kind'],
): IntegrationEvent<ChargeFailedPayload> => ({
  eventId: uuidv7(),
  eventType: BillingEvents.ChargeFailed,
  aggregateType: 'Charge',
  aggregateId: uuidv7(),
  occurredAt: new Date('2026-11-12T08:00:00Z').toISOString(),
  correlationId: null,
  payload: {
    chargeId: uuidv7(),
    contractId,
    studentId: uuidv7(),
    kind,
    attempt: 1,
    reason: 'insufficient_funds',
  },
});

describe('WithdrawPayoffOnChargeFailed', () => {
  it('should withdraw the payoff when its charge failed, and ignore other charges', async () => {
    const executed: unknown[] = [];
    const commands = {
      execute: (command: unknown) => {
        executed.push(command);
        return Promise.resolve();
      },
    } as unknown as CommandBus;
    const consumer = new WithdrawPayoffOnChargeFailed(commands);
    const [payingOff, other] = [uuidv7(), uuidv7()];

    await consumer.handle(failed(payingOff, 'payoff'));
    await consumer.handle(failed(other, 'installment'));
    await consumer.handle(failed(other, 'isa'));

    expect(executed).toEqual([new RecordRepaymentCommand(payingOff, { kind: 'payoff_failed' })]);
  });
});
