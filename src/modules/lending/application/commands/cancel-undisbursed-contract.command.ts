import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Principal,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  ContractAccessDeniedError,
  CONTRACT_REPOSITORY,
  type ContractRepository,
  DISBURSEMENT_REPOSITORY,
  type DisbursementRepository,
  DisbursementNotFailedError,
} from '../../domain';
import { isStaff } from '../contract-access';
import { toContractDto } from '../contract.mapping';
import { type ContractDto } from '../dto/contract.dto';

// Ops give up on a signed contract whose disbursement failed for good (the center closed, or
// its account cannot be fixed): the disbursement is cancelled, never to be retried, and so is the
// contract, before it took effect. The center was not paid and no plan was opened, so the
// student owes nothing; ContractCancelled frees their application. A repeated request finds the
// contract cancelled and changes nothing.
export class CancelUndisbursedContractCommand extends Command<ContractDto> {
  constructor(
    readonly actor: Principal,
    readonly contractId: string,
  ) {
    super();
  }
}

@CommandHandler(CancelUndisbursedContractCommand)
export class CancelUndisbursedContractHandler implements ICommandHandler<CancelUndisbursedContractCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(DISBURSEMENT_REPOSITORY) private readonly disbursements: DisbursementRepository,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CancelUndisbursedContractCommand): Promise<ContractDto> {
    if (!isStaff(command.actor)) {
      throw new ContractAccessDeniedError();
    }
    return this.uow.run(async () => {
      const contract = await this.contracts.findById(command.contractId);
      if (!contract) {
        throw new EntityNotFoundError('Contract', command.contractId);
      }
      const disbursement = await this.disbursements.findByContractId(contract.id);
      if (contract.status !== 'cancelled') {
        // Pending or sent, money may be on its way; settled, the contract is in force. A retry
        // racing this request changes the disbursement's version, and one of the two is refused.
        if (disbursement?.status !== 'failed') {
          throw new DisbursementNotFailedError(disbursement?.status ?? null);
        }
        const before = contract.status;
        const now = this.clock.now();
        disbursement.cancel(now);
        contract.cancel('disbursement_failed', now);
        await this.disbursements.save(disbursement);
        await this.contracts.save(contract);
        this.audit.describeChanges({ status: { before, after: contract.status } });
      }
      return toContractDto(contract, { visible: true, disbursement });
    });
  }
}
