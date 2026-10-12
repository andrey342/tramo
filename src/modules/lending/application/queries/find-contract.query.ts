import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { CONTRACT_REPOSITORY, type ContractRepository } from '../../domain';
import { type ContractLookupDto, FindContractQuery } from '../dto/contract-lookup';

@QueryHandler(FindContractQuery)
export class FindContractHandler implements IQueryHandler<FindContractQuery> {
  constructor(@Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository) {}

  async execute(query: FindContractQuery): Promise<ContractLookupDto | null> {
    const contract = await this.contracts.findById(query.contractId);
    return contract
      ? {
          id: contract.id,
          studentId: contract.studentId,
          centerId: contract.centerId,
          product: contract.terms.product.kind,
          status: contract.status,
        }
      : null;
  }
}
