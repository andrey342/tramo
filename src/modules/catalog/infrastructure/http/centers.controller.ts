import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems, Idempotent } from '@shared/infrastructure/http';
import { Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { RegisterTrainingCenterCommand } from '../../application/commands/register-training-center.command';
import { UpdateTrainingCenterCommand } from '../../application/commands/update-training-center.command';
import { VerifyCenterVatCommand } from '../../application/commands/verify-center-vat.command';
import { GetTrainingCenterQuery } from '../../application/queries/get-training-center.query';

import {
  CenterRegisteredResponse,
  RegisterTrainingCenterRequest,
  TrainingCenterResponse,
  UpdateTrainingCenterRequest,
} from './centers.dto';

@ApiTags('training centers')
@Controller('centers')
export class CentersController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post()
  @ApiProblems(400, 401, 403, 409, 422)
  @ApiCreatedResponse({ type: CenterRegisteredResponse })
  @Roles('admin')
  @Idempotent()
  @Audited({ action: 'center.register', resource: 'center' })
  @ApiOperation({
    summary: 'Register a training center (admin)',
    description:
      'The center starts as pending_verification; its VAT number is checked against VIES in the background and a valid one activates it.',
  })
  async register(
    @CurrentPrincipal() actor: Principal,
    @Body() body: RegisterTrainingCenterRequest,
  ): Promise<CenterRegisteredResponse> {
    const { centerId } = await this.commands.execute(
      new RegisterTrainingCenterCommand(
        actor,
        body.name,
        body.country,
        body.taxId,
        body.payoutIban,
        body.platformFeeBasisPoints,
      ),
    );
    return { id: centerId };
  }

  @Get(':centerId')
  @ApiProblems(400, 401, 403, 404)
  @ApiOkResponse({ type: TrainingCenterResponse })
  @Roles('admin', 'ops', 'center_admin')
  @ApiOperation({ summary: 'A training center: staff see any, a center admin its own' })
  get(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
  ): Promise<TrainingCenterResponse> {
    return this.queries.execute(new GetTrainingCenterQuery(actor, centerId));
  }

  @Post(':centerId/verify-vat')
  @HttpCode(HttpStatus.OK)
  @ApiProblems(400, 401, 403, 404)
  @ApiOkResponse({ type: TrainingCenterResponse })
  @Roles('admin', 'ops')
  @Audited({ action: 'center.verify_vat', resource: 'center', resourceIdParam: 'centerId' })
  @ApiOperation({
    summary: 'Check the VAT number against VIES now (admin, ops)',
    description:
      'A valid number activates a center waiting for verification. When VIES is unavailable the center is marked unverified and nothing fails.',
  })
  verifyVat(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
  ): Promise<TrainingCenterResponse> {
    return this.commands.execute(new VerifyCenterVatCommand(actor, centerId));
  }

  @Patch(':centerId')
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiOkResponse({ type: TrainingCenterResponse })
  @Roles('admin')
  @Audited({ action: 'center.update', resource: 'center', resourceIdParam: 'centerId' })
  @ApiOperation({ summary: 'Rename, change fee or payout account, suspend or reinstate (admin)' })
  update(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Body() body: UpdateTrainingCenterRequest,
  ): Promise<TrainingCenterResponse> {
    return this.commands.execute(new UpdateTrainingCenterCommand(actor, centerId, body));
  }
}
