import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { DISBURSEMENT_REPOSITORY, type DisbursementRepository } from '../../domain';
import { BANK_TRANSFER_PROVIDER, type BankTransferProvider } from '../ports/lending-ports';

// What the bank says about a sent transfer. 'pending' asks the job to look again later.
export type SettlementCheck = 'settled' | 'failed' | 'pending' | 'nothing_to_check';

// Asks the bank whether a sent transfer has settled. Run by a job, after DisbursementSent.
export class CheckDisbursementSettlementCommand extends Command<SettlementCheck> {
  constructor(readonly disbursementId: string) {
    super();
  }
}

@CommandHandler(CheckDisbursementSettlementCommand)
export class CheckDisbursementSettlementHandler implements ICommandHandler<CheckDisbursementSettlementCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(DISBURSEMENT_REPOSITORY) private readonly disbursements: DisbursementRepository,
    @Inject(BANK_TRANSFER_PROVIDER) private readonly bank: BankTransferProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CheckDisbursementSettlementCommand): Promise<SettlementCheck> {
    const disbursement = await this.disbursements.findById(command.disbursementId);
    if (disbursement?.status !== 'sent' || !disbursement.transferId) {
      return 'nothing_to_check';
    }
    const transferId = disbursement.transferId;
    const status = await this.bank.status(transferId);
    if (status.state === 'pending') {
      return 'pending';
    }
    return this.uow.run(async () => {
      const fresh = await this.disbursements.findById(command.disbursementId);
      if (fresh?.status !== 'sent' || fresh.transferId !== transferId) {
        return 'nothing_to_check';
      }
      const now = this.clock.now();
      if (status.state === 'settled') {
        fresh.settle(now);
      } else {
        fresh.fail(status.reason, now);
      }
      await this.disbursements.save(fresh);
      return status.state;
    });
  }
}
