import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type CursorPage, type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems, AuthRateLimited, Idempotent } from '@shared/infrastructure/http';
import { RequireScopes, Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { AcceptOfferCommand } from '../../application/commands/accept-offer.command';
import { CancelApplicationCommand } from '../../application/commands/cancel-application.command';
import { StartApplicationCommand } from '../../application/commands/start-application.command';
import { SubmitApplicationCommand } from '../../application/commands/submit-application.command';
import { UpdateApplicationDraftCommand } from '../../application/commands/update-application-draft.command';
import {
  type ApplicationDto,
  type ApplicationSummaryDto,
  type DecisionDto,
} from '../../application/dto/application.dto';
import { GetApplicationDecisionQuery } from '../../application/queries/get-application-decision.query';
import { GetApplicationQuery } from '../../application/queries/get-application.query';
import { ListApplicationsQuery } from '../../application/queries/list-applications.query';

import {
  ApplicationPageResponse,
  ApplicationResponse,
  DecisionResponse,
  ListApplicationsQueryDto,
  StartApplicationRequest,
  UpdateApplicationRequest,
} from './applications.dto';

@ApiTags('applications')
@Controller('applications')
export class ApplicationsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post()
  @ApiProblems(400, 401, 403, 409, 422, 429)
  @ApiCreatedResponse({ type: ApplicationResponse })
  @Roles('student')
  @RequireScopes('applications:write')
  @Idempotent()
  // A center key looks students up by email: the credential-endpoint limit keeps that from
  // being used to sweep for which emails have an account.
  @AuthRateLimited()
  @ApiOperation({
    summary: 'Start an application as a draft (a student, or a center API key for its student)',
  })
  start(
    @CurrentPrincipal() actor: Principal,
    @Body() body: StartApplicationRequest,
  ): Promise<ApplicationDto> {
    return this.commands.execute(
      new StartApplicationCommand(actor, {
        programId: body.programId,
        product: body.product.toProduct(),
        profile: body.profile ?? {},
        studentEmail: body.studentEmail,
      }),
    );
  }

  @Patch(':applicationId')
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiOkResponse({ type: ApplicationResponse })
  @Roles('student')
  @RequireScopes('applications:write')
  @ApiOperation({ summary: 'Complete or change a draft' })
  update(
    @CurrentPrincipal() actor: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() body: UpdateApplicationRequest,
  ): Promise<ApplicationDto> {
    return this.commands.execute(
      new UpdateApplicationDraftCommand(actor, applicationId, {
        programId: body.programId,
        product: body.product?.toProduct(),
        profile: body.profile,
      }),
    );
  }

  @Post(':applicationId/submit')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiOkResponse({ type: ApplicationResponse })
  @Roles('student')
  @Idempotent()
  @Audited({
    action: 'application.submit',
    resource: 'application',
    resourceIdParam: 'applicationId',
  })
  @ApiOperation({
    summary: 'Submit a complete draft: starts identity, employment and credit checks',
  })
  submit(
    @CurrentPrincipal() actor: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicationDto> {
    return this.commands.execute(new SubmitApplicationCommand(actor, applicationId));
  }

  @Post(':applicationId/accept-offer')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 409)
  @ApiOkResponse({ type: ApplicationResponse })
  @Roles('student')
  @Idempotent()
  @Audited({
    action: 'application.accept_offer',
    resource: 'application',
    resourceIdParam: 'applicationId',
  })
  @ApiOperation({ summary: 'Accept an approved offer; lending then draws up the contract' })
  acceptOffer(
    @CurrentPrincipal() actor: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicationDto> {
    return this.commands.execute(new AcceptOfferCommand(actor, applicationId));
  }

  @Post(':applicationId/cancel')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 409)
  @ApiOkResponse({ type: ApplicationResponse })
  @Roles('student')
  @Audited({
    action: 'application.cancel',
    resource: 'application',
    resourceIdParam: 'applicationId',
  })
  @ApiOperation({ summary: 'Withdraw an application that is not final yet' })
  cancel(
    @CurrentPrincipal() actor: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicationDto> {
    return this.commands.execute(new CancelApplicationCommand(actor, applicationId));
  }

  @Get()
  @ApiProblems(400, 401, 403)
  @ApiOkResponse({ type: ApplicationPageResponse })
  @Roles('student', 'center_admin', 'ops', 'admin')
  @RequireScopes('applications:read')
  @ApiOperation({
    summary: "A student's own applications, a center's, or all of them for staff; newest first",
  })
  list(
    @CurrentPrincipal() actor: Principal,
    @Query() query: ListApplicationsQueryDto,
  ): Promise<CursorPage<ApplicationSummaryDto>> {
    return this.queries.execute(
      new ListApplicationsQuery(actor, query.status, query.toPageRequest()),
    );
  }

  @Get(':applicationId')
  @ApiProblems(400, 401, 403, 404)
  @ApiOkResponse({ type: ApplicationResponse })
  @Roles('student', 'center_admin', 'ops', 'admin')
  @RequireScopes('applications:read')
  @ApiOperation({ summary: 'An application; its center does not see the personal data' })
  get(
    @CurrentPrincipal() actor: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<ApplicationDto> {
    return this.queries.execute(new GetApplicationQuery(actor, applicationId));
  }

  @Get(':applicationId/decision')
  @ApiProblems(400, 401, 403, 404)
  @ApiOkResponse({ type: DecisionResponse })
  @Roles('student', 'ops', 'admin')
  @ApiOperation({
    summary: 'Why the application was decided as it was: score, factors, reasons, policy',
  })
  decision(
    @CurrentPrincipal() actor: Principal,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
  ): Promise<DecisionDto> {
    return this.queries.execute(new GetApplicationDecisionQuery(actor, applicationId));
  }
}
