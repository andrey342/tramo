import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  type ArrearsClearedPayload,
  BillingEvents,
  type ChargePaidPayload,
  type ChargeWrittenOffPayload,
  type ContractInArrearsPayload,
} from '@modules/billing/domain/events/billing-events';
import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';

import { RecordCollectionStatusCommand } from '../../application/commands/record-collection-status.command';
import { RecordRepaymentCommand } from '../../application/commands/record-repayment.command';

// Billing collects and duns; lending keeps the plan and the contract in step with it.

@Injectable()
@EventSubscriber({ event: BillingEvents.ChargePaid, consumer: 'lending.record-repayment' })
export class RecordRepaymentOnChargePaid implements EventHandler<ChargePaidPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ChargePaidPayload>): Promise<void> {
    const { contractId, kind, installmentNumber } = event.payload;
    if (kind === 'installment' && installmentNumber !== null) {
      await this.commands.execute(
        new RecordRepaymentCommand(contractId, { kind: 'installment', installmentNumber }),
      );
    } else if (kind === 'payoff') {
      await this.commands.execute(new RecordRepaymentCommand(contractId, { kind: 'payoff' }));
    }
  }
}

@Injectable()
@EventSubscriber({ event: BillingEvents.ContractInArrears, consumer: 'lending.mark-in-arrears' })
export class MarkInArrearsOnContractInArrears implements EventHandler<ContractInArrearsPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ContractInArrearsPayload>): Promise<void> {
    await this.commands.execute(
      new RecordCollectionStatusCommand(
        event.payload.contractId,
        'in_arrears',
        new Date(event.occurredAt),
      ),
    );
  }
}

@Injectable()
@EventSubscriber({ event: BillingEvents.ArrearsCleared, consumer: 'lending.clear-arrears' })
export class ClearArrearsOnArrearsCleared implements EventHandler<ArrearsClearedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ArrearsClearedPayload>): Promise<void> {
    await this.commands.execute(
      new RecordCollectionStatusCommand(
        event.payload.contractId,
        'current',
        new Date(event.occurredAt),
      ),
    );
  }
}

@Injectable()
@EventSubscriber({ event: BillingEvents.ChargeWrittenOff, consumer: 'lending.declare-default' })
export class DefaultOnChargeWrittenOff implements EventHandler<ChargeWrittenOffPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ChargeWrittenOffPayload>): Promise<void> {
    await this.commands.execute(
      new RecordCollectionStatusCommand(
        event.payload.contractId,
        'defaulted',
        new Date(event.occurredAt),
      ),
    );
  }
}
