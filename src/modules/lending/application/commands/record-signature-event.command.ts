import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import { CONTRACT_REPOSITORY, type ContractRepository } from '../../domain';

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

export class RecordSignatureEventCommand extends Command<void> {
  constructor(readonly event: SignatureEvent) {
    super();
  }
}

// Providers deliver callbacks at least once: a repeated "signed" changes nothing (Contract.sign
// and Contract.cancel are idempotent).
@CommandHandler(RecordSignatureEventCommand)
export class RecordSignatureEventHandler implements ICommandHandler<RecordSignatureEventCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RecordSignatureEventCommand): Promise<void> {
    const { event } = command;
    await this.uow.run(async () => {
      const contract = await this.contracts.findByEnvelopeId(event.envelopeId);
      if (!contract) {
        throw new EntityNotFoundError('Envelope', event.envelopeId);
      }
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
    });
  }
}
