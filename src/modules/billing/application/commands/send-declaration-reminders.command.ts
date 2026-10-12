import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { EVENT_BUS, type EventBus, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { type CalendarDate, CLOCK, type Clock } from '@shared/domain';

import {
  BillingEvents,
  INCOME_DECLARATION_REPOSITORY,
  type IncomeDeclarationDuePayload,
  type IncomeDeclarationRepository,
} from '../../domain';
import {
  DECLARATION_REMINDERS,
  type DeclarationReminders,
  REPAYMENT_PLANS,
  type RepaymentPlans,
} from '../ports/billing-ports';

const PAGE = 100;

// The 25th: every ISA student whose plan has started and who has not declared this month's income
// is reminded, once per month. The reminder is a fact of no aggregate, so it is published
// directly, in the transaction that records it.
export class SendDeclarationRemindersCommand extends Command<number> {
  constructor(readonly asOf: CalendarDate) {
    super();
  }
}

@CommandHandler(SendDeclarationRemindersCommand)
export class SendDeclarationRemindersHandler implements ICommandHandler<SendDeclarationRemindersCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REPAYMENT_PLANS) private readonly plans: RepaymentPlans,
    @Inject(INCOME_DECLARATION_REPOSITORY)
    private readonly declarations: IncomeDeclarationRepository,
    @Inject(DECLARATION_REMINDERS) private readonly reminders: DeclarationReminders,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: SendDeclarationRemindersCommand): Promise<number> {
    const period = command.asOf.period;
    let sent = 0;
    let after: string | null = null;
    for (;;) {
      const page = await this.plans.billablePlans(after, PAGE);
      for (const plan of page) {
        // Income months run from the plan's first one: nothing to declare before it.
        if (plan.kind !== 'isa' || plan.nextIsaPeriod === null || plan.nextIsaPeriod > period) {
          continue;
        }
        sent += (await this.remind(plan.contractId, plan.studentId, period)) ? 1 : 0;
      }
      if (page.length < PAGE) {
        return sent;
      }
      after = page.at(-1)?.contractId ?? null;
    }
  }

  private remind(contractId: string, studentId: string, period: string): Promise<boolean> {
    return this.uow.run(async () => {
      if (await this.declarations.findByPeriod(contractId, period)) {
        return false;
      }
      if (!(await this.reminders.record(contractId, period))) {
        return false;
      }
      const payload: IncomeDeclarationDuePayload = { contractId, studentId, period };
      await this.events.publish([
        {
          eventType: BillingEvents.IncomeDeclarationDue,
          aggregateType: 'Contract',
          aggregateId: contractId,
          occurredAt: this.clock.now(),
          payload,
        },
      ]);
      return true;
    });
  }
}
