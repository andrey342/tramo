import { type CommandBus } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import {
  LendingEvents,
  type PlanCompletedPayload,
} from '@modules/lending/domain/events/lending-events';
import { type IntegrationEvent } from '@shared/application';
import { CalendarDate } from '@shared/domain';

import { CancelOpenChargesCommand } from '../../application/commands/cancel-open-charges.command';
import { CollectWaitingChargesCommand } from '../../application/commands/collect-waiting-charges.command';
import { BillingEvents } from '../../domain';
import { type BillingCycleJobs } from '../jobs/billing-jobs';
import { type LedgerLine, type LedgerWriter } from '../persistence/typeorm-billing.queries';

import {
  CancelChargesOnPlanCompleted,
  CollectOnMandateSigned,
  LedgerOnChargeReturned,
  RebillOnPayoffWithdrawn,
} from './billing.consumers';

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
    const reasons = [
      'repaid',
      'cap_reached',
      'max_payments',
      'window_expired',
      'defaulted',
    ] as const;
    for (const reason of reasons) {
      await consumer.handle(completed(capped, reason));
    }

    expect(executed).toEqual([new CancelOpenChargesCommand(paidOff)]);
  });
});

describe('CollectOnMandateSigned', () => {
  it('should collect the charges of the contract that were waiting for a mandate', async () => {
    const executed: unknown[] = [];
    const commands = {
      execute: (command: unknown) => {
        executed.push(command);
        return Promise.resolve(0);
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
      new CollectWaitingChargesCommand(contractId, CalendarDate.parse('2026-11-20')),
    ]);
  });
});

describe('LedgerOnChargeReturned', () => {
  it('should owe the amount again on the statement when the bank returns a payment', async () => {
    const lines: LedgerLine[] = [];
    const ledger = {
      append: (line: LedgerLine) => {
        lines.push(line);
        return Promise.resolve();
      },
    } as unknown as LedgerWriter;
    const [contractId, chargeId, eventId] = [uuidv7(), uuidv7(), uuidv7()];

    await new LedgerOnChargeReturned(ledger).handle({
      eventId,
      eventType: BillingEvents.ChargeReturned,
      aggregateType: 'Charge',
      aggregateId: chargeId,
      occurredAt: '2026-12-20T09:00:00.000Z',
      correlationId: null,
      payload: {
        chargeId,
        contractId,
        studentId: uuidv7(),
        centerId: uuidv7(),
        kind: 'installment',
        installmentNumber: 1,
        amountCents: 337_50,
        attempt: 1,
        reason: 'MD06',
        dueDate: '2026-12-20',
        returnedAt: '2026-12-20T09:00:00.000Z',
        period: '2026-11',
      },
    });

    expect(lines).toEqual([
      {
        eventId,
        contractId,
        chargeId,
        type: 'return',
        amountCents: 337_50,
        description: 'Direct debit returned by the bank (MD06)',
        occurredAt: new Date('2026-12-20T09:00:00.000Z'),
      },
    ]);
  });
});

describe('RebillOnPayoffWithdrawn', () => {
  // Billing and collecting in the consumer would join its transaction: one failed plan or charge
  // would hold the others back, and a failed collection went unnoticed.
  it('should queue the billing of the contract as of the day its payoff was withdrawn', async () => {
    const queued: unknown[] = [];
    const jobs = {
      rebill: (request: unknown, correlationId: string | null) => {
        queued.push({ request, correlationId });
        return Promise.resolve();
      },
    } as unknown as BillingCycleJobs;
    const [contractId, eventId] = [uuidv7(), uuidv7()];

    await new RebillOnPayoffWithdrawn(jobs).handle({
      eventId,
      eventType: LendingEvents.PayoffWithdrawn,
      aggregateType: 'FinancingPlan',
      aggregateId: uuidv7(),
      occurredAt: '2026-11-22T09:00:00.000Z',
      correlationId: 'req-1',
      payload: { planId: uuidv7(), contractId, studentId: uuidv7() },
    });

    expect(queued).toEqual([
      {
        request: { contractId, asOf: CalendarDate.parse('2026-11-22'), eventId },
        correlationId: 'req-1',
      },
    ]);
  });
});
