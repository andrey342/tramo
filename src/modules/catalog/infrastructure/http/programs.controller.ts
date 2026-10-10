import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type CursorPage, type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems, Idempotent } from '@shared/infrastructure/http';
import {
  OptionalAuthentication,
  Public,
  RequireScopes,
  Roles,
} from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { CreateProgramCommand } from '../../application/commands/create-program.command';
import { UpdateProgramCommand } from '../../application/commands/update-program.command';
import { type CatalogProgramDto } from '../../application/dto/program.dto';
import { GetProgramQuery } from '../../application/queries/get-program.query';
import { ListProgramsQuery } from '../../application/queries/list-programs.query';

import {
  CatalogProgramResponse,
  CreateProgramRequest,
  ListProgramsQueryDto,
  ProgramPageResponse,
  ProgramResponse,
  UpdateProgramRequest,
} from './programs.dto';

@ApiTags('programs')
@Controller()
export class ProgramsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post('centers/:centerId/programs')
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiCreatedResponse({ type: ProgramResponse })
  @Roles('center_admin', 'admin')
  @RequireScopes('programs:write')
  @Idempotent()
  @ApiOperation({
    summary: 'Create a draft program (center admin, admin, or API key with programs:write)',
  })
  create(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Body() body: CreateProgramRequest,
  ): Promise<ProgramResponse> {
    const { financing, ...details } = body;
    return this.commands.execute(new CreateProgramCommand(actor, centerId, details, financing));
  }

  @Patch('programs/:programId')
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiOkResponse({ type: ProgramResponse })
  @Roles('center_admin', 'admin')
  @RequireScopes('programs:write')
  @Audited({ action: 'program.update', resource: 'program', resourceIdParam: 'programId' })
  @ApiOperation({
    summary: 'Change details or financing, publish or archive a program',
    description:
      'Publishing needs an active center and at least one financing option; an ISA needs an employability rate of 60 % or more.',
  })
  update(
    @CurrentPrincipal() actor: Principal,
    @Param('programId', ParseUUIDPipe) programId: string,
    @Body() body: UpdateProgramRequest,
  ): Promise<ProgramResponse> {
    const { financing, status, ...details } = body;
    return this.commands.execute(
      new UpdateProgramCommand(actor, programId, { details, financing, status }),
    );
  }

  @Get('programs')
  @Public()
  @ApiProblems(400, 422)
  @ApiOkResponse({ type: ProgramPageResponse })
  @ApiOperation({
    summary: 'The public catalog: published programs of active centers, newest first',
  })
  list(@Query() query: ListProgramsQueryDto): Promise<CursorPage<CatalogProgramDto>> {
    return this.queries.execute(
      new ListProgramsQuery(
        {
          centerId: query.centerId,
          modality: query.modality,
          product: query.product,
          minPriceCents: query.minPriceCents,
          maxPriceCents: query.maxPriceCents,
        },
        query.toPageRequest(),
      ),
    );
  }

  @Get('programs/:programId')
  @OptionalAuthentication()
  @ApiProblems(400, 401, 404)
  @ApiOkResponse({ type: CatalogProgramResponse })
  @ApiOperation({
    summary: 'A published program; its center also sees drafts and archived ones',
  })
  get(
    @CurrentPrincipal() actor: Principal,
    @Param('programId', ParseUUIDPipe) programId: string,
  ): Promise<CatalogProgramResponse> {
    return this.queries.execute(new GetProgramQuery(actor, programId));
  }
}
