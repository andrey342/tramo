import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, Iban, unwrap } from '@shared/domain';

import {
  CHARGE_REPOSITORY,
  type ChargeRepository,
  ContractNotRepayingError,
  PAYMENT_MANDATE_REPOSITORY,
  PaymentMandate,
  type PaymentMandateRepository,
} from '../../domain';
import { findOwnContract } from '../billing-access';
import { toMandateDto } from '../billing.mapping';
import { type MandateDto } from '../dto/billing.dto';
import { REPAYMENT_PLANS, type RepaymentPlans } from '../ports/billing-ports';

// Signed, active or in arrears: a contract whose charges are, or will be, collected.
const COLLECTED_STATUSES = ['signed', 'active', 'in_arrears'];

// The student authorises the direct debit of a contract's charges from an account of theirs. A
// new mandate replaces the one in force (a new account).
export class SignMandateCommand extends Command<MandateDto> {
  constructor(
    readonly actor: Principal,
    readonly contractId: string,
    readonly iban: string,
  ) {
    super();
  }
}

@CommandHandler(SignMandateCommand)
export class SignMandateHandler implements ICommandHandler<SignMandateCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(PAYMENT_MANDATE_REPOSITORY) private readonly mandates: PaymentMandateRepository,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(REPAYMENT_PLANS) private readonly plans: RepaymentPlans,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: SignMandateCommand): Promise<MandateDto> {
    const iban = unwrap(Iban.create(command.iban));
    return this.uow.run(async () => {
      const contract = await findOwnContract(this.plans, command.actor, command.contractId);
      if (!COLLECTED_STATUSES.includes(contract.status)) {
        throw new ContractNotRepayingError(contract.status);
      }
      // Under the contract's lock: a collection reading the mandate in force waits for the swap.
      await this.charges.lockContract(contract.id);
      const now = this.clock.now();
      const current = await this.mandates.findActiveByContract(contract.id);
      if (current) {
        current.revoke(now);
        await this.mandates.save(current);
      }
      const mandate = PaymentMandate.sign({
        id: uuidv7(),
        contractId: contract.id,
        studentId: contract.studentId,
        iban,
        now,
      });
      await this.mandates.save(mandate);
      return toMandateDto(mandate);
    });
  }
}
