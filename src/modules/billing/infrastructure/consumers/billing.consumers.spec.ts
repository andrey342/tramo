import { type CommandBus } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import {
  LendingEvents,
  type PlanCompletedPayload,
} from '@modules/lending/domain/events/lending-events';
import { type IntegrationEvent } from '@shared/application';
import { CalendarDate } from '@shared/domain';

import { CancelScheduledChargesCommand } from '../../application/commands/cancel-scheduled-charges.command';
import { CollectDueChargesCommand } from '../../application/commands/collect-due-charges.command';
import { BillingEvents } from '../../domain';

import { CancelChargesOnPlanCompleted, CollectOnMandateSigned } from './billing.consumers';

const completed = (
  contractId: string,
  reason: PlanCompletedPayload['reason'],
): IntegrationEvent<PlanCompletedPayload> => ({
  eventId: uuidv7(),
  eventType: LendingEvents.PlanCompleted,
  aggregateType: 'FinancingPlan',
  aggregateId: uuidv7(),
  occurredAt: new Date('2026-11-12T08:00:00Z').toISOString(),
  correlationId: null,
  payload: { planId: uuidv7(), contractId, studentId: uuidv7(), centerId: uuidv7(), reason },
});

describe('CancelChargesOnPlanCompleted', () => {
  // The ISA month that reached the cap was charged in the same transaction that ended the plan.
  it('should cancel scheduled charges only when the plan was paid off', async () => {
    const executed: unknown[] = [];
    const commands = {
      execute: (command: unknown) => {
        executed.push(command);
        return Promise.resolve(0);
      },
    } as unknown as CommandBus;
    const consumer = new CancelChargesOnPlanCompleted(commands);
    const [paidOff, capped] = [uuidv7(), uuidv7()];

    await consumer.handle(completed(paidOff, 'paid_off'));
    for (const reason of ['repaid', 'cap_reached', 'max_payments', 'window_expired'] as const) {
      await consumer.handle(completed(capped, reason));
    }

    expect(executed).toEqual([new CancelScheduledChargesCommand(paidOff)]);
  });
});

describe('CollectOnMandateSigned', () => {
  it('should collect the charges of the contract that were waiting for a mandate', async () => {
    const executed: unknown[] = [];
    const commands = {
      execute: (command: unknown) => {
        executed.push(command);
        return Promise.resolve({ submitted: 0, failedChargeIds: [] });
      },
    } as unknown as CommandBus;
    const contractId = uuidv7();

    await new CollectOnMandateSigned(commands).handle({
      eventId: uuidv7(),
      eventType: BillingEvents.MandateSigned,
      aggregateType: 'PaymentMandate',
      aggregateId: uuidv7(),
      occurredAt: '2026-11-20T10:00:00.000Z',
      correlationId: null,
      payload: {
        mandateId: uuidv7(),
        contractId,
        studentId: uuidv7(),
        mandateReference: 'TRAMO-1',
      },
    });

    expect(executed).toEqual([
      new CollectDueChargesCommand(CalendarDate.parse('2026-11-20'), contractId),
    ]);
  });
});
