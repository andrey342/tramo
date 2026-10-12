import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';

import { CONTRACT_REPOSITORY, type ContractRepository, renderContractDocument } from '../../domain';
import { canSeeRepayment, findVisibleContract } from '../contract-access';

// The text the student signs: as it was sent once the contract is out for signature (its SHA-256
// is the documentHash of the signature), rendered from the terms before that.
export class GetContractDocumentQuery extends Query<string> {
  constructor(
    readonly actor: Principal,
    readonly contractId: string,
  ) {
    super();
  }
}

@QueryHandler(GetContractDocumentQuery)
export class GetContractDocumentHandler implements IQueryHandler<GetContractDocumentQuery> {
  constructor(@Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository) {}

  async execute(query: GetContractDocumentQuery): Promise<string> {
    const contract = await findVisibleContract(
      this.contracts,
      query.actor,
      query.contractId,
      canSeeRepayment,
    );
    return contract.signature?.document ?? renderContractDocument(contract);
  }
}
