import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CalendarDate, CLOCK, type Clock, EntityNotFoundError, Money } from '@shared/domain';

import {
  ContractAccessDeniedError,
  CONTRACT_REPOSITORY,
  type ContractRepository,
  FINANCING_PLAN_REPOSITORY,
  type FinancingPlanRepository,
} from '../../domain';
import { findVisibleContract, isStudentOf } from '../contract-access';
import { toPayoffQuoteDto } from '../contract.mapping';
import { type PayoffQuoteDto } from '../dto/contract.dto';

// The student repays everything today, for the amount they were quoted: if the quote has moved
// (an instalment fell due, a day of interest accrued), they are told instead of charged a
// different amount. Billing collects it (PayoffRequested).
export class RequestPayoffCommand extends Command<PayoffQuoteDto> {
  constructor(
    readonly actor: Principal,
    readonly contractId: string,
    readonly expectedAmountCents: number,
  ) {
    super();
  }
}

@CommandHandler(RequestPayoffCommand)
export class RequestPayoffHandler implements ICommandHandler<RequestPayoffCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(FINANCING_PLAN_REPOSITORY) private readonly plans: FinancingPlanRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RequestPayoffCommand): Promise<PayoffQuoteDto> {
    return this.uow.run(async () => {
      const contract = await findVisibleContract(this.contracts, command.actor, command.contractId);
      if (!isStudentOf(command.actor, contract)) {
        throw new ContractAccessDeniedError();
      }
      const plan = await this.plans.findByContractId(contract.id);
      if (!plan) {
        throw new EntityNotFoundError('FinancingPlan', contract.id);
      }
      const now = this.clock.now();
      const today = CalendarDate.fromInstant(now);
      const quote = plan.requestPayoff(today, Money.fromCents(command.expectedAmountCents), now);
      await this.plans.save(plan);
      return toPayoffQuoteDto(contract.id, quote);
    });
  }
}
