import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiAcceptedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems, Idempotent } from '@shared/infrastructure/http';
import { RequireScopes, Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { RequestRebuildCommand } from '../../application/commands/request-rebuild.command';
import {
  type CenterDashboardDto,
  type OpsOverviewDto,
  type ProgramPerformanceDto,
} from '../../application/dto/reporting.dto';
import { GetCenterDashboardQuery } from '../../application/queries/get-center-dashboard.query';
import { GetOpsOverviewQuery } from '../../application/queries/get-ops-overview.query';
import { GetProgramPerformanceQuery } from '../../application/queries/get-program-performance.query';

import {
  CenterDashboardResponse,
  OpsOverviewResponse,
  ProgramPerformanceResponse,
  RebuildResponse,
} from './reporting.dto';

@ApiTags('reporting')
@Controller()
export class ReportingController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get('centers/:centerId/dashboard')
  @ApiProblems(400, 401, 403)
  @ApiOkResponse({ type: CenterDashboardResponse })
  @Roles('center_admin', 'ops', 'admin')
  @RequireScopes('portfolio:read')
  @ApiOperation({
    summary: 'The portfolio of a center: funnel, contracts, money disbursed, collected and owed',
  })
  dashboard(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
  ): Promise<CenterDashboardDto> {
    return this.queries.execute(new GetCenterDashboardQuery(actor, centerId));
  }

  @Get('centers/:centerId/programs/:programId/performance')
  @ApiProblems(400, 401, 403, 404)
  @ApiOkResponse({ type: ProgramPerformanceResponse })
  @Roles('center_admin', 'ops', 'admin')
  @RequireScopes('portfolio:read')
  @ApiOperation({ summary: 'How a program converts: approval rate, mean ticket and score' })
  programPerformance(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('programId', ParseUUIDPipe) programId: string,
  ): Promise<ProgramPerformanceDto> {
    return this.queries.execute(new GetProgramPerformanceQuery(actor, centerId, programId));
  }

  @Get('ops/overview')
  @ApiProblems(401, 403)
  @ApiOkResponse({ type: OpsOverviewResponse })
  @Roles('ops', 'admin')
  @ApiOperation({
    summary: 'What needs operations: reviews, failed collections and transfers, dead letters',
  })
  overview(@CurrentPrincipal() actor: Principal): Promise<OpsOverviewDto> {
    return this.queries.execute(new GetOpsOverviewQuery(actor));
  }

  @Post('ops/reporting/rebuild')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiProblems(400, 401, 403)
  @ApiAcceptedResponse({ type: RebuildResponse })
  @Roles('ops', 'admin')
  @Idempotent()
  @Audited({ action: 'reporting.rebuild', resource: 'reporting' })
  @ApiOperation({ summary: 'Rebuild the read models from the history of events (a job)' })
  rebuild(@CurrentPrincipal() actor: Principal): Promise<{ readonly queued: boolean }> {
    return this.commands.execute(new RequestRebuildCommand(actor));
  }
}
