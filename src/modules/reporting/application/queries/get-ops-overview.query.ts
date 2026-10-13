import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { CalendarDate, CLOCK, type Clock } from '@shared/domain';

import { type OpsOverviewDto } from '../dto/reporting.dto';
import {
  QUEUE_HEALTH,
  type QueueHealth,
  REPORTING_STORE,
  type ReportingStore,
} from '../ports/reporting-ports';
import { assertStaff } from '../reporting-access';

// What operations should look at this morning: applications waiting for an analyst, collections
// that failed today, transfers to centers not settled or failed, contracts in arrears, and jobs
// in the dead-letter queue.
export class GetOpsOverviewQuery extends Query<OpsOverviewDto> {
  constructor(readonly actor: Principal) {
    super();
  }
}

@QueryHandler(GetOpsOverviewQuery)
export class GetOpsOverviewHandler implements IQueryHandler<GetOpsOverviewQuery> {
  constructor(
    @Inject(REPORTING_STORE) private readonly store: ReportingStore,
    @Inject(QUEUE_HEALTH) private readonly queues: QueueHealth,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(query: GetOpsOverviewQuery): Promise<OpsOverviewDto> {
    assertStaff(query.actor);
    const now = this.clock.now();
    const [figures, deadLetters] = await Promise.all([
      this.store.opsFigures(CalendarDate.fromInstant(now).toString()),
      this.queues.deadLetters(),
    ]);
    return { ...figures, deadLetters, generatedAt: now };
  }
}
