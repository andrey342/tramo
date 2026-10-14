import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems, ParseIdPipe } from '@shared/infrastructure/http';
import { Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { CancelUndisbursedContractCommand } from '../../application/commands/cancel-undisbursed-contract.command';
import { type ContractDto } from '../../application/dto/contract.dto';

import { ContractResponse } from './contracts.dto';

// Contracts ops act on, for staff.
@ApiTags('ops')
@Controller('ops/contracts')
export class OpsContractsController {
  constructor(private readonly commands: CommandBus) {}

  // Not @Idempotent: it creates nothing and moves no money, and a repeated request finds the
  // contract cancelled and answers it as it is.
  @Post(':contractId/cancel')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 409)
  @ApiOkResponse({ type: ContractResponse })
  @Roles('ops', 'admin')
  @Audited({ action: 'contract.cancel', resource: 'contract', resourceIdParam: 'contractId' })
  @ApiOperation({
    summary: 'Cancel a signed contract whose disbursement failed for good; frees the application',
  })
  cancel(
    @CurrentPrincipal() actor: Principal,
    @Param('contractId', ParseIdPipe) contractId: string,
  ): Promise<ContractDto> {
    return this.commands.execute(new CancelUndisbursedContractCommand(actor, contractId));
  }
}
