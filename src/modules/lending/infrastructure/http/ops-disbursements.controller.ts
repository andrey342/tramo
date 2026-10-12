import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type CursorPage, type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems, Idempotent } from '@shared/infrastructure/http';
import { Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { RetryDisbursementCommand } from '../../application/commands/retry-disbursement.command';
import { type DisbursementDto } from '../../application/dto/contract.dto';
import { ListDisbursementsQuery } from '../../application/queries/list-disbursements.query';

import {
  DisbursementPageResponse,
  DisbursementResponse,
  ListDisbursementsQueryDto,
} from './contracts.dto';

// Payments to training centers, for ops.
@ApiTags('ops')
@Controller('ops/disbursements')
export class OpsDisbursementsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get()
  @ApiProblems(400, 401, 403)
  @ApiOkResponse({ type: DisbursementPageResponse })
  @Roles('ops', 'admin')
  @ApiOperation({ summary: 'Disbursements to centers, newest first, by status' })
  list(
    @CurrentPrincipal() actor: Principal,
    @Query() query: ListDisbursementsQueryDto,
  ): Promise<CursorPage<DisbursementDto>> {
    return this.queries.execute(
      new ListDisbursementsQuery(actor, { status: query.status }, query.toPageRequest()),
    );
  }

  @Post(':disbursementId/retry')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 409)
  @ApiOkResponse({ type: DisbursementResponse })
  @Roles('ops', 'admin')
  @Idempotent()
  @Audited({
    action: 'disbursement.retry',
    resource: 'disbursement',
    resourceIdParam: 'disbursementId',
  })
  @ApiOperation({ summary: 'Send a failed disbursement again, as a new transfer' })
  retry(
    @CurrentPrincipal() actor: Principal,
    @Param('disbursementId', ParseUUIDPipe) disbursementId: string,
  ): Promise<DisbursementDto> {
    return this.commands.execute(new RetryDisbursementCommand(actor, disbursementId));
  }
}
