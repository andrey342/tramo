import { type CommandBus } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import {
  LendingEvents,
  type PlanCompletedPayload,
} from '@modules/lending/domain/events/lending-events';
import { type IntegrationEvent } from '@shared/application';

import { CancelScheduledChargesCommand } from '../../application/commands/cancel-scheduled-charges.command';

import { CancelChargesOnPlanCompleted } from './billing.consumers';

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
