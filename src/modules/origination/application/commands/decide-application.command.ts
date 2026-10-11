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
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
} from '../../domain';
import { isStaff } from '../application-access';
import { toApplicationDto } from '../application.mapping';
import { type ApplicationDto } from '../dto/application.dto';

export class DecideApplicationCommand extends Command<ApplicationDto> {
  constructor(
    readonly actor: Principal,
    readonly applicationId: string,
    readonly outcome: 'approved' | 'rejected',
    readonly reason: string,
  ) {
    super();
  }
}

// An analyst settles an application the engine sent to review, with a reason that the student
// sees in the decision explanation.
@CommandHandler(DecideApplicationCommand)
export class DecideApplicationHandler implements ICommandHandler<DecideApplicationCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: DecideApplicationCommand): Promise<ApplicationDto> {
    const { actor } = command;
    return this.uow.run(async () => {
      const application = await this.applications.findById(command.applicationId);
      if (!application || actor.kind !== 'user' || !isStaff(actor)) {
        throw new EntityNotFoundError('FinancingApplication', command.applicationId);
      }
      const before = application.status;
      application.decideManually(
        { outcome: command.outcome, reason: command.reason, decidedBy: actor.userId },
        this.clock.now(),
      );
      await this.applications.save(application);
      this.audit.describeChanges({
        status: { before, after: application.status },
        reason: { before: null, after: application.manualDecision?.reason ?? null },
      });
      return toApplicationDto(application, { withProfile: true });
    });
  }
}
