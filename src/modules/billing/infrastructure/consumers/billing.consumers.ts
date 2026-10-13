import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  type ContractDefaultedPayload,
  LendingEvents,
  type PayoffRequestedPayload,
  type PayoffWithdrawnPayload,
  type PlanCompletedPayload,
} from '@modules/lending/domain/events/lending-events';
import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';
import { CalendarDate } from '@shared/domain';

import { CancelOpenChargesCommand } from '../../application/commands/cancel-open-charges.command';
import { CollectWaitingChargesCommand } from '../../application/commands/collect-waiting-charges.command';
import { CreatePayoffChargeCommand } from '../../application/commands/create-payoff-charge.command';
import {
  BillingEvents,
  type ChargeCancelledPayload,
  type ChargeCreatedPayload,
  type ChargePaidPayload,
  type ChargeSubmittedPayload,
  type ChargeWrittenOffPayload,
  type MandateSignedPayload,
} from '../../domain';
import { BillingCycleJobs, CollectionJobs } from '../jobs/billing-jobs';
import { LedgerWriter } from '../persistence/typeorm-billing.queries';

// A collection attempt started: a job asks the provider, keyed by the attempt.
@Injectable()
@EventSubscriber({ event: BillingEvents.ChargeSubmitted, consumer: 'billing.collect-charge' })
export class CollectOnChargeSubmitted implements EventHandler<ChargeSubmittedPayload> {
  constructor(private readonly jobs: CollectionJobs) {}

  async handle(event: IntegrationEvent<ChargeSubmittedPayload>): Promise<void> {
    await this.jobs.collect(
      {
        chargeId: event.payload.chargeId,
        attemptKey: event.payload.attemptKey,
        eventId: event.eventId,
      },
      event.correlationId,
    );
  }
}

// Charges due while the contract had no mandate wait, scheduled or in dunning; the new one
// collects them.
@Injectable()
@EventSubscriber({ event: BillingEvents.MandateSigned, consumer: 'billing.collect-on-mandate' })
export class CollectOnMandateSigned implements EventHandler<MandateSignedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<MandateSignedPayload>): Promise<void> {
    await this.commands.execute(
      new CollectWaitingChargesCommand(
        event.payload.contractId,
        CalendarDate.fromInstant(new Date(event.occurredAt)),
      ),
    );
  }
}

@Injectable()
@EventSubscriber({ event: LendingEvents.PayoffRequested, consumer: 'billing.charge-payoff' })
export class ChargeOnPayoffRequested implements EventHandler<PayoffRequestedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<PayoffRequestedPayload>): Promise<void> {
    const { planId, contractId, amountCents, asOf } = event.payload;
    await this.commands.execute(
      new CreatePayoffChargeCommand({
        requestId: event.eventId,
        planId,
        contractId,
        amountCents,
        asOf: CalendarDate.parse(asOf),
      }),
    );
  }
}

// The payoff was refused: the cycle skipped the plan meanwhile, so the contract is billed and
// collected as of that day, not on the next run. A job does it, so the plan and each charge get
// their own transaction rather than joining this consumer's.
@Injectable()
@EventSubscriber({ event: LendingEvents.PayoffWithdrawn, consumer: 'billing.rebill-on-withdrawn' })
export class RebillOnPayoffWithdrawn implements EventHandler<PayoffWithdrawnPayload> {
  constructor(private readonly jobs: BillingCycleJobs) {}

  async handle(event: IntegrationEvent<PayoffWithdrawnPayload>): Promise<void> {
    await this.jobs.rebill(
      {
        contractId: event.payload.contractId,
        asOf: CalendarDate.fromInstant(new Date(event.occurredAt)),
        eventId: event.eventId,
      },
      event.correlationId,
    );
  }
}

// Only a payoff makes the open charges unowed: a plan that ends on its last instalment, its cap
// or its last ISA payment ends with that charge, which is still collected.
@Injectable()
@EventSubscriber({ event: LendingEvents.PlanCompleted, consumer: 'billing.close-plan' })
export class CancelChargesOnPlanCompleted implements EventHandler<PlanCompletedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<PlanCompletedPayload>): Promise<void> {
    if (event.payload.reason === 'paid_off') {
      await this.commands.execute(new CancelOpenChargesCommand(event.payload.contractId, 'all'));
    }
  }
}

@Injectable()
@EventSubscriber({ event: LendingEvents.ContractDefaulted, consumer: 'billing.close-defaulted' })
export class CancelChargesOnContractDefaulted implements EventHandler<ContractDefaultedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ContractDefaultedPayload>): Promise<void> {
    await this.commands.execute(
      new CancelOpenChargesCommand(event.payload.contractId, 'scheduled'),
    );
  }
}

const LABELS: Readonly<Record<ChargeCreatedPayload['kind'], string>> = {
  installment: 'Instalment',
  isa: 'Income share',
  payoff: 'Payoff',
};

// The statement: a line per charge, payment, write-off and cancellation, from their events.
@Injectable()
@EventSubscriber({ event: BillingEvents.ChargeCreated, consumer: 'billing.ledger-charge' })
export class LedgerOnChargeCreated implements EventHandler<ChargeCreatedPayload> {
  constructor(private readonly ledger: LedgerWriter) {}

  async handle(event: IntegrationEvent<ChargeCreatedPayload>): Promise<void> {
    const { chargeId, contractId, kind, amountCents, dueDate } = event.payload;
    await this.ledger.append({
      eventId: event.eventId,
      contractId,
      chargeId,
      type: 'charge',
      amountCents,
      description: `${LABELS[kind]} due ${dueDate}`,
      occurredAt: new Date(event.occurredAt),
    });
  }
}

@Injectable()
@EventSubscriber({ event: BillingEvents.ChargePaid, consumer: 'billing.ledger-payment' })
export class LedgerOnChargePaid implements EventHandler<ChargePaidPayload> {
  constructor(private readonly ledger: LedgerWriter) {}

  async handle(event: IntegrationEvent<ChargePaidPayload>): Promise<void> {
    const { chargeId, contractId, amountCents } = event.payload;
    await this.ledger.append({
      eventId: event.eventId,
      contractId,
      chargeId,
      type: 'payment',
      amountCents: -amountCents,
      description: 'Direct debit collected',
      occurredAt: new Date(event.occurredAt),
    });
  }
}

@Injectable()
@EventSubscriber({ event: BillingEvents.ChargeWrittenOff, consumer: 'billing.ledger-write-off' })
export class LedgerOnChargeWrittenOff implements EventHandler<ChargeWrittenOffPayload> {
  constructor(private readonly ledger: LedgerWriter) {}

  async handle(event: IntegrationEvent<ChargeWrittenOffPayload>): Promise<void> {
    const { chargeId, contractId, amountCents } = event.payload;
    await this.ledger.append({
      eventId: event.eventId,
      contractId,
      chargeId,
      type: 'write_off',
      amountCents: -amountCents,
      description: 'Written off after dunning',
      occurredAt: new Date(event.occurredAt),
    });
  }
}

@Injectable()
@EventSubscriber({ event: BillingEvents.ChargeCancelled, consumer: 'billing.ledger-cancellation' })
export class LedgerOnChargeCancelled implements EventHandler<ChargeCancelledPayload> {
  constructor(private readonly ledger: LedgerWriter) {}

  async handle(event: IntegrationEvent<ChargeCancelledPayload>): Promise<void> {
    const { chargeId, contractId, amountCents, reason } = event.payload;
    await this.ledger.append({
      eventId: event.eventId,
      contractId,
      chargeId,
      type: 'cancellation',
      amountCents: -amountCents,
      description:
        reason === 'payoff_failed'
          ? 'Cancelled: the payoff was refused'
          : 'Cancelled: the plan ended',
      occurredAt: new Date(event.occurredAt),
    });
  }
}
