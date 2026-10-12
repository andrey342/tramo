import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError, Money } from '@shared/domain';

import {
  Contract,
  CONTRACT_REPOSITORY,
  type ContractProduct,
  type ContractRepository,
} from '../../domain';
import { CONTRACTING_DIRECTORY, type ContractingDirectory } from '../ports/lending-ports';

// The offer the student accepted, as origination announced it.
export interface AcceptedOffer {
  readonly applicationId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly programId: string;
  readonly programName: string;
  readonly principalCents: number;
  readonly product: ContractProduct;
}

// Draws up the contract of an accepted offer. Idempotent by application: a redelivered
// OfferAccepted finds the contract already there and returns it. Two deliveries of one event never
// run at once (the consumer's claim on it); a second OfferAccepted for the same application would
// hit the unique index and be retried, finding the contract.
export class DrawUpContractCommand extends Command<string> {
  constructor(readonly offer: AcceptedOffer) {
    super();
  }
}

@CommandHandler(DrawUpContractCommand)
export class DrawUpContractHandler implements ICommandHandler<DrawUpContractCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(CONTRACTING_DIRECTORY) private readonly catalog: ContractingDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: DrawUpContractCommand): Promise<string> {
    const { offer } = command;
    return this.uow.run(async () => {
      const existing = await this.contracts.findByApplicationId(offer.applicationId);
      if (existing) {
        return existing.id;
      }
      const details = await this.catalog.contractingDetails(offer.centerId, offer.programId);
      // Centers and programs are never deleted: the job retries, then dead-letters it for ops.
      if (!details) {
        throw new EntityNotFoundError('Program', offer.programId);
      }
      const contract = Contract.draw({
        id: uuidv7(),
        applicationId: offer.applicationId,
        studentId: offer.studentId,
        centerId: offer.centerId,
        program: {
          programId: offer.programId,
          name: offer.programName,
          durationWeeks: details.programDurationWeeks,
        },
        terms: {
          principal: Money.fromCents(offer.principalCents),
          platformFee: details.platformFee,
          product: offer.product,
        },
        now: this.clock.now(),
      });
      await this.contracts.save(contract);
      return contract.id;
    });
  }
}
