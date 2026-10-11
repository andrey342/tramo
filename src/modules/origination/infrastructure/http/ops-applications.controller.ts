import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type CursorPage, type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems, CursorPageQueryDto } from '@shared/infrastructure/http';
import { Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { DecideApplicationCommand } from '../../application/commands/decide-application.command';
import { ReviseRiskPolicyCommand } from '../../application/commands/revise-risk-policy.command';
import {
  type ApplicationDto,
  type ApplicationSummaryDto,
} from '../../application/dto/application.dto';
import { type RiskPolicyDto } from '../../application/dto/risk-policy.dto';
import { GetCurrentRiskPolicyQuery } from '../../application/queries/get-current-risk-policy.query';
import { GetReviewQueueQuery } from '../../application/queries/get-review-queue.query';

import {
  ApplicationPageResponse,
  ApplicationResponse,
  DecideApplicationRequest,
} from './applications.dto';
import { RevisePolicyRequest, RiskPolicyResponse } from './risk-policies.dto';

// Risk operations: the review queue, manual decisions and the risk policy.
@ApiTags('ops')
@Controller()
export class OpsApplicationsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get('ops/applications/review-queue')
  @ApiProblems(400, 401, 403)
  @ApiOkResponse({ type: ApplicationPageResponse })
  @Roles('ops', 'admin')
  @ApiOperation({ summary: 'Applications waiting for an analyst, longest waiting first' })
  reviewQueue(
    @CurrentPrincipal() actor: Principal,
    @Query() query: CursorPageQueryDto,
  ): Promise<CursorPage<ApplicationSummaryDto>> {
    return this.queries.execute(new GetReviewQueueQuery(actor, query.toPageRequest()));
  }

  @Post('ops/applications/:applicationId/decide')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 409)
  @ApiOkResponse({ type: ApplicationResponse })
  @Roles('ops', 'admin')
  @Audited({
    action: 'application.decide',
    resource: 'application',
    resourceIdParam: 'applicationId',
  })
  @ApiOperation({ summary: 'Approve or reject an application in review, with a reason' })
  decide(
    @CurrentPrincipal() actor: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() body: DecideApplicationRequest,
  ): Promise<ApplicationDto> {
    return this.commands.execute(
      new DecideApplicationCommand(actor, applicationId, body.outcome, body.reason),
    );
  }

  @Get('risk-policies/current')
  @ApiProblems(401, 403)
  @ApiOkResponse({ type: RiskPolicyResponse })
  @Roles('ops', 'admin')
  @ApiOperation({ summary: 'The risk policy new applications are scored with' })
  currentPolicy(@CurrentPrincipal() actor: Principal): Promise<RiskPolicyDto> {
    return this.queries.execute(new GetCurrentRiskPolicyQuery(actor));
  }

  @Post('risk-policies')
  @ApiProblems(400, 401, 403, 409, 422)
  @ApiCreatedResponse({ type: RiskPolicyResponse })
  @Roles('admin')
  @Audited({ action: 'risk_policy.revise', resource: 'risk_policy' })
  @ApiOperation({
    summary: 'Publish the next version of the risk policy; past decisions keep theirs',
  })
  revisePolicy(
    @CurrentPrincipal() actor: Principal,
    @Body() body: RevisePolicyRequest,
  ): Promise<RiskPolicyDto> {
    return this.commands.execute(new ReviseRiskPolicyCommand(actor, body));
  }
}
