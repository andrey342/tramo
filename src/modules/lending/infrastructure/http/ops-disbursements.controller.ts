import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type CursorPage, type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import {
  ApiCursorPaginated,
  ApiProblems,
  Idempotent,
  ParseIdPipe,
} from '@shared/infrastructure/http';
import { Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { ReconcileDisbursementCommand } from '../../application/commands/reconcile-disbursement.command';
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
  @ApiCursorPaginated()
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
    @Param('disbursementId', ParseIdPipe) disbursementId: string,
  ): Promise<DisbursementDto> {
    return this.commands.execute(new RetryDisbursementCommand(actor, disbursementId));
  }

  @Post(':disbursementId/reconcile')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 422)
  @ApiOkResponse({ type: DisbursementResponse })
  @Roles('ops', 'admin')
  @Audited({
    action: 'disbursement.reconcile',
    resource: 'disbursement',
    resourceIdParam: 'disbursementId',
  })
  @ApiOperation({
    summary:
      'For one whose jobs ran out: send a pending transfer again (same key) or ask the bank about a sent one',
  })
  reconcile(
    @CurrentPrincipal() actor: Principal,
    @Param('disbursementId', ParseIdPipe) disbursementId: string,
  ): Promise<DisbursementDto> {
    return this.commands.execute(new ReconcileDisbursementCommand(actor, disbursementId));
  }
}
