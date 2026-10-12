import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { FindCenterQuery } from '@modules/catalog/application/dto/center-lookup';
import { GetPayoutAccountQuery } from '@modules/catalog/application/dto/payout-account';
import { FindProgramQuery } from '@modules/catalog/application/dto/program-lookup';
import { Percentage } from '@shared/domain';

import { type ContractingDirectory } from '../../application/ports/lending-ports';

// Asks the catalog module through its public queries, never through its tables (ADR 008).
@Injectable()
export class CatalogContractingDirectory implements ContractingDirectory {
  constructor(private readonly queries: QueryBus) {}

  async contractingDetails(
    centerId: string,
    programId: string,
  ): Promise<{ readonly platformFee: Percentage; readonly programDurationWeeks: number } | null> {
    const [center, program] = await Promise.all([
      this.queries.execute(new FindCenterQuery(centerId)),
      this.queries.execute(new FindProgramQuery(programId)),
    ]);
    if (!center || program?.centerId !== centerId) {
      return null;
    }
    return {
      platformFee: Percentage.fromBasisPoints(center.platformFeeBasisPoints),
      programDurationWeeks: program.durationWeeks,
    };
  }

  async payoutAccount(centerId: string): Promise<{
    readonly iban: string;
    readonly holderName: string;
    readonly centerActive: boolean;
  } | null> {
    const account = await this.queries.execute(new GetPayoutAccountQuery(centerId));
    return (
      account && {
        iban: account.iban,
        holderName: account.holderName,
        centerActive: account.centerStatus === 'active',
      }
    );
  }
}
