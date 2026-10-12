import { Query } from '@nestjs/cqrs';

import { type ContractStatus } from '../../domain';

export interface ContractLookupDto {
  readonly id: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly product: 'installments' | 'isa';
  readonly status: ContractStatus;
}

// Part of the module's public surface: billing checks whose contract a mandate or an income
// declaration is for, and whether it is being repaid.
export class FindContractQuery extends Query<ContractLookupDto | null> {
  constructor(readonly contractId: string) {
    super();
  }
}
