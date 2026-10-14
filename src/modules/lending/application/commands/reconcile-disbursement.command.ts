import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { AUDIT_TRAIL, type AuditTrail, type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import {
  ContractAccessDeniedError,
  DISBURSEMENT_REPOSITORY,
  type DisbursementRepository,
} from '../../domain';
import { isStaff } from '../contract-access';
import { toDisbursementDto } from '../contract.mapping';
import { type DisbursementDto } from '../dto/contract.dto';

import {
  CheckDisbursementSettlementCommand,
  CheckDisbursementSettlementHandler,
} from './check-disbursement-settlement.command';
import {
  ExecuteDisbursementCommand,
  ExecuteDisbursementHandler,
} from './execute-disbursement.command';

// For a disbursement whose jobs ran out of attempts (a long bank outage, a transfer pending for
// days): ops make the job's step again by hand. A pending attempt is sent again with its own key,
// so the bank never pays it twice; a sent one is checked with the bank. Nothing is failed blindly:
// money may already be out.
export class ReconcileDisbursementCommand extends Command<DisbursementDto> {
  constructor(
    readonly actor: Principal,
    readonly disbursementId: string,
  ) {
    super();
  }
}

@CommandHandler(ReconcileDisbursementCommand)
export class ReconcileDisbursementHandler implements ICommandHandler<ReconcileDisbursementCommand> {
  constructor(
    @Inject(DISBURSEMENT_REPOSITORY) private readonly disbursements: DisbursementRepository,
    private readonly transfer: ExecuteDisbursementHandler,
    private readonly settlement: CheckDisbursementSettlementHandler,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  async execute(command: ReconcileDisbursementCommand): Promise<DisbursementDto> {
    if (!isStaff(command.actor)) {
      throw new ContractAccessDeniedError();
    }
    const disbursement = await this.disbursements.findById(command.disbursementId);
    if (!disbursement) {
      throw new EntityNotFoundError('Disbursement', command.disbursementId);
    }
    if (disbursement.status === 'pending') {
      await this.transfer.execute(new ExecuteDisbursementCommand(disbursement.id));
    } else if (disbursement.status === 'sent') {
      await this.settlement.execute(new CheckDisbursementSettlementCommand(disbursement.id));
    }
    const current = (await this.disbursements.findById(disbursement.id)) ?? disbursement;
    this.audit.describeChanges({ status: { before: disbursement.status, after: current.status } });
    return toDisbursementDto(current);
  }
}
