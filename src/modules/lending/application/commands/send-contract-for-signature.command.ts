import { createHash } from 'node:crypto';

import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { CONTRACT_REPOSITORY, type ContractRepository, renderContractDocument } from '../../domain';
import { E_SIGNATURE_PROVIDER, type ESignatureProvider } from '../ports/lending-ports';

// Sends a drawn up contract to the student for signature. Run by a job, after ContractCreated.
export class SendContractForSignatureCommand extends Command<void> {
  constructor(readonly contractId: string) {
    super();
  }
}

export const documentHash = (document: string): string =>
  createHash('sha256').update(document, 'utf8').digest('hex');

@CommandHandler(SendContractForSignatureCommand)
export class SendContractForSignatureHandler implements ICommandHandler<SendContractForSignatureCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(E_SIGNATURE_PROVIDER) private readonly signatures: ESignatureProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: SendContractForSignatureCommand): Promise<void> {
    const contract = await this.contracts.findById(command.contractId);
    // Already sent, or cancelled: a repeated job has nothing to do.
    if (contract?.status !== 'draft') {
      return;
    }
    const document = renderContractDocument(contract);
    const hash = documentHash(document);
    // The provider is called outside any transaction; it is idempotent by contract, so a retry
    // after a failure to save below gets the same envelope.
    const { envelopeId } = await this.signatures.sendEnvelope({
      contractId: contract.id,
      studentId: contract.studentId,
      document,
      documentHash: hash,
    });
    await this.uow.run(async () => {
      const fresh = await this.contracts.findById(command.contractId);
      if (fresh?.status !== 'draft') {
        return;
      }
      fresh.sentForSignature(
        { provider: this.signatures.name, envelopeId, documentHash: hash },
        this.clock.now(),
      );
      await this.contracts.save(fresh);
    });
  }
}
