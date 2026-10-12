import { Query } from '@nestjs/cqrs';

import { type CenterStatus } from '../../domain';

// The account a disbursement is paid into, in full. Only lending asks, to make the transfer
// (a dependency rule allows its catalog adapter alone); everything else sees the masked IBAN of
// TrainingCenterDto.
export interface PayoutAccountDto {
  readonly centerId: string;
  readonly holderName: string;
  readonly iban: string;
  readonly centerStatus: CenterStatus;
}

export class GetPayoutAccountQuery extends Query<PayoutAccountDto | null> {
  constructor(readonly centerId: string) {
    super();
  }
}
