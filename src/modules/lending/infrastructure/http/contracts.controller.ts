import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';

import { type CursorPage, type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems, Idempotent } from '@shared/infrastructure/http';
import { RequireScopes, Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { RequestPayoffCommand } from '../../application/commands/request-payoff.command';
import {
  type ContractDto,
  type ContractSummaryDto,
  type PayoffQuoteDto,
  type ScheduleDto,
} from '../../application/dto/contract.dto';
import { GetContractDocumentQuery } from '../../application/queries/get-contract-document.query';
import { GetContractScheduleQuery } from '../../application/queries/get-contract-schedule.query';
import { GetContractQuery } from '../../application/queries/get-contract.query';
import { GetPayoffQuoteQuery } from '../../application/queries/get-payoff-quote.query';
import { ListContractsQuery } from '../../application/queries/list-contracts.query';

import {
  ContractPageResponse,
  ContractResponse,
  ListContractsQueryDto,
  PayoffQuoteRequest,
  PayoffQuoteResponse,
  PayoffRequest,
  ScheduleResponse,
} from './contracts.dto';

@ApiTags('contracts')
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Get()
  @ApiProblems(400, 401, 403)
  @ApiOkResponse({ type: ContractPageResponse })
  @Roles('student', 'center_admin', 'ops', 'admin')
  @RequireScopes('portfolio:read')
  @ApiOperation({
    summary: "A student's contracts, a center's portfolio, or all of them for staff; newest first",
  })
  list(
    @CurrentPrincipal() actor: Principal,
    @Query() query: ListContractsQueryDto,
  ): Promise<CursorPage<ContractSummaryDto>> {
    return this.queries.execute(
      new ListContractsQuery(
        actor,
        { status: query.status, centerId: query.centerId },
        query.toPageRequest(),
      ),
    );
  }

  @Get(':contractId')
  @ApiProblems(400, 401, 403, 404)
  @ApiOkResponse({ type: ContractResponse })
  @Roles('student', 'center_admin', 'ops', 'admin')
  @RequireScopes('portfolio:read')
  @ApiOperation({ summary: 'A contract; what the center is paid is not shown to the student' })
  get(
    @CurrentPrincipal() actor: Principal,
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ): Promise<ContractDto> {
    return this.queries.execute(new GetContractQuery(actor, contractId));
  }

  @Get(':contractId/document')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @ApiProblems(400, 401, 403, 404)
  @ApiProduces('text/plain')
  @ApiOkResponse({ type: String, description: 'Its SHA-256 is the documentHash of the signature' })
  @Roles('student', 'ops', 'admin')
  @ApiOperation({ summary: 'The contract text the student signs' })
  document(
    @CurrentPrincipal() actor: Principal,
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ): Promise<string> {
    return this.queries.execute(new GetContractDocumentQuery(actor, contractId));
  }

  @Get(':contractId/schedule')
  @ApiProblems(400, 401, 403, 404)
  @ApiOkResponse({ type: ScheduleResponse })
  @Roles('student', 'ops', 'admin')
  @ApiOperation({
    summary: 'The instalment table, or where an ISA stands; once the contract is active',
  })
  schedule(
    @CurrentPrincipal() actor: Principal,
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ): Promise<ScheduleDto> {
    return this.queries.execute(new GetContractScheduleQuery(actor, contractId));
  }

  @Post(':contractId/payoff-quote')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiOkResponse({ type: PayoffQuoteResponse })
  @Roles('student', 'ops', 'admin')
  @ApiOperation({
    summary: 'What repaying everything costs today or on a day in the coming month (instalments)',
  })
  payoffQuote(
    @CurrentPrincipal() actor: Principal,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() body: PayoffQuoteRequest,
  ): Promise<PayoffQuoteDto> {
    return this.queries.execute(new GetPayoffQuoteQuery(actor, contractId, body.asOf));
  }

  @Post(':contractId/payoff')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiOkResponse({ type: PayoffQuoteResponse })
  @Roles('student')
  @Idempotent()
  @Audited({ action: 'contract.payoff', resource: 'contract', resourceIdParam: 'contractId' })
  @ApiOperation({
    summary: "Repay everything today, for today's quote; billing collects it",
  })
  payoff(
    @CurrentPrincipal() actor: Principal,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() body: PayoffRequest,
  ): Promise<PayoffQuoteDto> {
    return this.commands.execute(new RequestPayoffCommand(actor, contractId, body.amountCents));
  }
}
