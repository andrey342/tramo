import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { DISBURSEMENT_REPOSITORY, type DisbursementRepository } from '../../domain';
import {
  BANK_TRANSFER_PROVIDER,
  type BankTransferProvider,
  CONTRACTING_DIRECTORY,
  type ContractingDirectory,
} from '../ports/lending-ports';

// Makes the bank transfer of a pending disbursement. Run by a job, after DisbursementRequested
// or DisbursementRetried.
export class ExecuteDisbursementCommand extends Command<void> {
  constructor(readonly disbursementId: string) {
    super();
  }
}

@CommandHandler(ExecuteDisbursementCommand)
export class ExecuteDisbursementHandler implements ICommandHandler<ExecuteDisbursementCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(DISBURSEMENT_REPOSITORY) private readonly disbursements: DisbursementRepository,
    @Inject(CONTRACTING_DIRECTORY) private readonly catalog: ContractingDirectory,
    @Inject(BANK_TRANSFER_PROVIDER) private readonly bank: BankTransferProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: ExecuteDisbursementCommand): Promise<void> {
    const disbursement = await this.disbursements.findById(command.disbursementId);
    // Sent, settled or failed already: a repeated job has nothing to do.
    if (disbursement?.status !== 'pending') {
      return;
    }
    const attempt = disbursement.attempt;
    // Read now, not when the contract was signed: a center that corrected its IBAN after a
    // bounced transfer is paid into the new one on the retry.
    const account = await this.catalog.payoutAccount(disbursement.centerId);
    if (!account?.centerActive) {
      await this.update(command.disbursementId, attempt, (fresh, now) => {
        fresh.fail(account ? 'center_not_active' : 'no_payout_account', now);
      });
      return;
    }
    // Outside any transaction. Idempotent by key: if saving below fails, the job's retry asks
    // again and the bank answers with the same transfer.
    const { transferId } = await this.bank.transfer({
      idempotencyKey: disbursement.idempotencyKey,
      amount: disbursement.amount,
      creditorIban: account.iban,
      creditorName: account.holderName,
      reference: `Tramo disbursement ${disbursement.contractId}`,
    });
    await this.update(command.disbursementId, attempt, (fresh, now) => {
      fresh.markSent(transferId, now);
    });
  }

  // On the fresh version, and only for the attempt this job was made for.
  private async update(
    disbursementId: string,
    attempt: number,
    change: (
      disbursement: NonNullable<Awaited<ReturnType<DisbursementRepository['findById']>>>,
      now: Date,
    ) => void,
  ): Promise<void> {
    await this.uow.run(async () => {
      const fresh = await this.disbursements.findById(disbursementId);
      if (fresh?.status !== 'pending' || fresh.attempt !== attempt) {
        return;
      }
      change(fresh, this.clock.now());
      await this.disbursements.save(fresh);
    });
  }
}
