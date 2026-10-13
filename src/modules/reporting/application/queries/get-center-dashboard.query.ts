import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { centerFigures, shareOf } from '../../domain';
import { type CenterDashboardDto } from '../dto/reporting.dto';
import { REPORTING_STORE, type ReportingStore } from '../ports/reporting-ports';
import { assertCanSeeCenter } from '../reporting-access';

// A center's portfolio: its applications by stage, its contracts by state and product, what was
// paid to it, collected and still owed, and how many of the contracts being repaid are behind.
export class GetCenterDashboardQuery extends Query<CenterDashboardDto> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
  ) {
    super();
  }
}

@QueryHandler(GetCenterDashboardQuery)
export class GetCenterDashboardHandler implements IQueryHandler<GetCenterDashboardQuery> {
  constructor(
    @Inject(REPORTING_STORE) private readonly store: ReportingStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(query: GetCenterDashboardQuery): Promise<CenterDashboardDto> {
    assertCanSeeCenter(query.actor, query.centerId);
    const figures = centerFigures(await this.store.centerRows(query.centerId));
    const { active, inArrears } = figures.contracts;
    return {
      centerId: query.centerId,
      ...figures,
      delinquencyRateBasisPoints: shareOf(inArrears, active + inArrears)?.basisPoints ?? null,
      generatedAt: this.clock.now(),
    };
  }
}
