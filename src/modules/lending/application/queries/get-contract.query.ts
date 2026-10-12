import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';

import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  DISBURSEMENT_REPOSITORY,
  type DisbursementRepository,
} from '../../domain';
import { canSeePayout, findVisibleContract } from '../contract-access';
import { toContractDto } from '../contract.mapping';
import { type ContractDto } from '../dto/contract.dto';

export class GetContractQuery extends Query<ContractDto> {
  constructor(
    readonly actor: Principal,
    readonly contractId: string,
  ) {
    super();
  }
}

@QueryHandler(GetContractQuery)
export class GetContractHandler implements IQueryHandler<GetContractQuery> {
  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(DISBURSEMENT_REPOSITORY) private readonly disbursements: DisbursementRepository,
  ) {}

  async execute(query: GetContractQuery): Promise<ContractDto> {
    const contract = await findVisibleContract(this.contracts, query.actor, query.contractId);
    const visible = canSeePayout(query.actor, contract);
    const disbursement = visible ? await this.disbursements.findByContractId(contract.id) : null;
    return toContractDto(contract, { visible, disbursement });
  }
}
