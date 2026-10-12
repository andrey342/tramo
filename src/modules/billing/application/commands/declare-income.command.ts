import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, Money } from '@shared/domain';

import {
  ContractNotRepayingError,
  IncomeAlreadyDeclaredError,
  IncomeDeclaration,
  INCOME_DECLARATION_REPOSITORY,
  type IncomeDeclarationRepository,
  NotAnIncomeShareError,
} from '../../domain';
import { findOwnContract } from '../billing-access';
import { toDeclarationDto } from '../billing.mapping';
import { type IncomeDeclarationDto } from '../dto/billing.dto';
import { REPAYMENT_PLANS, type RepaymentPlans } from '../ports/billing-ports';

// An ISA student declares what they earned in a month; the billing cycle charges the share of it
// the plan's rules set. Declaring nothing pauses the month.
export class DeclareIncomeCommand extends Command<IncomeDeclarationDto> {
  constructor(
    readonly actor: Principal,
    readonly contractId: string,
    readonly period: string,
    readonly grossMonthlyIncomeCents: number,
  ) {
    super();
  }
}

@CommandHandler(DeclareIncomeCommand)
export class DeclareIncomeHandler implements ICommandHandler<DeclareIncomeCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(INCOME_DECLARATION_REPOSITORY)
    private readonly declarations: IncomeDeclarationRepository,
    @Inject(REPAYMENT_PLANS) private readonly plans: RepaymentPlans,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: DeclareIncomeCommand): Promise<IncomeDeclarationDto> {
    return this.uow.run(async () => {
      const contract = await findOwnContract(this.plans, command.actor, command.contractId);
      if (contract.product !== 'isa') {
        throw new NotAnIncomeShareError();
      }
      if (contract.status !== 'active' && contract.status !== 'in_arrears') {
        throw new ContractNotRepayingError(contract.status);
      }
      if (await this.declarations.findByPeriod(contract.id, command.period)) {
        throw new IncomeAlreadyDeclaredError(command.period);
      }
      const declaration = IncomeDeclaration.declare({
        id: uuidv7(),
        contractId: contract.id,
        studentId: contract.studentId,
        period: command.period,
        grossMonthlyIncome: Money.fromCents(command.grossMonthlyIncomeCents),
        source: 'self',
        now: this.clock.now(),
      });
      await this.declarations.save(declaration);
      return toDeclarationDto(declaration);
    });
  }
}
