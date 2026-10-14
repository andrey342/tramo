import { Inject } from '@nestjs/common';
import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CalendarDate, CLOCK, type Clock, EntityNotFoundError, Money } from '@shared/domain';

import { FINANCING_PLAN_REPOSITORY, type FinancingPlanRepository } from '../../domain';
import { AssessIsaPeriodCommand, type IsaAssessmentDto } from '../dto/plan-lookup';

@CommandHandler(AssessIsaPeriodCommand)
export class AssessIsaPeriodHandler implements ICommandHandler<AssessIsaPeriodCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_PLAN_REPOSITORY) private readonly plans: FinancingPlanRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: AssessIsaPeriodCommand): Promise<IsaAssessmentDto> {
    return this.uow.run(async () => {
      const plan = await this.plans.findByContractId(command.contractId);
      if (!plan) {
        throw new EntityNotFoundError('FinancingPlan', command.contractId);
      }
      const assessment = plan.assessPeriod(
        CalendarDate.parse(`${command.period}-01`),
        command.declaredIncomeCents === null ? null : Money.fromCents(command.declaredIncomeCents),
        this.clock.now(),
      );
      // A month before the first one charged changes nothing.
      if (assessment.outcome !== 'not_started') {
        await this.plans.save(plan);
      }
      // No more months to assess: the plan itself ends once they are collected.
      const planEnded = plan.assessmentsEnded;
      return assessment.outcome === 'charge'
        ? { outcome: 'charge', amountCents: assessment.amount.cents, planEnded }
        : { ...assessment, planEnded };
    });
  }
}
