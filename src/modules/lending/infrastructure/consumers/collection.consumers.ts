import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  type ArrearsClearedPayload,
  BillingEvents,
  type ChargeFailedPayload,
  type ChargePaidPayload,
  type ChargeReturnedPayload,
  type ChargeWrittenOffPayload,
  type ContractInArrearsPayload,
} from '@modules/billing/domain/events/billing-events';
import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';
import { CalendarDate } from '@shared/domain';

import { RecordCollectionStatusCommand } from '../../application/commands/record-collection-status.command';
import { RecordRepaymentCommand } from '../../application/commands/record-repayment.command';

// Billing collects and duns; lending keeps the plan and the contract in step with it.

@Injectable()
@EventSubscriber({ event: BillingEvents.ChargePaid, consumer: 'lending.record-repayment' })
export class RecordRepaymentOnChargePaid implements EventHandler<ChargePaidPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ChargePaidPayload>): Promise<void> {
    const { contractId, kind, installmentNumber } = event.payload;
    // Optional in the type: ChargePaid notices recorded before it carried the attempt.
    const attempt = (event.payload as Partial<ChargePaidPayload>).attempt;
    if (kind === 'installment' && installmentNumber !== null) {
      await this.commands.execute(
        new RecordRepaymentCommand(contractId, {
          kind: 'installment',
          installmentNumber,
          ...(attempt !== undefined && { attempt }),
        }),
      );
    } else if (kind === 'payoff') {
      await this.commands.execute(new RecordRepaymentCommand(contractId, { kind: 'payoff' }));
    } else if (kind === 'isa') {
      // Absent in notices recorded before ISA months were tracked; their plans ended on assessment.
      const period = (event.payload as Partial<ChargePaidPayload>).period;
      if (period) {
        await this.commands.execute(
          new RecordRepaymentCommand(contractId, { kind: 'isa', period }),
        );
      }
    }
  }
}

// The student's bank sent a collected payment back: the instalment, or the ISA month, is unpaid
// again; a payoff finds the plan paid off, which is not reopened (ADR 020).
@Injectable()
@EventSubscriber({ event: BillingEvents.ChargeReturned, consumer: 'lending.record-return' })
export class RecordReturnOnChargeReturned implements EventHandler<ChargeReturnedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ChargeReturnedPayload>): Promise<void> {
    const { contractId, kind, installmentNumber, attempt } = event.payload;
    if (kind === 'installment' && installmentNumber !== null) {
      await this.commands.execute(
        new RecordRepaymentCommand(contractId, {
          kind: 'installment_returned',
          installmentNumber,
          attempt,
        }),
      );
    } else if (kind === 'payoff') {
      await this.commands.execute(
        new RecordRepaymentCommand(contractId, { kind: 'payoff_returned' }),
      );
    } else if (kind === 'isa') {
      const period = (event.payload as Partial<ChargeReturnedPayload>).period;
      if (period) {
        await this.commands.execute(
          new RecordRepaymentCommand(contractId, { kind: 'isa_returned', period }),
        );
      }
    }
  }
}

// A payoff the bank refused is withdrawn: the plan is billed as before and the student may ask
// again.
@Injectable()
@EventSubscriber({ event: BillingEvents.ChargeFailed, consumer: 'lending.withdraw-payoff' })
export class WithdrawPayoffOnChargeFailed implements EventHandler<ChargeFailedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ChargeFailedPayload>): Promise<void> {
    if (event.payload.kind === 'payoff') {
      await this.commands.execute(
        new RecordRepaymentCommand(event.payload.contractId, { kind: 'payoff_failed' }),
      );
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
    // Events recorded before the day was carried have none.
    const { writtenOffOn } = event.payload as Partial<ChargeWrittenOffPayload>;
    await this.commands.execute(
      new RecordCollectionStatusCommand(
        event.payload.contractId,
        'defaulted',
        new Date(event.occurredAt),
        writtenOffOn ? CalendarDate.parse(writtenOffOn) : null,
      ),
    );
  }
}
