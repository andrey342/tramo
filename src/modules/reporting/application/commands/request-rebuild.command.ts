import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { AUDIT_TRAIL, type AuditTrail, type Principal, principalId } from '@shared/application';

import { REBUILD_JOBS, type RebuildJobs } from '../ports/reporting-ports';
import { assertStaff } from '../reporting-access';

// Ops ask for the read models to be rebuilt (after a fix to a projection, or to prove they are
// disposable); a job does it. One at a time: a request while one is queued joins it.
export class RequestRebuildCommand extends Command<{ readonly queued: boolean }> {
  constructor(readonly actor: Principal) {
    super();
  }
}

@CommandHandler(RequestRebuildCommand)
export class RequestRebuildHandler implements ICommandHandler<RequestRebuildCommand> {
  constructor(
    @Inject(REBUILD_JOBS) private readonly jobs: RebuildJobs,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  async execute(command: RequestRebuildCommand): Promise<{ readonly queued: boolean }> {
    assertStaff(command.actor);
    const queued = await this.jobs.request(principalId(command.actor));
    // A request while a rebuild is queued joins it.
    this.audit.describeChanges({ rebuild: { before: null, after: queued ? 'queued' : 'joined' } });
    return { queued };
  }
}
