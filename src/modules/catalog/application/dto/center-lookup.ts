import { Query } from '@nestjs/cqrs';

import { type CenterStatus } from '../../domain';

export interface CenterSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly status: CenterStatus;
  // What Tramo keeps from each disbursement to the center.
  readonly platformFeeBasisPoints: number;
}

// Part of the module's public surface: other modules ask whether a training center exists, and
// in what state, through the query bus instead of reading catalog's tables.
export class FindCenterQuery extends Query<CenterSummaryDto | null> {
  constructor(readonly centerId: string) {
    super();
  }
}

// The account a disbursement is paid into, in full. Only lending asks, to make the transfer;
// everything else sees the masked IBAN of TrainingCenterDto.
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
