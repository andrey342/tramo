import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { AUDIT_TRAIL, type AuditTrail, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  type ContractStatus,
  EnvelopeNotRecordedError,
} from '../../domain';

// What the e-signature provider reports about an envelope, once its callback is authenticated.
export type SignatureEvent =
  | {
      readonly type: 'signed';
      readonly envelopeId: string;
      readonly documentHash: string;
      readonly occurredAt: Date;
    }
  | {
      readonly type: 'declined' | 'expired';
      readonly envelopeId: string;
      readonly occurredAt: Date;
    };

export class RecordSignatureEventCommand extends Command<{
  readonly id: string;
  readonly status: ContractStatus;
}> {
  constructor(readonly event: SignatureEvent) {
    super();
  }
}

// Providers deliver callbacks at least once and retry any answer but a success. A callback about
// an envelope whose outcome is settled (repeated, or completed after a decline, expired after
// signing) is answered with the contract as it is and writes nothing: a conflict would be
// retried for ever, since nothing can make it succeed. A conflict is kept for what a retry can
// fix (an envelope not recorded yet, a concurrent write). The change of status is recorded in
// the audit log with the contract it happened to.
@CommandHandler(RecordSignatureEventCommand)
export class RecordSignatureEventHandler implements ICommandHandler<RecordSignatureEventCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    command: RecordSignatureEventCommand,
  ): Promise<{ readonly id: string; readonly status: ContractStatus }> {
    const { event } = command;
    return this.uow.run(async () => {
      const contract = await this.contracts.findByEnvelopeId(event.envelopeId);
      if (!contract) {
        throw new EnvelopeNotRecordedError(event.envelopeId);
      }
      if (!contract.awaitsSignature) {
        return { id: contract.id, status: contract.status };
      }
      const before = contract.status;
      const now = this.clock.now();
      if (event.type === 'signed') {
        contract.sign(
          {
            envelopeId: event.envelopeId,
            documentHash: event.documentHash,
            signedAt: event.occurredAt,
          },
          now,
        );
      } else {
        contract.cancel(
          event.type === 'declined' ? 'signature_declined' : 'signature_expired',
          now,
        );
      }
      await this.contracts.save(contract);
      this.audit.describeChanges({ status: { before, after: contract.status } });
      return { id: contract.id, status: contract.status };
    });
  }
}
