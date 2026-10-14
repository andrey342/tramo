import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CalendarDate, CLOCK, type Clock, EntityNotFoundError, Money } from '@shared/domain';

import { Charge, CHARGE_REPOSITORY, type ChargeRepository } from '../../domain';
import { REPAYMENT_PLANS, type RepaymentPlans } from '../ports/billing-ports';

// A contract defaulted. The charges not yet due are cancelled; those overdue stay as the debt
// and dunning writes them off; those being collected wait for the provider's answer. A loan's
// instalments that are left unbilled (never billed, or just cancelled) are owed at once: their
// principal is raised as one charge and written off, so the loss shows on the statement and in
// the figures. Future interest is not claimed, and an ISA owes nothing beyond the months already
// assessed. Idempotent.
export class CloseDefaultedChargesCommand extends Command<{
  readonly cancelled: number;
  readonly acceleratedCents: number;
}> {
  constructor(
    readonly contractId: string,
    // The day of the default (that of the write-off behind it); today when not known.
    readonly day: CalendarDate | null = null,
  ) {
    super();
  }
}

@CommandHandler(CloseDefaultedChargesCommand)
export class CloseDefaultedChargesHandler implements ICommandHandler<CloseDefaultedChargesCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(REPAYMENT_PLANS) private readonly plans: RepaymentPlans,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    command: CloseDefaultedChargesCommand,
  ): Promise<{ readonly cancelled: number; readonly acceleratedCents: number }> {
    const { contractId } = command;
    return this.uow.run(async () => {
      await this.charges.lockContract(contractId);
      const now = this.clock.now();
      let cancelled = 0;
      for (const charge of await this.charges.findOpen(contractId)) {
        if (charge.status === 'scheduled') {
          charge.cancel(now);
          await this.charges.save(charge);
          cancelled += 1;
        }
      }
      if (await this.charges.findByReference(contractId, 'accelerated')) {
        return { cancelled, acceleratedCents: 0 };
      }
      const unpaid = await this.plans.unpaidPrincipal(contractId);
      if (!unpaid) {
        return { cancelled, acceleratedCents: 0 };
      }
      let acceleratedCents = 0;
      for (const row of unpaid) {
        const billed = await this.charges.findByReference(contractId, `installment:${row.number}`);
        if (!billed || billed.status === 'cancelled') {
          acceleratedCents += row.principalCents;
        }
      }
      if (acceleratedCents === 0) {
        return { cancelled, acceleratedCents };
      }
      const contract = await this.plans.findContract(contractId);
      if (!contract) {
        throw new EntityNotFoundError('Contract', contractId);
      }
      await this.charges.save(
        Charge.accelerate({
          id: uuidv7(),
          contractId,
          studentId: contract.studentId,
          centerId: contract.centerId,
          amount: Money.fromCents(acceleratedCents),
          today: command.day ?? CalendarDate.fromInstant(now),
          now,
        }),
      );
      return { cancelled, acceleratedCents };
    });
  }
}
