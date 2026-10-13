import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  type OfferAcceptedPayload,
  OriginationEvents,
} from '@modules/origination/domain/events/origination-events';
import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';
import { Money, Percentage } from '@shared/domain';

import { ActivateContractCommand } from '../../application/commands/activate-contract.command';
import { CloseDefaultedPlanCommand } from '../../application/commands/close-defaulted-plan.command';
import { CompleteContractCommand } from '../../application/commands/complete-contract.command';
import {
  type AcceptedOffer,
  DrawUpContractCommand,
} from '../../application/commands/draw-up-contract.command';
import { OpenFinancingPlanCommand } from '../../application/commands/open-financing-plan.command';
import { RequestDisbursementCommand } from '../../application/commands/request-disbursement.command';
import {
  type ContractActivatedPayload,
  type ContractCreatedPayload,
  type ContractDefaultedPayload,
  type ContractSignedPayload,
  type DisbursementRequestedPayload,
  type DisbursementRetriedPayload,
  type DisbursementSentPayload,
  type DisbursementSettledPayload,
  LendingEvents,
  type PlanCompletedPayload,
} from '../../domain';
import { LendingJobs } from '../jobs/lending-jobs';

// The contract saga, one step per event. Every step is idempotent: commands find the work done,
// jobs are keyed so a redelivered event queues nothing new.
//
//   OfferAccepted → draw up → ContractCreated → job: send for signature
//   webhook signed → ContractSigned → disbursement → DisbursementRequested → job: transfer
//   DisbursementSent → job: check settlement → DisbursementSettled → activate
//   ContractActivated → open the plan … PlanCompleted → complete the contract
//   ContractDefaulted → close the plan (`defaulted`)

@Injectable()
@EventSubscriber({ event: OriginationEvents.OfferAccepted, consumer: 'lending.draw-up-contract' })
export class DrawUpContractOnOfferAccepted implements EventHandler<OfferAcceptedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<OfferAcceptedPayload>): Promise<void> {
    await this.commands.execute(new DrawUpContractCommand(toOffer(event.payload)));
  }
}

// Exported for its spec: the one place an origination event becomes a lending input.
export function toOffer(payload: OfferAcceptedPayload): AcceptedOffer {
  const { product } = payload;
  return {
    applicationId: payload.applicationId,
    studentId: payload.applicantId,
    centerId: payload.centerId,
    programId: payload.programId,
    programName: payload.programName,
    principalCents: payload.amountCents,
    product:
      product.kind === 'installments'
        ? {
            kind: 'installments',
            termMonths: product.termMonths,
            annualRate: Percentage.fromBasisPoints(product.annualRateBasisPoints),
          }
        : {
            kind: 'isa',
            incomeShare: Percentage.fromBasisPoints(product.incomeShareBasisPoints),
            minMonthlyIncome: Money.fromCents(product.minMonthlyIncomeCents),
            maxPayments: product.maxPayments,
            capMultiplierHundredths: product.capMultiplierHundredths,
            graceMonths: product.graceMonths,
          },
  };
}

@Injectable()
@EventSubscriber({ event: LendingEvents.ContractCreated, consumer: 'lending.send-for-signature' })
export class SendForSignatureOnContractCreated implements EventHandler<ContractCreatedPayload> {
  constructor(private readonly jobs: LendingJobs) {}

  async handle(event: IntegrationEvent<ContractCreatedPayload>): Promise<void> {
    await this.jobs.sendForSignature(event.payload.contractId, event.correlationId);
  }
}

@Injectable()
@EventSubscriber({ event: LendingEvents.ContractSigned, consumer: 'lending.request-disbursement' })
export class RequestDisbursementOnContractSigned implements EventHandler<ContractSignedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ContractSignedPayload>): Promise<void> {
    await this.commands.execute(new RequestDisbursementCommand(event.payload.contractId));
  }
}

@Injectable()
@EventSubscriber({ event: LendingEvents.DisbursementRequested, consumer: 'lending.transfer' })
export class TransferOnDisbursementRequested implements EventHandler<DisbursementRequestedPayload> {
  constructor(private readonly jobs: LendingJobs) {}

  async handle(event: IntegrationEvent<DisbursementRequestedPayload>): Promise<void> {
    await this.jobs.transfer(event.payload.disbursementId, 1, event.correlationId);
  }
}

@Injectable()
@EventSubscriber({ event: LendingEvents.DisbursementRetried, consumer: 'lending.transfer-again' })
export class TransferOnDisbursementRetried implements EventHandler<DisbursementRetriedPayload> {
  constructor(private readonly jobs: LendingJobs) {}

  async handle(event: IntegrationEvent<DisbursementRetriedPayload>): Promise<void> {
    await this.jobs.transfer(
      event.payload.disbursementId,
      event.payload.attempt,
      event.correlationId,
    );
  }
}

@Injectable()
@EventSubscriber({ event: LendingEvents.DisbursementSent, consumer: 'lending.check-settlement' })
export class CheckSettlementOnDisbursementSent implements EventHandler<DisbursementSentPayload> {
  constructor(private readonly jobs: LendingJobs) {}

  async handle(event: IntegrationEvent<DisbursementSentPayload>): Promise<void> {
    await this.jobs.checkSettlement(
      event.payload.disbursementId,
      event.payload.attempt,
      event.correlationId,
    );
  }
}

@Injectable()
@EventSubscriber({
  event: LendingEvents.DisbursementSettled,
  consumer: 'lending.activate-contract',
})
export class ActivateOnDisbursementSettled implements EventHandler<DisbursementSettledPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<DisbursementSettledPayload>): Promise<void> {
    await this.commands.execute(new ActivateContractCommand(event.payload.contractId));
  }
}

@Injectable()
@EventSubscriber({ event: LendingEvents.ContractActivated, consumer: 'lending.open-plan' })
export class OpenPlanOnContractActivated implements EventHandler<ContractActivatedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ContractActivatedPayload>): Promise<void> {
    await this.commands.execute(new OpenFinancingPlanCommand(event.payload.contractId));
  }
}

@Injectable()
@EventSubscriber({ event: LendingEvents.PlanCompleted, consumer: 'lending.complete-contract' })
export class CompleteContractOnPlanCompleted implements EventHandler<PlanCompletedPayload> {
  constructor(private readonly commands: CommandBus) {}

  // A plan closed because the contract defaulted leaves the contract defaulted.
  async handle(event: IntegrationEvent<PlanCompletedPayload>): Promise<void> {
    if (event.payload.reason !== 'defaulted') {
      await this.commands.execute(new CompleteContractCommand(event.payload.contractId));
    }
  }
}

@Injectable()
@EventSubscriber({ event: LendingEvents.ContractDefaulted, consumer: 'lending.close-plan' })
export class ClosePlanOnContractDefaulted implements EventHandler<ContractDefaultedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ContractDefaultedPayload>): Promise<void> {
    await this.commands.execute(new CloseDefaultedPlanCommand(event.payload.contractId));
  }
}
