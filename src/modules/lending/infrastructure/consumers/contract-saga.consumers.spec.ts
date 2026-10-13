import { type CommandBus } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { type OfferAcceptedPayload } from '@modules/origination/domain/events/origination-events';
import { type IntegrationEvent } from '@shared/application';
import { type EventPayload, Money, Percentage } from '@shared/domain';

import { ActivateContractCommand } from '../../application/commands/activate-contract.command';
import { CloseDefaultedPlanCommand } from '../../application/commands/close-defaulted-plan.command';
import { CompleteContractCommand } from '../../application/commands/complete-contract.command';
import { LendingEvents, type PlanCompletedPayload } from '../../domain';

import {
  ActivateOnDisbursementSettled,
  ClosePlanOnContractDefaulted,
  CompleteContractOnPlanCompleted,
  toOffer,
} from './contract-saga.consumers';

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

const event = <P extends EventPayload>(eventType: string, payload: P): IntegrationEvent<P> => ({
  eventId: uuidv7(),
  eventType,
  aggregateType: 'FinancingPlan',
  aggregateId: uuidv7(),
  occurredAt: '2026-11-12T08:00:00.000Z',
  correlationId: null,
  payload,
});

describe('ActivateOnDisbursementSettled', () => {
  const settled = { disbursementId: uuidv7(), centerId: uuidv7(), amountCents: 7_125_00 };

  // The event is delivered at 08:00 the next day; the transfer settled the evening before.
  it('should activate the contract on the settlement instant the event carries', async () => {
    const { executed, commands } = recordingBus();
    const contractId = uuidv7();

    await new ActivateOnDisbursementSettled(commands).handle(
      event(LendingEvents.DisbursementSettled, {
        ...settled,
        contractId,
        settledAt: '2026-11-11T23:50:00.000Z',
      }),
    );

    expect(executed).toEqual([
      new ActivateContractCommand(contractId, new Date('2026-11-11T23:50:00.000Z')),
    ]);
  });

  it('should take the time the event occurred when it was recorded without settledAt', async () => {
    const { executed, commands } = recordingBus();
    const contractId = uuidv7();

    await new ActivateOnDisbursementSettled(commands).handle(
      event(LendingEvents.DisbursementSettled, { ...settled, contractId }),
    );

    expect(executed).toEqual([
      new ActivateContractCommand(contractId, new Date('2026-11-12T08:00:00.000Z')),
    ]);
  });
});

describe('CompleteContractOnPlanCompleted', () => {
  it('should complete the contract unless the plan closed because it defaulted', async () => {
    const { executed, commands } = recordingBus();
    const consumer = new CompleteContractOnPlanCompleted(commands);
    const [repaid, defaulted] = [uuidv7(), uuidv7()];
    const completed = (contractId: string, reason: PlanCompletedPayload['reason']) =>
      event<PlanCompletedPayload>(LendingEvents.PlanCompleted, {
        planId: uuidv7(),
        contractId,
        studentId: uuidv7(),
        centerId: uuidv7(),
        reason,
      });

    await consumer.handle(completed(repaid, 'repaid'));
    await consumer.handle(completed(defaulted, 'defaulted'));

    expect(executed).toEqual([new CompleteContractCommand(repaid)]);
  });
});

describe('ClosePlanOnContractDefaulted', () => {
  it('should close the plan of the contract that defaulted', async () => {
    const { executed, commands } = recordingBus();
    const contractId = uuidv7();

    await new ClosePlanOnContractDefaulted(commands).handle(
      event(LendingEvents.ContractDefaulted, {
        contractId,
        studentId: uuidv7(),
        centerId: uuidv7(),
      }),
    );

    expect(executed).toEqual([new CloseDefaultedPlanCommand(contractId)]);
  });
});

const common = {
  applicationId: '0199a000-0000-7000-8000-000000000001',
  applicantId: '0199a000-0000-7000-8000-000000000002',
  centerId: '0199a000-0000-7000-8000-000000000003',
  programId: '0199a000-0000-7000-8000-000000000004',
  programName: 'Full Stack Bootcamp',
  amountCents: 7_500_00,
};

describe('toOffer', () => {
  it('should read an accepted instalment offer as origination publishes it', () => {
    const payload: OfferAcceptedPayload = {
      ...common,
      product: { kind: 'installments', termMonths: 24, annualRateBasisPoints: 750 },
    };

    expect(toOffer(payload)).toEqual({
      applicationId: common.applicationId,
      studentId: common.applicantId,
      centerId: common.centerId,
      programId: common.programId,
      programName: 'Full Stack Bootcamp',
      principalCents: 7_500_00,
      product: {
        kind: 'installments',
        termMonths: 24,
        annualRate: Percentage.fromBasisPoints(750),
      },
    });
  });

  it('should read an accepted income share agreement as origination publishes it', () => {
    const payload: OfferAcceptedPayload = {
      ...common,
      product: {
        kind: 'isa',
        incomeShareBasisPoints: 1_000,
        minMonthlyIncomeCents: 1_500_00,
        maxPayments: 36,
        capMultiplierHundredths: 150,
        graceMonths: 3,
      },
    };

    expect(toOffer(payload).product).toEqual({
      kind: 'isa',
      incomeShare: Percentage.fromBasisPoints(1_000),
      minMonthlyIncome: Money.fromCents(1_500_00),
      maxPayments: 36,
      capMultiplierHundredths: 150,
      graceMonths: 3,
    });
  });
});
