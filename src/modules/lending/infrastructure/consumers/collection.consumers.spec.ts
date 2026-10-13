import { type CommandBus } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import {
  BillingEvents,
  type ChargeFailedPayload,
  type ChargeReturnedPayload,
} from '@modules/billing/domain/events/billing-events';
import { type IntegrationEvent } from '@shared/application';

import { RecordRepaymentCommand } from '../../application/commands/record-repayment.command';

import { RecordReturnOnChargeReturned, WithdrawPayoffOnChargeFailed } from './collection.consumers';

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

const returned = (
  contractId: string,
  kind: ChargeReturnedPayload['kind'],
  installmentNumber: number | null,
): IntegrationEvent<ChargeReturnedPayload> => ({
  eventId: uuidv7(),
  eventType: BillingEvents.ChargeReturned,
  aggregateType: 'Charge',
  aggregateId: uuidv7(),
  occurredAt: new Date('2026-12-20T09:00:00Z').toISOString(),
  correlationId: null,
  payload: {
    chargeId: uuidv7(),
    contractId,
    studentId: uuidv7(),
    centerId: uuidv7(),
    kind,
    installmentNumber,
    amountCents: 337_50,
    attempt: 1,
    reason: 'MD06',
    dueDate: '2026-12-20',
    returnedAt: '2026-12-20T09:00:00.000Z',
  },
});

describe('RecordReturnOnChargeReturned', () => {
  it('should unmark the instalment when its payment is returned, and leave ISA months alone', async () => {
    const executed: unknown[] = [];
    const commands = {
      execute: (command: unknown) => {
        executed.push(command);
        return Promise.resolve();
      },
    } as unknown as CommandBus;
    const consumer = new RecordReturnOnChargeReturned(commands);
    const [repaying, paidOff, isa] = [uuidv7(), uuidv7(), uuidv7()];

    await consumer.handle(returned(repaying, 'installment', 3));
    await consumer.handle(returned(paidOff, 'payoff', null));
    await consumer.handle(returned(isa, 'isa', null));

    expect(executed).toEqual([
      new RecordRepaymentCommand(repaying, {
        kind: 'installment_returned',
        installmentNumber: 3,
        attempt: 1,
      }),
      new RecordRepaymentCommand(paidOff, { kind: 'payoff_returned' }),
    ]);
  });
});
