import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  type ContractCancelledPayload,
  type ContractCompletedPayload,
  LendingEvents,
} from '@modules/lending/domain/events/lending-events';
import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';

import { RecordContractOutcomeCommand } from '../../application/commands/record-contract-outcome.command';

// Lending tells what became of the contract drawn from an accepted offer; the application follows
// it, so the student may finance the program again once that contract no longer holds it.

@Injectable()
@EventSubscriber({
  event: LendingEvents.ContractCancelled,
  consumer: 'origination.withdraw-application',
})
export class WithdrawApplicationOnContractCancelled implements EventHandler<ContractCancelledPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ContractCancelledPayload>): Promise<void> {
    await this.commands.execute(
      new RecordContractOutcomeCommand(event.payload.applicationId, 'cancelled'),
    );
  }
}

@Injectable()
@EventSubscriber({
  event: LendingEvents.ContractCompleted,
  consumer: 'origination.close-application',
})
export class CloseApplicationOnContractCompleted implements EventHandler<ContractCompletedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<ContractCompletedPayload>): Promise<void> {
    await this.commands.execute(
      new RecordContractOutcomeCommand(event.payload.applicationId, 'completed'),
    );
  }
}
