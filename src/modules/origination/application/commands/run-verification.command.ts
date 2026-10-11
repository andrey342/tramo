import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, ConcurrentModificationError } from '@shared/domain';

import {
  type CompleteProfile,
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
  type VerificationResult,
  type VerificationType,
} from '../../domain';
import {
  CREDIT_BUREAU,
  type CreditBureau,
  EMPLOYMENT_HISTORY_PROVIDER,
  type EmploymentHistoryProvider,
  KYC_PROVIDER,
  type KycProvider,
} from '../ports/origination-ports';

// Asks one provider about the applicant and records the answer. Run by the verification jobs.
export class RunVerificationCommand extends Command<void> {
  constructor(
    readonly applicationId: string,
    readonly type: VerificationType,
  ) {
    super();
  }
}

// The three jobs of an application run in parallel and save the same aggregate, so one may lose
// the optimistic lock to another: the answer is then recorded again on the fresh version, without
// asking the provider twice.
const SAVE_ATTEMPTS = 5;

@CommandHandler(RunVerificationCommand)
export class RunVerificationHandler implements ICommandHandler<RunVerificationCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(KYC_PROVIDER) private readonly kyc: KycProvider,
    @Inject(EMPLOYMENT_HISTORY_PROVIDER) private readonly employment: EmploymentHistoryProvider,
    @Inject(CREDIT_BUREAU) private readonly bureau: CreditBureau,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RunVerificationCommand): Promise<void> {
    const application = await this.applications.findById(command.applicationId);
    // Cancelled, expired or already answered: a late or repeated job has nothing to do.
    if (!application?.awaitsVerification || application.verifications[command.type] !== null) {
      return;
    }
    // The provider is asked outside any transaction: it can take seconds.
    const result = await this.ask(command.type, application.submittedProfile);

    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.record(command.applicationId, result);
        return;
      } catch (error) {
        if (!(error instanceof ConcurrentModificationError) || attempt >= SAVE_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  private async record(applicationId: string, result: VerificationResult): Promise<void> {
    await this.uow.run(async () => {
      const application = await this.applications.findById(applicationId);
      if (!application?.awaitsVerification) {
        return;
      }
      application.recordVerification(result, this.clock.now());
      await this.applications.save(application);
    });
  }

  private async ask(type: VerificationType, profile: CompleteProfile): Promise<VerificationResult> {
    switch (type) {
      case 'kyc':
        return {
          type,
          result: await this.kyc.verifyIdentity({
            nationalId: profile.nationalId,
            dateOfBirth: profile.dateOfBirth,
          }),
        };
      case 'employment':
        return { type, result: await this.employment.fetch(profile.nationalId) };
      case 'bureau':
        return { type, result: await this.bureau.check(profile.nationalId) };
    }
  }
}
