import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Inject,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type CursorPage, type Principal } from '@shared/application';
import { CalendarDate, type Clock, CLOCK } from '@shared/domain';
import { Audited } from '@shared/infrastructure/audit';
import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import {
  ApiProblems,
  CursorPageQueryDto,
  Idempotent,
  ProblemException,
} from '@shared/infrastructure/http';
import { Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { DeclareIncomeCommand } from '../../application/commands/declare-income.command';
import {
  RunBillingNowCommand,
  RunDunningNowCommand,
} from '../../application/commands/ops-runs.command';
import { RetryChargeCommand } from '../../application/commands/retry-charge.command';
import { SignMandateCommand } from '../../application/commands/sign-mandate.command';
import {
  type BillingRunDto,
  type ChargeDto,
  type DunningRunDto,
  type IncomeDeclarationDto,
  type MandateDto,
  type StatementDto,
} from '../../application/dto/billing.dto';
import { GetStatementQuery } from '../../application/queries/get-statement.query';
import { ListChargesQuery } from '../../application/queries/list-charges.query';

import {
  AsOfQueryDto,
  BillingRunResponse,
  ChargePageResponse,
  ChargeResponse,
  DeclareIncomeRequest,
  DunningRunResponse,
  IncomeDeclarationResponse,
  MandateResponse,
  SignMandateRequest,
  StatementResponse,
} from './billing.dto';

@ApiTags('billing')
@Controller()
export class BillingController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('contracts/:contractId/mandate')
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiCreatedResponse({ type: MandateResponse })
  @Roles('student')
  @Idempotent()
  @Audited({ action: 'billing.sign_mandate', resource: 'contract', resourceIdParam: 'contractId' })
  @ApiOperation({ summary: 'Authorise the direct debit of the contract from an account' })
  signMandate(
    @CurrentPrincipal() actor: Principal,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() body: SignMandateRequest,
  ): Promise<MandateDto> {
    return this.commands.execute(new SignMandateCommand(actor, contractId, body.iban));
  }

  @Post('contracts/:contractId/income-declarations')
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiCreatedResponse({ type: IncomeDeclarationResponse })
  @Roles('student')
  @Idempotent()
  // The income decides what is charged: audited, with the contract only (never the amount).
  @Audited({
    action: 'billing.declare_income',
    resource: 'contract',
    resourceIdParam: 'contractId',
  })
  @ApiOperation({ summary: 'Declare the income of a month (income share agreements)' })
  declareIncome(
    @CurrentPrincipal() actor: Principal,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Body() body: DeclareIncomeRequest,
  ): Promise<IncomeDeclarationDto> {
    return this.commands.execute(
      new DeclareIncomeCommand(actor, contractId, body.period, body.grossMonthlyIncomeCents),
    );
  }

  @Get('contracts/:contractId/charges')
  @ApiProblems(400, 401, 403, 404)
  @ApiOkResponse({ type: ChargePageResponse })
  @Roles('student', 'ops', 'admin')
  @ApiOperation({ summary: 'The charges of a contract, newest first' })
  charges(
    @CurrentPrincipal() actor: Principal,
    @Param('contractId', ParseUUIDPipe) contractId: string,
    @Query() query: CursorPageQueryDto,
  ): Promise<CursorPage<ChargeDto>> {
    return this.queries.execute(new ListChargesQuery(actor, contractId, query.toPageRequest()));
  }

  @Get('contracts/:contractId/statement')
  @ApiProblems(400, 401, 403, 404)
  @ApiOkResponse({ type: StatementResponse })
  @Roles('student', 'ops', 'admin')
  @ApiOperation({ summary: 'Charges, payments and write-offs in order, with the balance owed' })
  statement(
    @CurrentPrincipal() actor: Principal,
    @Param('contractId', ParseUUIDPipe) contractId: string,
  ): Promise<StatementDto> {
    return this.queries.execute(new GetStatementQuery(actor, contractId));
  }

  @Post('charges/:chargeId/retry')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiOkResponse({ type: ChargeResponse })
  @Roles('ops', 'admin')
  @Idempotent()
  @Audited({ action: 'billing.retry_charge', resource: 'charge', resourceIdParam: 'chargeId' })
  @ApiOperation({ summary: 'Collect a failed or overdue charge again' })
  retry(
    @CurrentPrincipal() actor: Principal,
    @Param('chargeId', ParseUUIDPipe) chargeId: string,
  ): Promise<ChargeDto> {
    return this.commands.execute(new RetryChargeCommand(actor, chargeId));
  }

  @Post('ops/billing/run')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 422)
  @ApiOkResponse({ type: BillingRunResponse })
  @Roles('ops', 'admin')
  @Idempotent()
  @Audited({ action: 'billing.run', resource: 'billing' })
  @ApiOperation({ summary: 'Run the billing cycle and collect what is due, as of a day' })
  runBilling(
    @CurrentPrincipal() actor: Principal,
    @Query() query: AsOfQueryDto,
  ): Promise<BillingRunDto> {
    return this.commands.execute(
      new RunBillingNowCommand(actor, this.asOf(query), query.contractId ?? null),
    );
  }

  @Post('ops/dunning/run')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 422)
  @ApiOkResponse({ type: DunningRunResponse })
  @Roles('ops', 'admin')
  @Idempotent()
  @Audited({ action: 'billing.dunning_run', resource: 'billing' })
  @ApiOperation({ summary: 'Run dunning (reminders, notices, retries, arrears) as of a day' })
  runDunning(
    @CurrentPrincipal() actor: Principal,
    @Query() query: AsOfQueryDto,
  ): Promise<DunningRunDto> {
    return this.commands.execute(
      new RunDunningNowCommand(actor, this.asOf(query), query.contractId ?? null),
    );
  }

  // A day still to come only where future runs are enabled (not in production by default).
  private asOf(query: AsOfQueryDto): CalendarDate {
    const today = CalendarDate.fromInstant(this.clock.now());
    const asOf = query.asOf ? CalendarDate.parse(query.asOf) : today;
    if (asOf.isAfter(today) && !this.config.billing.futureRunsEnabled) {
      throw new ProblemException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'as_of_in_future',
        'Billing runs as of today or a past day.',
      );
    }
    return asOf;
  }
}
