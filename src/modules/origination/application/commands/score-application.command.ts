import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
  RISK_POLICY_REPOSITORY,
  type RiskPolicyRepository,
  ScoringEngine,
} from '../../domain';

// Run when the last verification is in. Does nothing unless the application is waiting for its
// score, so a repeated event scores it once.
export class ScoreApplicationCommand extends Command<void> {
  constructor(readonly applicationId: string) {
    super();
  }
}

@CommandHandler(ScoreApplicationCommand)
export class ScoreApplicationHandler implements ICommandHandler<ScoreApplicationCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(RISK_POLICY_REPOSITORY) private readonly policies: RiskPolicyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: ScoreApplicationCommand): Promise<void> {
    await this.uow.run(async () => {
      const application = await this.applications.findById(command.applicationId);
      if (application?.status !== 'scoring') {
        return;
      }
      const { kyc, employment, bureau } = application.verifications;
      const policy = await this.policies.findCurrent();
      if (!kyc || !employment || !bureau || !policy) {
        // The aggregate only reaches scoring with all three answers; the first policy is seeded
        // by a migration. Either missing is a broken deployment, not a decision to make.
        throw new Error(`Application ${application.id} cannot be scored: missing data or policy.`);
      }
      const now = this.clock.now();
      const decision = ScoringEngine.decide(
        {
          profile: application.submittedProfile,
          program: application.program,
          product: application.product,
          kyc,
          employment,
          bureau,
        },
        policy,
        now,
      );
      application.decide(decision, now);
      await this.applications.save(application);
    });
  }
}
