import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import {
  CalendarDate,
  CLOCK,
  type Clock,
  EntityNotFoundError,
  InvalidValueError,
} from '@shared/domain';

import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  FINANCING_PLAN_REPOSITORY,
  type FinancingPlanRepository,
} from '../../domain';
import { canSeeRepayment, findVisibleContract } from '../contract-access';
import { toPayoffQuoteDto } from '../contract.mapping';
import { type PayoffQuoteDto } from '../dto/contract.dto';

// A quote is for today or a day in the coming month, never for the past.
const MAX_DAYS_AHEAD = 31;

export class GetPayoffQuoteQuery extends Query<PayoffQuoteDto> {
  constructor(
    readonly actor: Principal,
    readonly contractId: string,
    readonly asOf: string | undefined,
  ) {
    super();
  }
}

@QueryHandler(GetPayoffQuoteQuery)
export class GetPayoffQuoteHandler implements IQueryHandler<GetPayoffQuoteQuery> {
  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(FINANCING_PLAN_REPOSITORY) private readonly plans: FinancingPlanRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(query: GetPayoffQuoteQuery): Promise<PayoffQuoteDto> {
    const contract = await findVisibleContract(
      this.contracts,
      query.actor,
      query.contractId,
      canSeeRepayment,
    );
    const today = CalendarDate.fromInstant(this.clock.now());
    const asOf = query.asOf ? CalendarDate.parse(query.asOf) : today;
    const ahead = today.daysUntil(asOf);
    if (ahead < 0 || ahead > MAX_DAYS_AHEAD) {
      throw new InvalidValueError(
        'asOf',
        `A payoff is quoted for today or up to ${String(MAX_DAYS_AHEAD)} days ahead.`,
      );
    }
    const plan = await this.plans.findByContractId(contract.id);
    if (!plan) {
      throw new EntityNotFoundError('FinancingPlan', contract.id);
    }
    return toPayoffQuoteDto(contract.id, plan.payoffQuote(asOf));
  }
}
