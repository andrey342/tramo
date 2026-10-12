import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, Iban, unwrap } from '@shared/domain';

import {
  type Creditor,
  type Disbursement,
  DISBURSEMENT_REPOSITORY,
  type DisbursementRepository,
} from '../../domain';
import {
  BANK_TRANSFER_PROVIDER,
  type BankTransferProvider,
  CONTRACTING_DIRECTORY,
  type ContractingDirectory,
} from '../ports/lending-ports';

// Makes the bank transfer of a pending disbursement. Run by a job, after DisbursementRequested
// or DisbursementRetried, and by ops reconciling a stuck one.
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
    const creditor = disbursement.creditor ?? (await this.start(disbursement));
    if (!creditor) {
      return;
    }
    // Outside any transaction. A repeated run of the attempt (the bank timed out, saving failed)
    // sends the same key to the same account, so the bank answers with the transfer it made.
    const { transferId } = await this.bank.transfer({
      idempotencyKey: disbursement.idempotencyKey,
      amount: disbursement.amount,
      creditorIban: creditor.iban.value,
      creditorName: creditor.holderName,
      reference: `Tramo disbursement ${disbursement.contractId}`,
    });
    await this.update(command.disbursementId, attempt, (fresh, now) => {
      fresh.markSent(transferId, now);
    });
  }

  // Reads the payout account now, not when the contract was signed (a center that corrected its
  // IBAN after a bounce is paid into the new one), and records it before the bank is called.
  // An inactive center, or one without an account, fails the attempt: nothing was sent.
  private async start(disbursement: Disbursement): Promise<Creditor | null> {
    const account = await this.catalog.payoutAccount(disbursement.centerId);
    let creditor: Creditor | null = null;
    await this.update(disbursement.id, disbursement.attempt, (fresh, now) => {
      if (!account?.centerActive) {
        fresh.fail(account ? 'center_not_active' : 'no_payout_account', now);
        return;
      }
      creditor = fresh.startTransfer({
        iban: unwrap(Iban.create(account.iban)),
        holderName: account.holderName,
      });
    });
    return creditor;
  }

  // On the fresh version, and only for the attempt this run was made for.
  private async update(
    disbursementId: string,
    attempt: number,
    change: (disbursement: Disbursement, now: Date) => void,
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
